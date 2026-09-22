export function dateAt(year: number, month: number, day: number) {
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()),
      12,
    ),
  );
}
export function addMonths(
  date: Date,
  count: number,
  anchor = date.getUTCDate(),
) {
  return dateAt(date.getUTCFullYear(), date.getUTCMonth() + count, anchor);
}
export function invoiceDates(date: Date, closingDay: number, dueDay: number) {
  let closing = dateAt(date.getUTCFullYear(), date.getUTCMonth(), closingDay);
  if (date.getUTCDate() > closing.getUTCDate())
    closing = addMonths(closing, 1, closingDay);
  const due = dateAt(
    closing.getUTCFullYear(),
    closing.getUTCMonth() + (dueDay <= closingDay ? 1 : 0),
    dueDay,
  );
  return {
    competence: closing.toISOString().slice(0, 7),
    closingDate: closing,
    dueDate: due,
  };
}
export function splitInstallments(amount: number, count: number) {
  const base = Math.floor(amount / count),
    remainder = amount % count;
  return Array.from(
    { length: count },
    (_, i) => base + (i < remainder ? 1 : 0),
  );
}
export function nextOccurrence(
  date: Date,
  frequency: string,
  interval: number,
  anchorDay: number,
  anchorMonth: number,
) {
  if (frequency === "MENSAL") return addMonths(date, interval, anchorDay);
  if (frequency === "ANUAL")
    return dateAt(date.getUTCFullYear() + interval, anchorMonth, anchorDay);
  const next = new Date(date);
  next.setUTCDate(
    next.getUTCDate() + (frequency === "SEMANAL" ? 7 : 1) * interval,
  );
  return next;
}
export function accountBalance(
  initialBalance: number,
  accountId: string,
  transactions: {
    amount: number;
    status: string;
    cardId: string | null;
    accountId: string | null;
    destinationAccountId: string | null;
    type: string;
  }[],
) {
  return transactions.reduce((sum, t) => {
    if (t.status !== "CONFIRMADA" || t.cardId) return sum;
    return (
      sum +
      (t.accountId === accountId
        ? t.type === "RECEITA"
          ? t.amount
          : -t.amount
        : 0) +
      (t.type === "TRANSFERENCIA" && t.destinationAccountId === accountId
        ? t.amount
        : 0)
    );
  }, initialBalance);
}
