import type {
  Overview,
} from "../../../../packages/shared/src/types";
export function monthTransactions(data: Overview, month: string) {
  return data.transactions.filter(
    (t) =>
      t.competence === month && !t.paymentInvoiceId && t.status !== "CANCELADA",
  );
}
export function summary(data: Overview, month: string) {
  return data.analytics.month === month
    ? data.analytics.summary
    : data.analytics.previous;
}
export function chartMonths(data: Overview, _month: string) {
  return data.analytics.history;
}
export function upcoming(data: Overview, month: string) {
  return [
    ...data.transactions
      .filter(
        (t) =>
          t.status === "PENDENTE" &&
          !t.cardId &&
          t.type !== "TRANSFERENCIA" &&
          t.competence === month,
      )
      .map((t) => ({
        id: t.id,
        date: t.date,
        title: t.description,
        subtitle: t.owner,
        amount: t.amount,
        bank: "",
        icon:
          data.categories.find((c) => c.id === t.categoryId)?.icon || "receipt",
        color:
          data.categories.find((c) => c.id === t.categoryId)?.color ||
          "var(--teal)",
        kind: "transaction" as const,
      })),
    ...data.invoices
      .filter((i) => i.remaining > 0 && i.competence === month)
      .map((i) => {
        const c = data.cards.find((c) => c.id === i.cardId)!;
        return {
          id: i.id,
          date: i.dueDate,
          title: "Fatura " + c.name,
          subtitle: "Cartão • •••• " + c.last4,
          amount: i.remaining,
          bank: c.bankId,
          icon: "receipt",
          color: "var(--purple)",
          kind: "invoice" as const,
        };
      }),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
