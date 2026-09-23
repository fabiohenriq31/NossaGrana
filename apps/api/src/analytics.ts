import type {
  Overview,
  Analytics,
  Summary,
} from "../../../packages/shared/src/types";
import { accountBalance } from "./domain";
type Data = Omit<Overview, "analytics">;
const amount = (rows: { amount: number }[]) =>
  rows.reduce((s, t) => s + t.amount, 0);
function monthly(data: Data, month: string): Summary {
  const end = month + "-31",
    all = data.transactions.filter(
      (t) =>
        t.competence === month &&
        !t.paymentInvoiceId &&
        t.status !== "CANCELADA",
    ),
    confirmed = all.filter((t) => t.status === "CONFIRMADA"),
    pending = all.filter((t) => t.status === "PENDENTE" && !t.cardId);
  const income = amount(confirmed.filter((t) => t.type === "RECEITA")),
    expenses = amount(confirmed.filter((t) => t.type === "DESPESA"));
  return {
    balance: data.accounts
      .filter((a) => a.openingDate.slice(0, 10) <= end)
      .reduce(
        (s, a) =>
          s +
          accountBalance(
            a.initialBalance,
            a.id,
            data.transactions.filter(
              (t) =>
                t.date.slice(0, 10) <= end &&
                t.date.slice(0, 10) >= a.openingDate.slice(0, 10),
            ),
          ),
        0,
      ),
    income,
    expenses,
    result: income - expenses,
    payable: amount(pending.filter((t) => t.type === "DESPESA")),
    receivable: amount(pending.filter((t) => t.type === "RECEITA")),
    payableCount: pending.filter((t) => t.type === "DESPESA").length,
    receivableCount: pending.filter((t) => t.type === "RECEITA").length,
    invoices: data.invoices
      .filter((i) => i.competence === month)
      .reduce((s, i) => s + i.remaining, 0),
  };
}
export function analytics(data: Data, month: string): Analytics {
  const d = new Date(month + "-01T12:00:00Z");
  const previous = new Date(d);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const expenses = data.transactions.filter(
      (t) =>
        t.competence === month &&
        t.type === "DESPESA" &&
        t.status === "CONFIRMADA" &&
        !t.paymentInvoiceId,
    ),
    total = amount(expenses);
  const values = data.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      value: amount(expenses.filter((t) => t.categoryId === c.id)),
    }))
    .filter((c) => c.value > 0);
  const uncategorized = amount(expenses.filter((t) => !t.categoryId));
  if (uncategorized)
    values.push({
      id: "uncategorized",
      name: "Sem categoria",
      color: "#8f9bac",
      value: uncategorized,
    });
  const history = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(d);
    date.setUTCMonth(date.getUTCMonth() - 5 + i);
    const key = date.toISOString().slice(0, 7),
      s = monthly(data, key);
    return {
      month: key,
      name: date
        .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
        .replace(".", ""),
      receitas: s.income,
      despesas: s.expenses,
    };
  });
  const wealth = history.map((h) => {
    const end = h.month + "-31";
    const debt =
      data.invoices
        .filter(
          (i) =>
            i.openingBalanceDate && i.openingBalanceDate.slice(0, 10) <= end,
        )
        .reduce((sum, i) => sum + i.openingBalance, 0) +
      amount(
        data.transactions.filter(
          (t) =>
            t.cardId &&
            t.status === "CONFIRMADA" &&
            (t.purchaseDate || t.date).slice(0, 10) <= end,
        ),
      ) -
      amount(
        data.transactions.filter(
          (t) =>
            t.paymentInvoiceId &&
            t.status === "CONFIRMADA" &&
            t.date.slice(0, 10) <= end,
        ),
      );
    return { name: h.name, value: monthly(data, h.month).balance - debt };
  });
  return {
    accountTotal: data.accounts.reduce((s, a) => s + a.balance, 0),
    month,
    summary: monthly(data, month),
    previous: monthly(data, previous.toISOString().slice(0, 7)),
    history,
    categorySpending: values.map((c) => ({
      ...c,
      percentage: total ? Math.round((c.value / total) * 100) : 0,
    })),
    personSpending: ["Fábio", "Bianca", "Casa"].map((name) => {
      const value = amount(expenses.filter((t) => t.owner === name));
      return {
        name,
        value,
        percentage: total ? Math.round((value / total) * 100) : 0,
      };
    }),
    wealth,
  };
}
