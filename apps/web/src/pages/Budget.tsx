import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Pencil, Send, Check, X, CreditCard } from "lucide-react";
import type { Overview } from "../../../../packages/shared/src/types";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
import {
  CategoryIcon,
  EmptyState,
  LoadingSkeleton,
  MonthSelector,
} from "@/components/common";
import { Button } from "@/components/ui/button";

interface BudgetCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  budget: number | null;
  spent: number;
  remaining: number | null;
  percent: number | null;
  income: boolean;
}
interface BudgetStatus {
  month: string;
  categories: BudgetCategory[];
  totals: {
    budget: number;
    spentInBudgeted: number;
    remaining: number;
    spent: number;
    unbudgetedSpent: number;
    percent: number | null;
  };
}

const tone = (percent: number | null) =>
  percent == null ? "" : percent > 100 ? "over" : percent >= 80 ? "warn" : "ok";

function Bar({ percent }: { percent: number | null }) {
  return (
    <div className={"budget-bar " + tone(percent)} aria-hidden>
      <span style={{ width: Math.min(100, percent ?? 0) + "%" }} />
    </div>
  );
}

const toCents = (v: string) => {
  const clean = v
    .replace(/[^\d,.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!clean) return null;
  const n = Math.round(Number(clean) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const toInput = (cents: number | null) =>
  cents == null
    ? ""
    : (cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export function BudgetPage({
  data,
  month,
  setMonth,
}: {
  data: Overview;
  month: string;
  setMonth: (v: string) => void;
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<BudgetStatus>("/budget?month=" + month).then(setStatus);
  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
    // data muda quando o app atualiza (foco, 30 s ou novo lançamento).
  }, [month, data]);

  if (!status) return <LoadingSkeleton />;
  const t = status.totals;
  const budgeted = status.categories.filter((c) => c.budget != null);
  const free = status.categories.filter((c) => c.budget == null && c.spent > 0);
  const invoices = data.invoices.filter(
    (i) => i.competence === month && i.total > 0,
  );

  function startEditing() {
    setDrafts(
      Object.fromEntries(
        status!.categories.map((c) => [c.id, toInput(c.budget)]),
      ),
    );
    setEditing(true);
  }
  async function save() {
    const changed = status!.categories.filter(
      (c) => (toCents(drafts[c.id] || "") ?? null) !== c.budget,
    );
    if (changed.some((c) => Number.isNaN(toCents(drafts[c.id] || ""))))
      return toast.error(
        "Confira os valores: use números, como 1.300 ou 450,50.",
      );
    setSaving(true);
    try {
      for (const c of changed)
        await api("/categories/" + c.id + "/budget", {
          method: "PUT",
          body: JSON.stringify({ monthlyBudget: toCents(drafts[c.id] || "") }),
        });
      await load();
      setEditing(false);
      toast.success("Limites salvos. Valem para todos os meses.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="budget-page">
      <div className="page-heading">
        <div>
          <h1>Quanto ainda podemos gastar</h1>
          <p>
            Cada compra conta no mês em que foi feita (parcelas, uma por mês).
            Os limites valem para todo mês.
          </p>
        </div>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>

      {t.budget > 0 ? (
        <section className={"panel budget-hero " + tone(t.percent)}>
          <span className="budget-hero-label">
            {t.remaining >= 0
              ? "Ainda dá para gastar"
              : "Passamos do planejado"}
          </span>
          <strong className="budget-hero-value">
            {money(Math.abs(t.remaining))}
          </strong>
          <Bar percent={t.percent} />
          <span className="budget-hero-detail">
            {money(t.spentInBudgeted)} de {money(t.budget)} planejados
            {t.unbudgetedSpent > 0 &&
              " · + " + money(t.unbudgetedSpent) + " fora dos limites"}
          </span>
        </section>
      ) : (
        !editing && (
          <section className="panel">
            <EmptyState
              text="Defina quanto vocês podem gastar por mês em cada categoria. Depois de cada lançamento, o Telegram avisa quanto ainda sobra."
              action={<Button onClick={startEditing}>Definir limites</Button>}
            />
          </section>
        )
      )}

      {invoices.length > 0 && (
        <div className="budget-invoices">
          {invoices.map((i) => {
            const card = data.cards.find((c) => c.id === i.cardId);
            return (
              <button
                key={i.id}
                className="panel budget-invoice"
                onClick={() => navigate("/faturas?month=" + month)}
              >
                <CreditCard size={18} />
                <span>
                  Fatura {card?.name}
                  <small>{i.status}</small>
                </span>
                <strong>{money(i.total)}</strong>
              </button>
            );
          })}
        </div>
      )}

      <section className="panel">
        <div className="panel-heading">
          <h2>{editing ? "Limites por mês" : "Por categoria"}</h2>
          {editing ? (
            <div className="budget-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X size={16} /> Cancelar
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Check size={16} /> Salvar
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil size={15} /> Ajustar limites
            </Button>
          )}
        </div>
        {editing ? (
          <ul className="budget-list">
            {status.categories
              .filter((c) => !c.income || c.budget != null)
              .map((c) => (
                <li key={c.id} className="budget-row">
                  <CategoryIcon icon={c.icon} color={c.color} square />
                  <span className="budget-name">
                    {c.name}
                    <small>gastos: {money(c.spent)}</small>
                  </span>
                  <label className="budget-input">
                    <span>R$</span>
                    <input
                      inputMode="decimal"
                      placeholder="livre"
                      aria-label={"Limite de " + c.name}
                      value={drafts[c.id] ?? ""}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [c.id]: e.target.value })
                      }
                    />
                  </label>
                </li>
              ))}
          </ul>
        ) : (
          <ul className="budget-list">
            {budgeted.map((c) => (
              <li key={c.id} className={"budget-row " + tone(c.percent)}>
                <CategoryIcon icon={c.icon} color={c.color} square />
                <span className="budget-name">
                  {c.name}
                  <Bar percent={c.percent} />
                  <small>
                    {money(c.spent)} de {money(c.budget!)}
                  </small>
                </span>
                <span className="budget-left">
                  <strong>{money(Math.abs(c.remaining!))}</strong>
                  <small>{c.remaining! >= 0 ? "restam" : "acima"}</small>
                </span>
              </li>
            ))}
            {free.length > 0 && (
              <li className="budget-divider">Sem limite definido</li>
            )}
            {free.map((c) => (
              <li key={c.id} className="budget-row">
                <CategoryIcon icon={c.icon} color={c.color} square />
                <span className="budget-name">{c.name}</span>
                <span className="budget-left">
                  <strong>{money(c.spent)}</strong>
                  <small>gasto</small>
                </span>
              </li>
            ))}
            {!budgeted.length && !free.length && (
              <li className="budget-divider">Nenhum gasto neste mês ainda.</li>
            )}
          </ul>
        )}
      </section>

      <section className="panel budget-tip">
        <Send size={18} />
        <p>
          <strong>Lançar é pelo Telegram.</strong> Escreva “mercado 120” ou
          “farmácia 90 em 3x”, ou mande o print da fatura do cartão. O bot lança
          as compras, inclusive as parcelas, e responde quanto ainda sobra. Use
          /saldo a qualquer momento.
        </p>
      </section>
    </div>
  );
}
