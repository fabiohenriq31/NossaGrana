import type {
  Overview,
  Transaction,
} from "../../../../packages/shared/src/types";
import { CategoryIcon, EmptyState, CurrencyValue } from "./common";
import { dateLabel, today } from "@/lib/utils";
export function TransactionItem({
  transaction: t,
  data,
  onClick,
}: {
  transaction: Transaction;
  data: Overview;
  onClick: (t: Transaction) => void;
}) {
  const cat = data.categories.find((c) => c.id === t.categoryId);
  const card = data.cards.find((c) => c.id === t.cardId);
  const account = data.accounts.find((c) => c.id === t.accountId);
  const kind =
    t.type === "TRANSFERENCIA"
      ? "transfer"
      : t.type === "RECEITA"
        ? "income"
        : "expense";
  const label = t.date.slice(0, 10) === today() ? "Hoje" : dateLabel(t.date);
  return (
    <button className="transaction-row" onClick={() => onClick(t)}>
      <span className="date-badge">{label}</span>
      <CategoryIcon
        icon={kind === "transfer" ? "transfer" : cat?.icon}
        color={
          kind === "transfer"
            ? "var(--blue)"
            : kind === "income"
              ? "#47b877"
              : cat?.color || "#a76346"
        }
      />
      <span className="row-description">
        <strong>{t.description}</strong>
        <small>
          {t.paymentInvoiceId
            ? "Pagamento de fatura"
            : cat?.name ||
              {
                income: "Receita",
                expense: "Despesa",
                transfer: "Transferência",
              }[kind]}
          {t.status === "PENDENTE"
            ? " · Pendente"
            : t.status === "CANCELADA"
              ? " · Cancelada"
              : ""}
        </small>
      </span>
      <span className="row-amount">
        <CurrencyValue
          value={t.type === "RECEITA" ? t.amount : -t.amount}
          className={kind}
          signed
        />
        <small>
          {card ? "Cartão • •••• " + card.last4 : account?.name || ""}
        </small>
      </span>
    </button>
  );
}
export function TransactionList({
  transactions,
  data,
  onClick,
  limit,
}: {
  transactions: Transaction[];
  data: Overview;
  onClick: (t: Transaction) => void;
  limit?: number;
}) {
  return transactions.length ? (
    <div className="transaction-list">
      {transactions.slice(0, limit).map((t) => (
        <TransactionItem
          key={t.id}
          transaction={t}
          data={data}
          onClick={onClick}
        />
      ))}
    </div>
  ) : (
    <EmptyState />
  );
}
