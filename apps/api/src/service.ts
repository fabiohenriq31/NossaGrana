import { Prisma } from "@prisma/client";
import { atomic, prisma } from "./db";
import {
  transactionInput,
  type TransactionInput,
} from "../../../packages/shared/src/validation";
import {
  accountBalance,
  addMonths,
  invoiceDates,
  splitInstallments,
  nextOccurrence,
} from "./domain";
import { analytics } from "./analytics";
import type { Overview } from "../../../packages/shared/src/types";
export function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
export async function owned(
  tx: Prisma.TransactionClient,
  model:
    | "account"
    | "creditCard"
    | "category"
    | "transaction"
    | "recurringTransaction",
  id: string,
  householdId: string,
) {
  const row = await (
    tx[model] as unknown as {
      findFirst: (v: unknown) => Promise<{ id: string; active?: boolean }>;
    }
  ).findFirst({ where: { id, householdId } });
  if (!row) fail("Registro não encontrado.", 404);
  return row;
}
export async function validateReferences(
  tx: Prisma.TransactionClient,
  householdId: string,
  v: TransactionInput,
) {
  for (const id of [v.accountId, v.destinationAccountId])
    if (id) {
      await owned(tx, "account", id, householdId);
      const a = await tx.account.findUniqueOrThrow({ where: { id } });
      if (!a.active) fail("A conta está arquivada.");
      if (v.date < a.openingDate.toISOString().slice(0, 10))
        fail("A movimentação não pode ser anterior à data do saldo inicial.");
      if (
        v.paymentMethod === "DINHEIRO" &&
        !["Carteira", "Dinheiro"].includes(a.type)
      )
        fail("Pagamento em dinheiro exige uma conta Dinheiro ou Carteira.");
    }
  if (v.cardId) {
    const c = await owned(tx, "creditCard", v.cardId, householdId);
    if (!c.active) fail("O cartão está arquivado.");
  }
  if (v.categoryId) await owned(tx, "category", v.categoryId, householdId);
  if (
    v.subcategoryId &&
    !(await tx.subcategory.findFirst({
      where: { id: v.subcategoryId, categoryId: v.categoryId! },
    }))
  )
    fail("Subcategoria inválida.");
}
export async function cardUsed(
  tx: Prisma.TransactionClient,
  cardId: string,
  exclude?: string,
) {
  const rows = await tx.transaction.findMany({
    where: {
      OR: [{ cardId }, { paymentInvoice: { cardId } }],
      status: "CONFIRMADA",
      ...(exclude ? { id: { not: exclude } } : {}),
    },
  });
  return rows.reduce(
    (s, t) => s + (t.paymentInvoiceId ? -t.amount : t.amount),
    0,
  );
}
export async function protectInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string | null,
) {
  if (
    invoiceId &&
    (await tx.transaction.count({
      where: { paymentInvoiceId: invoiceId, status: "CONFIRMADA" },
    }))
  )
    fail(
      "Esta fatura possui pagamentos. Estorne os pagamentos antes de alterar suas compras.",
    );
}
export async function createTransaction(
  tx: Prisma.TransactionClient,
  h: string,
  v: TransactionInput,
  extra: {
    recurringId?: string;
    occurrenceDate?: Date;
    source?: "AUTOMACAO" | "TELEGRAM";
  } = {},
  existingId?: string,
) {
  await validateReferences(tx, h, v);
  const old = existingId
    ? await tx.transaction.findFirst({
        where: { id: existingId, householdId: h },
      })
    : null;
  if (existingId && !old) fail("Registro não encontrado.", 404);
  if (old) {
    if (old.status === "CANCELADA")
      fail("Lançamentos cancelados são preservados para consulta.");
    if (old.paymentInvoiceId) fail("Estorne o pagamento para corrigi-lo.");
    await protectInvoice(tx, old.invoiceId);
    if (v.installments !== 1)
      fail(
        "Edite uma parcela por vez ou cancele a compra e cadastre novamente.",
      );
    if (
      old.installmentPurchaseId &&
      (v.cardId !== old.cardId ||
        v.date !== old.date.toISOString().slice(0, 10))
    )
      fail(
        "Mantenha cartão e data da parcela; valor, categoria e descrição podem ser corrigidos.",
      );
  }
  const { installments, ...input } = v,
    date = new Date(v.date + "T12:00:00Z"),
    card = v.cardId
      ? await tx.creditCard.findUniqueOrThrow({ where: { id: v.cardId } })
      : null;
  if (
    card &&
    v.status === "CONFIRMADA" &&
    (await cardUsed(tx, card.id, old?.id)) + v.amount > card.limit
  )
    fail("Esta compra ultrapassa o limite disponível do cartão.");
  const purchase =
    installments > 1
      ? await tx.installmentPurchase.create({
          data: {
            cardId: v.cardId!,
            description: v.description,
            totalAmount: v.amount,
            installments,
            purchasedAt: date,
          },
        })
      : null;
  const result = [];
  for (const [i, amount] of splitInstallments(
    v.amount,
    installments,
  ).entries()) {
    const effective = addMonths(date, i);
    let invoiceId = old?.installmentPurchaseId ? old.invoiceId : null,
      competence = old?.installmentPurchaseId
        ? old.competence
        : effective.toISOString().slice(0, 7);
    if (card && !old?.installmentPurchaseId) {
      const first = invoiceDates(date, card.closingDay, card.dueDay),
        dates = invoiceDates(
          addMonths(first.closingDate, i, card.closingDay),
          card.closingDay,
          card.dueDay,
        );
      const inv = await tx.invoice.upsert({
        where: {
          cardId_competence: { cardId: card.id, competence: dates.competence },
        },
        create: { cardId: card.id, ...dates },
        update: {},
      });
      invoiceId = inv.id;
      competence = inv.competence;
    }
    const data = {
      ...input,
      ...extra,
      date: effective,
      competence,
      amount,
      invoiceId,
      dueDate: old?.dueDate || (v.status === "PENDENTE" ? date : null),
      installmentPurchaseId: purchase?.id || old?.installmentPurchaseId || null,
      installmentNumber: purchase ? i + 1 : old?.installmentNumber || null,
      description: purchase
        ? v.description + " " + (i + 1) + "/" + installments
        : v.description,
      householdId: h,
    };
    const t = old
      ? await tx.transaction.update({ where: { id: old.id }, data })
      : await tx.transaction.create({ data });
    if (v.type === "TRANSFERENCIA")
      await tx.transfer.upsert({
        where: { transactionId: t.id },
        create: {
          transactionId: t.id,
          fromAccountId: v.accountId!,
          toAccountId: v.destinationAccountId!,
        },
        update: {
          fromAccountId: v.accountId!,
          toAccountId: v.destinationAccountId!,
        },
      });
    else if (old)
      await tx.transfer.deleteMany({ where: { transactionId: old.id } });
    if (purchase)
      await tx.installment.create({
        data: { purchaseId: purchase.id, transactionId: t.id, number: i + 1 },
      });
    if (old?.installmentPurchaseId)
      await tx.installmentPurchase.update({
        where: { id: old.installmentPurchaseId },
        data: { totalAmount: { increment: amount - old.amount } },
      });
    result.push(t);
  }
  for (const name of v.tags)
    await tx.tag.upsert({
      where: { householdId_name: { householdId: h, name } },
      create: { householdId: h, name },
      update: {},
    });
  return result;
}
export async function overview(
  householdId: string,
  user: { id: string; name: string; email: string },
  month: string,
) {
  const [
    accounts,
    cards,
    categories,
    transactions,
    invoiceRows,
    recurrences,
    banks,
  ] = await Promise.all([
    prisma.account.findMany({
      where: { householdId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.creditCard.findMany({
      where: { householdId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.category.findMany({
      where: { householdId },
      include: { subcategories: true },
      orderBy: { name: "asc" },
    }),
    prisma.transaction.findMany({
      where: { householdId },
      include: { installmentPurchase: { select: { purchasedAt: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.invoice.findMany({
      where: { card: { householdId } },
      include: { transactions: true, payments: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.recurringTransaction.findMany({
      where: { householdId },
      orderBy: { nextDate: "asc" },
    }),
    prisma.bank.findMany({ orderBy: { name: "asc" } }),
  ]);
  const invoices = invoiceRows.map(({ transactions, payments, ...i }) => {
    const total = transactions
        .filter((t) => t.status === "CONFIRMADA")
        .reduce((s, t) => s + t.amount, 0),
      paid = payments
        .filter((t) => t.status === "CONFIRMADA")
        .reduce((s, t) => s + t.amount, 0),
      remaining = total - paid;
    return {
      ...i,
      total,
      paid,
      remaining,
      status:
        remaining === 0 && total > 0
          ? "Paga"
          : new Date() > i.dueDate && remaining > 0
            ? "Atrasada"
            : new Date() > i.closingDate
              ? "Fechada"
              : "Aberta",
    };
  });
  const result = {
    user,
    accounts: accounts.map((a) => ({
      ...a,
      balance: accountBalance(
        a.initialBalance,
        a.id,
        transactions.filter((t) => t.date >= a.openingDate),
      ),
    })),
    cards: cards.map((c) => {
      const used = invoices
        .filter((i) => i.cardId === c.id)
        .reduce((s, i) => s + i.remaining, 0);
      return { ...c, used, available: c.limit - used };
    }),
    categories,
    transactions: transactions.map(({ installmentPurchase, ...t }) => ({
      ...t,
      purchaseDate: installmentPurchase?.purchasedAt || t.date,
    })),
    invoices,
    recurrences,
    banks,
  };
  const data = JSON.parse(JSON.stringify(result)) as Omit<
    Overview,
    "analytics"
  >;
  return { ...data, analytics: analytics(data, month) };
}
export async function generateRecurrences(h: string, until: Date) {
  return atomic(async (tx) => {
    const recs = await tx.recurringTransaction.findMany({
      where: { householdId: h, active: true, nextDate: { lte: until } },
    });
    let count = 0;
    for (const r of recs) {
      let next = r.nextDate;
      while (next <= until) {
        if (count >= 1000) fail("Gere um intervalo menor.");
        if (
          !(await tx.transaction.findFirst({
            where: { recurringId: r.id, occurrenceDate: next },
          }))
        ) {
          await createTransaction(
            tx,
            h,
            transactionInput.parse({
              ...(r.template as object),
              date: next.toISOString().slice(0, 10),
              status: "PENDENTE",
            }),
            { recurringId: r.id, occurrenceDate: next, source: "AUTOMACAO" },
          );
          count++;
        }
        next = nextOccurrence(
          next,
          r.frequency,
          r.interval,
          r.anchorDay,
          r.anchorMonth,
        );
      }
      await tx.recurringTransaction.update({
        where: { id: r.id },
        data: { nextDate: next },
      });
    }
    return { count };
  });
}
