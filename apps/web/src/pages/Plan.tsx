import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Coins, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type {
  FeatureKey,
  Overview,
} from "../../../../packages/shared/src/types";
import { api } from "@/lib/api";
import { money } from "@/lib/utils";
import { ChartCard, EmptyState, LoadingSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";

interface PlanInfo {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  monthlyCredits: number;
  unlimited: boolean;
  features: FeatureKey[];
  highlight: boolean;
}
interface Billing {
  plan: {
    id: string;
    name: string;
    unlimited: boolean;
    monthlyCredits: number;
    expiresAt: string | null;
    renewsAt: string | null;
  };
  credits: number;
  lowCredit: boolean;
  features: FeatureKey[];
  creditCosts: {
    text: number;
    receipt: number;
    statement: number;
    coach: number;
  };
  plans: PlanInfo[];
  creditPacks: { id: string; credits: number; priceCents: number }[];
  featureLabels: Record<FeatureKey, string>;
  upgrade: { contactUrl: string; message: string };
  aiEnabled: boolean;
  ledger: {
    id: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    note: string | null;
    createdAt: string;
  }[];
}

export const reasonLabels: Record<string, string> = {
  BONUS_CADASTRO: "Boas-vindas",
  USO_TEXTO: "Lançamento por texto",
  USO_COMPROVANTE: "Leitura de comprovante",
  USO_FATURA: "Importação de fatura",
  USO_ANALISE: "Análise com IA",
  ESTORNO: "Devolvido",
  PLANO_MENSAL: "Créditos do plano",
  PLANO_ATIVADO: "Plano ativado",
  AJUSTE_ADMIN: "Ajuste do suporte",
  COMPRA: "Compra de créditos",
};
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const times = (credits: number, cost: number) =>
  cost ? Math.floor(credits / cost) : Infinity;

function contact(upgrade: Billing["upgrade"], what: string) {
  if (upgrade.contactUrl) window.open(upgrade.contactUrl, "_blank", "noopener");
  else toast.info(upgrade.message || "Fale com a gente para " + what + ".");
}

export function PlanPage({ refresh }: { refresh: () => Promise<void> }) {
  const [b, setB] = useState<Billing | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Billing>("/billing")
      .then((r) => {
        setB(r);
        void refresh();
      })
      .catch((e) => setError((e as Error).message));
    // refresh atualiza o saldo do cabeçalho; roda só na abertura da tela.
  }, []);
  if (error) return <EmptyState text={error} />;
  if (!b) return <LoadingSkeleton />;
  const c = b.creditCosts;
  return (
    <div className="plan-page">
      <div className="page-heading">
        <div>
          <h1>Plano e créditos</h1>
          <p>
            Créditos pagam a leitura por IA no Telegram e na análise do mês.
          </p>
        </div>
      </div>
      <section className="plan-hero panel">
        <div>
          <span className="plan-hero-label">Seu plano</span>
          <strong className="plan-hero-name">{b.plan.name}</strong>
          <small>
            {b.plan.expiresAt
              ? "Válido até " + date(b.plan.expiresAt)
              : b.plan.renewsAt
                ? "Próxima recarga em " + date(b.plan.renewsAt)
                : b.plan.id === "FREE"
                  ? "Sem mensalidade"
                  : ""}
          </small>
        </div>
        <div className={"plan-credits" + (b.lowCredit ? " low" : "")}>
          <Coins size={22} />
          <div>
            <strong>{b.plan.unlimited ? "Ilimitado" : b.credits}</strong>
            <span>{b.plan.unlimited ? "uso de IA" : "créditos"}</span>
          </div>
        </div>
        {!b.plan.unlimited && (
          <ul className="plan-math">
            <li>
              ≈ <strong>{times(b.credits, c.text)}</strong> gastos por texto (
              {c.text} cada)
            </li>
            <li>
              ≈ <strong>{times(b.credits, c.receipt)}</strong> comprovantes (
              {c.receipt} cada)
            </li>
            <li>
              ≈ <strong>{times(b.credits, c.statement)}</strong> faturas
              importadas ({c.statement} cada)
            </li>
          </ul>
        )}
        {!b.aiEnabled && (
          <p className="form-error">
            A leitura por IA está pausada pelo suporte no momento.
          </p>
        )}
      </section>

      <h2 className="plan-section-title">Planos</h2>
      <div className="plan-grid">
        {b.plans.map((p) => {
          const current = p.id === b.plan.id;
          return (
            <article
              key={p.id}
              className={
                "plan-card panel" +
                (p.highlight ? " highlight" : "") +
                (current ? " current" : "")
              }
            >
              {p.highlight && <span className="plan-tag">Mais completo</span>}
              <h3>{p.name}</h3>
              <p className="plan-price">
                {p.priceCents ? (
                  <>
                    {money(p.priceCents)}
                    <small>/mês</small>
                  </>
                ) : (
                  <>
                    R$ 0<small>/mês</small>
                  </>
                )}
              </p>
              <p className="plan-desc">{p.description}</p>
              <p className="plan-credits-line">
                <Coins size={15} />
                {p.unlimited
                  ? "IA ilimitada"
                  : p.monthlyCredits
                    ? p.monthlyCredits + " créditos por mês"
                    : "Créditos de boas-vindas"}
              </p>
              <ul className="plan-features">
                {(Object.keys(b.featureLabels) as FeatureKey[]).map((f) => (
                  <li key={f} className={p.features.includes(f) ? "" : "off"}>
                    {p.features.includes(f) ? (
                      <Check size={15} />
                    ) : (
                      <Lock size={14} />
                    )}
                    {b.featureLabels[f]}
                  </li>
                ))}
              </ul>
              <Button
                variant={
                  current ? "outline" : p.highlight ? "default" : "outline"
                }
                disabled={current}
                onClick={() => contact(b.upgrade, "assinar o plano " + p.name)}
              >
                {current ? "Plano atual" : "Quero este plano"}
              </Button>
            </article>
          );
        })}
      </div>

      {b.creditPacks.length > 0 && (
        <>
          <h2 className="plan-section-title">Comprar créditos avulsos</h2>
          <div className="pack-grid">
            {b.creditPacks.map((p) => (
              <button
                key={p.id}
                className="pack-card panel"
                onClick={() => contact(b.upgrade, "comprar créditos")}
              >
                <strong>{p.credits} créditos</strong>
                <span>{money(p.priceCents)}</span>
                <small>
                  {money(Math.round(p.priceCents / p.credits))} por crédito
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      {b.upgrade.message && <p className="plan-note">{b.upgrade.message}</p>}

      <ChartCard title="Histórico de créditos">
        {b.ledger.length ? (
          <table className="plan-ledger">
            <thead>
              <tr>
                <th>Data</th>
                <th>Movimento</th>
                <th>Créditos</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {b.ledger.map((l) => (
                <tr key={l.id}>
                  <td>{date(l.createdAt)}</td>
                  <td>
                    {reasonLabels[l.reason] || l.reason}
                    {l.note ? <small> · {l.note}</small> : null}
                  </td>
                  <td
                    className={
                      l.delta > 0 ? "positive" : l.delta < 0 ? "negative" : ""
                    }
                  >
                    {l.delta > 0 ? "+" + l.delta : l.delta}
                  </td>
                  <td>{l.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nenhum movimento ainda.</p>
        )}
      </ChartCard>
    </div>
  );
}

const demos: Record<
  FeatureKey,
  { title: string; text: string; bullets: string[] }
> = {
  financialHealth: {
    title: "Saúde financeira",
    text: "Uma nota para a saúde financeira da casa, reserva de emergência, metas e um plano mês a mês.",
    bullets: [
      "Quanto da renda vai para o essencial, o lazer e o futuro",
      "Reserva de emergência com meta em meses de custo",
      "Objetivos da casa e de cada um, com simulação",
    ],
  },
  coach: {
    title: "Análise do mês com IA",
    text: "Uma explicação em português do que aconteceu no mês e do que ajustar.",
    bullets: ["Resumo do mês", "Pontos de atenção", "Sugestões práticas"],
  },
  reports: {
    title: "Relatórios",
    text: "Para onde foi o dinheiro: por categoria, por pessoa e mês a mês.",
    bullets: [
      "Gastos por categoria e por pessoa",
      "Evolução dos últimos meses",
      "Exportação em CSV",
    ],
  },
  planning: {
    title: "Planejamento e calendário",
    text: "Contas a pagar e a receber, recorrências e o calendário do mês.",
    bullets: [
      "Boletos e contas fixas com lembrete",
      "Recorrências automáticas",
      "Calendário com vencimentos",
    ],
  },
  telegramText: { title: "Lançar por texto", text: "", bullets: [] },
  telegramReceipt: { title: "Ler comprovantes", text: "", bullets: [] },
  statementImport: { title: "Importar fatura", text: "", bullets: [] },
};

/** Mostra a função quando o plano inclui; senão, uma demonstração com convite para assinar. */
export function FeatureGate({
  data,
  feature,
  children,
}: {
  data: Overview;
  feature: FeatureKey;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  if (data.household.features.includes(feature)) return <>{children}</>;
  const demo = demos[feature];
  return (
    <div className="feature-demo">
      <div className="feature-demo-preview" aria-hidden>
        {[72, 48, 90, 35, 64, 80].map((w, i) => (
          <div key={i} className="feature-demo-row">
            <span style={{ width: w + "%" }} />
          </div>
        ))}
      </div>
      <div className="feature-demo-card panel">
        <span className="feature-demo-badge">
          <Sparkles size={15} /> Demonstração
        </span>
        <h1>{demo.title}</h1>
        <p>{demo.text}</p>
        <ul>
          {demo.bullets.map((b) => (
            <li key={b}>
              <Check size={15} />
              {b}
            </li>
          ))}
        </ul>
        <p className="muted">
          Disponível em um plano pago. Você está no plano{" "}
          {data.household.planName}.
        </p>
        <Button onClick={() => navigate("/plano")}>Ver planos</Button>
      </div>
    </div>
  );
}
