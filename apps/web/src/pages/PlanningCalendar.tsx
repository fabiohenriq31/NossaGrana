import { useState } from "react";
import { Plus, RefreshCw, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import type {
  Overview,
  Transaction,
  Invoice,
} from "../../../../packages/shared/src/types";
import { Button } from "@/components/ui/button";
import {
  ChartCard,
  EmptyState,
  MonthSelector,
  CurrencyValue,
} from "@/components/common";
import { UpcomingBill } from "./Dashboard";
import { upcoming, summary } from "@/lib/finance";
import { api } from "@/lib/api";
import { today, dateLabel } from "@/lib/utils";
export function PlanningPage({
  data,
  month,
  setMonth,
  onNew,
  onEdit,
  onPay,
  refresh,
}: {
  data: Overview;
  month: string;
  setMonth: (m: string) => void;
  onNew: () => void;
  onEdit: (t: Transaction) => void;
  onPay: (i: Invoice) => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [type, setType] = useState("all");
  const s = summary(data, month);
  const bills = upcoming(data, month).filter(
    (b) =>
      type === "all" ||
      (b.kind === "invoice" && type === "DESPESA") ||
      data.transactions.find((t) => t.id === b.id)?.type === type,
  );
  async function generate() {
    setBusy(true);
    try {
      const result = await api<{ count: number }>("/recurrences/generate", {
        method: "POST",
        body: JSON.stringify({
          until:
            month +
            "-" +
            new Date(
              Number(month.slice(0, 4)),
              Number(month.slice(5)),
              0,
            ).getDate(),
        }),
      });
      await refresh();
      toast.success(result.count + " ocorrências geradas.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Planejamento</h1>
          <p>Nossos compromissos, com tranquilidade.</p>
        </div>
        <Button onClick={onNew}>
          <Plus size={17} />
          Novo compromisso
        </Button>
      </div>
      <div className="planning-summary">
        <ChartCard title="Contas a pagar">
          <CurrencyValue value={s.payable + s.invoices} className="expense" />
        </ChartCard>
        <ChartCard title="Contas a receber">
          <CurrencyValue value={s.receivable} className="income" />
        </ChartCard>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>
      <div className="planning-grid">
        <ChartCard
          title="Próximos vencimentos"
          action={
            <select
              aria-label="Filtrar compromissos"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="DESPESA">A pagar</option>
              <option value="RECEITA">A receber</option>
            </select>
          }
        >
          {bills.length ? (
            bills.map((b) => (
              <UpcomingBill
                key={b.id}
                bill={b}
                onClick={() =>
                  b.kind === "invoice"
                    ? onPay(data.invoices.find((i) => i.id === b.id)!)
                    : onEdit(data.transactions.find((t) => t.id === b.id)!)
                }
              />
            ))
          ) : (
            <EmptyState text="Nenhum compromisso pendente." />
          )}
        </ChartCard>
        <ChartCard
          title="Recorrências"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={generate}
              disabled={busy}
            >
              <RefreshCw size={13} />
              {busy ? "Gerando…" : "Gerar mês"}
            </Button>
          }
        >
          {data.recurrences.map((r) => (
            <div key={r.id} className="recurrence-row">
              <RefreshCw size={18} />
              <span>
                <strong>{r.description}</strong>
                <small>
                  {{
                    MENSAL: "Mensal",
                    SEMANAL: "Semanal",
                    ANUAL: "Anual",
                    PERSONALIZADA: "Personalizada",
                  }[r.frequency] || r.frequency}{" "}
                  · Próxima: {dateLabel(r.nextDate)}
                </small>
                <small>{r.active ? "Ativa" : "Pausada"}</small>
              </span>
              <CurrencyValue value={r.amount} />
              <Button
                variant="ghost"
                size="icon"
                aria-label={(r.active ? "Pausar " : "Retomar ") + r.description}
                onClick={async () => {
                  try {
                    await api("/recurrences/" + r.id, {
                      method: "PATCH",
                      body: JSON.stringify({ active: !r.active }),
                    });
                    await refresh();
                    toast.success(
                      r.active
                        ? "Recorrência pausada."
                        : "Recorrência retomada.",
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                {r.active ? <Pause size={16} /> : <Play size={16} />}
              </Button>
            </div>
          ))}
          {!data.recurrences.length && (
            <EmptyState text="Crie um compromisso e escolha a opção Repetir." />
          )}
        </ChartCard>
      </div>
    </>
  );
}
export function CalendarPage({
  data,
  month,
  setMonth,
  onEdit,
  onPay,
}: {
  data: Overview;
  month: string;
  setMonth: (s: string) => void;
  onEdit: (t: Transaction) => void;
  onPay: (i: Invoice) => void;
}) {
  const [selected, setSelected] = useState(Number(today().slice(-2)));
  const first = new Date(month + "-01T12:00:00"),
    days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const movements = data.transactions.filter(
    (t) => t.status !== "CANCELADA" && t.date.slice(0, 7) === month,
  );
  const invoices = data.invoices.filter((i) => i.dueDate.slice(0, 7) === month);
  const selectedDate =
    month + "-" + String(Math.min(selected, days)).padStart(2, "0");
  const items = movements.filter((t) => t.date.slice(0, 10) === selectedDate),
    due = invoices.filter((i) => i.dueDate.slice(0, 10) === selectedDate);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Calendário</h1>
          <p>Veja seus compromissos.</p>
        </div>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>
      <div className="calendar-layout">
        <section className="panel calendar">
          <div className="calendar-grid weekdays">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: first.getDay() }, (_, i) => (
              <span key={"pad" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1,
                date = month + "-" + String(day).padStart(2, "0"),
                ts = movements.filter(
                  (t) =>
                    t.status !== "CANCELADA" && t.date.slice(0, 10) === date,
                ),
                isDue = invoices.some((t) => t.dueDate.slice(0, 10) === date);
              return (
                <button
                  key={day}
                  className={
                    (day === selected ? "selected " : "") +
                    (date === today() ? "today" : "")
                  }
                  onClick={() => setSelected(day)}
                  aria-label={"Dia " + day}
                  aria-pressed={day === selected}
                >
                  <b>{day}</b>
                  <span className="calendar-dots">
                    {ts.some((t) => t.type === "RECEITA") && (
                      <i className="green" />
                    )}
                    {ts.some((t) => t.type === "DESPESA") && (
                      <i className="red" />
                    )}
                    {ts.some((t) => t.type === "TRANSFERENCIA") && (
                      <i className="blue" />
                    )}
                    {isDue && <i className="purple" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="calendar-key">
            <span>● Receitas</span>
            <span>● Despesas</span>
            <span>● Faturas</span>
          </div>
        </section>
        <ChartCard title={"Movimentações · " + dateLabel(selectedDate)}>
          {items.map((t) => (
            <button
              className="calendar-item"
              key={t.id}
              onClick={() => onEdit(t)}
            >
              <span>
                <strong>{t.description}</strong>
                <small>
                  {t.owner} ·{" "}
                  {t.status === "PENDENTE" ? "Pendente" : "Confirmada"}
                </small>
              </span>
              <CurrencyValue
                value={t.amount}
                className={
                  t.type === "RECEITA"
                    ? "income"
                    : t.type === "TRANSFERENCIA"
                      ? "transfer"
                      : "expense"
                }
              />
            </button>
          ))}
          {due.map((i) => (
            <button
              className="calendar-item"
              key={i.id}
              onClick={() => onPay(i)}
            >
              <span>
                Fatura {data.cards.find((c) => c.id === i.cardId)?.name}
              </span>
              <CurrencyValue value={i.remaining} />
            </button>
          ))}
          {!items.length && !due.length && (
            <EmptyState text="Dia livre de movimentações." />
          )}
        </ChartCard>
      </div>
    </>
  );
}
