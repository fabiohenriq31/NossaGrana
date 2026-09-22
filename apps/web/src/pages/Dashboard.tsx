import { useNavigate } from "react-router-dom";
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartNoAxesCombined,
  ReceiptText,
  CalendarClock,
  ArrowUp,
  ChevronRight,
  Bell,
  ArrowLeftRight,
  CreditCard,
  Ellipsis,
} from "lucide-react";
import type {
  Overview,
  Transaction,
} from "../../../../packages/shared/src/types";
import { summary, upcoming, monthTransactions } from "@/lib/finance";
import { money, dateLabel } from "@/lib/utils";
import {
  BankLogo,
  CategoryIcon,
  ChartCard,
  EmptyState,
  MonthSelector,
} from "@/components/common";
import {
  CashflowChart,
  CategoryChart,
  PersonSpending,
} from "@/components/Charts";
import { TransactionList } from "@/components/Transactions";
import { CreditCardVisual } from "@/components/CreditCardVisual";
import { Button } from "@/components/ui/button";
export function UpcomingBill({
  bill,
  onClick,
}: {
  bill: ReturnType<typeof upcoming>[number];
  onClick: () => void;
}) {
  const d = new Date(bill.date);
  return (
    <button className="bill-row" onClick={onClick}>
      <span className="bill-date">
        <b>{d.getUTCDate()}</b>
        <small>
          {d
            .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
            .replace(".", "")}
        </small>
      </span>
      {bill.bank ? (
        <BankLogo bank={bill.bank} />
      ) : (
        <CategoryIcon icon={bill.icon} color={bill.color} square />
      )}
      <span className="row-description">
        <strong>{bill.title}</strong>
        <small>{bill.subtitle}</small>
      </span>
      <strong className="currency">{money(bill.amount)}</strong>
    </button>
  );
}
export function Dashboard({
  data,
  month,
  setMonth,
  onNew,
  onEdit,
  onNotifications,
}: {
  data: Overview;
  month: string;
  setMonth: (v: string) => void;
  onNew: () => void;
  onEdit: (t: Transaction) => void;
  onNotifications: () => void;
}) {
  const navigate = useNavigate(),
    s = summary(data, month),
    bills = upcoming(data, month),
    card = data.cards[0];
  const previous = new Date(month + "-01T12:00:00");
  previous.setMonth(previous.getMonth() - 1);
  const prev = summary(data, previous.toLocaleDateString("sv-SE").slice(0, 7));
  const variation = (v: number, p: number) =>
    p
      ? (((v - p) / Math.abs(p)) * 100).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        }) + "%"
      : "—";
  const metrics = [
    {
      title: "Saldo total",
      value: s.balance,
      icon: Wallet,
      color: "purple",
      hint: "Saldo das contas",
      path: "/contas",
    },
    {
      title: "Receitas do mês",
      value: s.income,
      icon: ArrowDownToLine,
      color: "green",
      hint: variation(s.income, prev.income),
      path: "/transacoes",
    },
    {
      title: "Despesas do mês",
      value: s.expenses,
      icon: ArrowUpFromLine,
      color: "red",
      hint: variation(s.expenses, prev.expenses),
      path: "/transacoes",
    },
    {
      title: "Resultado do mês",
      value: s.result,
      icon: ChartNoAxesCombined,
      color: "green",
      hint: variation(s.result, prev.result),
      path: "/relatorios",
    },
    {
      title: "Próximas faturas",
      value: s.invoices,
      icon: ReceiptText,
      color: "orange",
      hint:
        data.invoices.filter((i) => i.competence === month && i.remaining > 0)
          .length + " cartões",
      path: "/faturas",
    },
    {
      title: "Contas a pagar",
      value: s.payable,
      icon: CalendarClock,
      color: "red",
      hint: s.payableCount + " contas",
      path: "/planejamento",
    },
    {
      title: "Contas a receber",
      value: s.receivable,
      icon: Wallet,
      color: "cyan",
      hint: s.receivableCount + " recebimentos",
      path: "/planejamento",
    },
  ];
  const link = (label: string, path: string) => (
    <Button variant="outline" size="sm" onClick={() => navigate(path)}>
      {label}
    </Button>
  );
  return (
    <>
      <div className="desktop-dashboard">
        <div className="page-heading">
          <div>
            <h1>
              Olá, {data.user.name}! <span className="wave">👋</span>
            </h1>
            <p>Aqui está um resumo das nossas finanças.</p>
          </div>
          <MonthSelector month={month} setMonth={setMonth} />
        </div>
        <div className="summary-grid">
          {metrics.map((m, i) => (
            <button
              key={m.title}
              className="summary-card"
              onClick={() => navigate(m.path)}
            >
              <span className="summary-title">{m.title}</span>
              <div className="summary-value">
                <span className={"summary-icon " + m.color}>
                  <m.icon size={17} />
                </span>
                <strong>{money(m.value)}</strong>
              </div>
              <span
                className={
                  "summary-hint " +
                  (i === 1 || i === 3 ? "positive" : i === 2 ? "negative" : "")
                }
              >
                {i > 0 && i < 4 && <ArrowUp size={12} />} {m.hint}
              </span>
            </button>
          ))}
        </div>
        <div className="dashboard-grid">
          <ChartCard
            title="Receitas x Despesas"
            action={
              <div className="chart-legend">
                <span>
                  <i />
                  Receitas
                </span>
                <span>
                  <i />
                  Despesas
                </span>
              </div>
            }
          >
            <CashflowChart data={data} month={month} />
          </ChartCard>
          <ChartCard
            title="Gastos por categoria"
            action={link("Ver detalhes", "/relatorios")}
          >
            <CategoryChart data={data} month={month} />
          </ChartCard>
          <ChartCard title="Gastos por pessoa">
            <PersonSpending data={data} month={month} />
          </ChartCard>
          <ChartCard
            title="Próximos vencimentos"
            action={link("Ver todos", "/planejamento")}
            className="list-panel"
          >
            {bills.length ? (
              bills
                .slice(0, 4)
                .map((b) => (
                  <UpcomingBill
                    key={b.id}
                    bill={b}
                    onClick={() =>
                      b.kind === "invoice"
                        ? navigate("/faturas")
                        : onEdit(data.transactions.find((t) => t.id === b.id)!)
                    }
                  />
                ))
            ) : (
              <EmptyState
                text={
                  data.accounts.length
                    ? "Tudo em dia por aqui."
                    : "Adicione sua primeira conta e informe o saldo inicial."
                }
                action={
                  !data.accounts.length
                    ? link("Cadastrar primeira conta", "/contas")
                    : undefined
                }
              />
            )}
          </ChartCard>
          <ChartCard
            title="Últimas transações"
            action={link("Ver todas", "/transacoes")}
            className="list-panel"
          >
            {!data.transactions.length && (
              <Button variant="ghost" size="sm" onClick={onNew}>
                Cadastrar receita ou despesa
              </Button>
            )}
            <TransactionList
              transactions={monthTransactions(data, month)
                .filter((t) => t.status === "CONFIRMADA")
                .sort((a, b) => b.date.localeCompare(a.date))}
              data={data}
              onClick={onEdit}
              limit={4}
            />
          </ChartCard>
          <ChartCard
            title="Meus cartões"
            action={link("Ver todos", "/cartoes")}
            className="cards-panel"
          >
            {card ? (
              <CreditCardVisual
                card={card}
                invoice={data.invoices.find(
                  (i) => i.cardId === card.id && i.competence === month,
                )}
              />
            ) : (
              <EmptyState
                text="Cadastre seu primeiro cartão."
                action={link("Adicionar cartão", "/cartoes")}
              />
            )}
          </ChartCard>
        </div>
        <footer className="dashboard-footer">
          MAIS CONTROLE. MAIS TRANQUILIDADE. JUNTOS. <span>♥</span>
        </footer>
      </div>
      <div className="mobile-dashboard">
        <header>
          <div>
            <small>
              Olá, {data.user.name}! <span>👋</span>
            </small>
            <h1>NossaGrana!</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notificações mobile"
            onClick={onNotifications}
          >
            <Bell size={21} />
          </Button>
        </header>
        <button
          className="mobile-balance panel"
          onClick={() => navigate("/contas")}
        >
          <CategoryIcon icon="wallet" square color="#26b486" />
          <div>
            <span>Saldo total</span>
            <strong>{money(s.balance)}</strong>
          </div>
          <ChevronRight size={17} />
        </button>
        <div className="mobile-shortcuts">
          {(
            [
              ["Transação", ArrowLeftRight, onNew],
              ["Conta", Wallet, () => navigate("/contas")],
              ["Cartão", CreditCard, () => navigate("/cartoes")],
              ["Mais", Ellipsis, () => navigate("/planejamento")],
            ] as const
          ).map(([label, Icon, action]) => (
            <button key={label as string} onClick={action as () => void}>
              <span>{typeof Icon !== "string" && <Icon size={22} />}</span>
              {label as string}
            </button>
          ))}
        </div>
        <ChartCard title="Gastos do mês">
          <div className="mobile-expenses">
            <strong>{money(s.expenses)}</strong>
            <span className="negative">
              ↑ {variation(s.expenses, prev.expenses)}
            </span>
          </div>
          <CashflowChart data={data} month={month} compact />
        </ChartCard>
        <ChartCard
          title="Próximos vencimentos"
          action={
            <button
              aria-label="Ver todos os vencimentos"
              onClick={() => navigate("/planejamento")}
            >
              <ChevronRight size={17} />
            </button>
          }
        >
          {bills.slice(0, 4).map((b) => (
            <button
              key={b.id}
              className="mobile-bill"
              onClick={() =>
                b.kind === "invoice"
                  ? navigate("/faturas")
                  : onEdit(data.transactions.find((t) => t.id === b.id)!)
              }
            >
              {b.bank ? (
                <BankLogo bank={b.bank} />
              ) : (
                <CategoryIcon icon={b.icon} color={b.color} square />
              )}
              <span>
                <strong>{b.title}</strong>
                <small>{dateLabel(b.date)}</small>
              </span>
              <b>{money(b.amount)}</b>
            </button>
          ))}
          {!bills.length && (
            <EmptyState
              text={
                data.accounts.length
                  ? "Tudo em dia."
                  : "Comece pela sua primeira conta e seu saldo inicial."
              }
              action={
                !data.accounts.length
                  ? link("Cadastrar conta", "/contas")
                  : undefined
              }
            />
          )}
        </ChartCard>
        <MonthSelector month={month} setMonth={setMonth} />
      </div>
    </>
  );
}
