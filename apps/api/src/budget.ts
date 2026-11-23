import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Db = Prisma.TransactionClient | PrismaClient;

/** Mês civil atual em America/Sao_Paulo, no formato YYYY-MM. */
export function currentMonth(now = new Date()) {
  return now
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 7);
}

export function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const monthNames = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const monthLabel = (month: string) =>
  monthNames[Number(month.slice(5, 7)) - 1] + "/" + month.slice(0, 4);

export interface BudgetCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  budget: number | null;
  spent: number;
  remaining: number | null;
  percent: number | null;
  /** Categoria de receita do catálogo padrão: fica fora da tela de limites. */
  income: boolean;
}
const incomeNames = new Set(["salario", "freelance", "rendimentos"]);
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
export interface BudgetStatus {
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

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)),
  };
}

/**
 * Gasto do mês por envelope, pelo mês da compra (cada parcela no seu mês). É a conta
 * que a casa faz no dia a dia; o total da fatura aparece à parte. Considera despesas
 * confirmadas e pendentes (compromissos). Pagamentos de fatura e transferências não
 * contam, para não duplicar a despesa.
 */
export async function budgetStatus(
  householdId: string,
  month = currentMonth(),
  db: Db = prisma,
): Promise<BudgetStatus> {
  const [categories, rows] = await Promise.all([
    db.category.findMany({
      where: { householdId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        icon: true,
        monthlyBudget: true,
      },
    }),
    db.transaction.groupBy({
      by: ["categoryId"],
      where: {
        householdId,
        date: monthRange(month),
        type: "DESPESA",
        status: { in: ["CONFIRMADA", "PENDENTE"] },
        paymentInvoiceId: null,
      },
      _sum: { amount: true },
    }),
  ]);
  const spentBy = new Map(rows.map((r) => [r.categoryId, r._sum.amount || 0]));
  const list: BudgetCategory[] = categories.map((c) => {
    const spent = spentBy.get(c.id) || 0,
      budget = c.monthlyBudget;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      budget,
      spent,
      remaining: budget == null ? null : budget - spent,
      percent: budget ? Math.round((spent / budget) * 100) : null,
      income: incomeNames.has(plain(c.name)),
    };
  });
  const budgeted = list.filter((c) => c.budget != null);
  const budget = budgeted.reduce((s, c) => s + (c.budget || 0), 0);
  const spentInBudgeted = budgeted.reduce((s, c) => s + c.spent, 0);
  const spent = [...spentBy.values()].reduce((s, v) => s + v, 0);
  return {
    month,
    categories: list.sort(
      (a, b) =>
        Number(b.budget != null) - Number(a.budget != null) ||
        (b.percent ?? -1) - (a.percent ?? -1) ||
        b.spent - a.spent,
    ),
    totals: {
      budget,
      spentInBudgeted,
      remaining: budget - spentInBudgeted,
      spent,
      unbudgetedSpent: spent - spentInBudgeted,
      percent: budget ? Math.round((spentInBudgeted / budget) * 100) : null,
    },
  };
}

/** Linhas curtas para o Telegram depois de um lançamento. */
export function budgetLines(status: BudgetStatus, categoryIds: string[]) {
  const lines: string[] = [];
  for (const id of [...new Set(categoryIds)]) {
    const c = status.categories.find((x) => x.id === id);
    if (!c) continue;
    if (c.budget == null)
      lines.push(
        "🏷 " +
          c.name +
          ": " +
          brl(c.spent) +
          " no mês (sem limite definido no app)",
      );
    else if (c.remaining! < 0)
      lines.push(
        "🚨 " +
          c.name +
          ": passou " +
          brl(-c.remaining!) +
          " do limite de " +
          brl(c.budget),
      );
    else
      lines.push(
        (c.percent! >= 80 ? "⚠️ " : "🟢 ") +
          c.name +
          ": restam " +
          brl(c.remaining!) +
          " de " +
          brl(c.budget) +
          (c.percent! >= 80 ? " (" + c.percent + "% usado)" : ""),
      );
  }
  const t = status.totals;
  if (t.budget > 0)
    lines.push(
      (t.remaining < 0 ? "🚨 " : t.percent! >= 80 ? "⚠️ " : "📊 ") +
        "Total de " +
        monthLabel(status.month) +
        ": " +
        (t.remaining < 0
          ? "passou " + brl(-t.remaining) + " do planejado"
          : "restam " + brl(t.remaining) + " de " + brl(t.budget)),
    );
  return lines;
}
