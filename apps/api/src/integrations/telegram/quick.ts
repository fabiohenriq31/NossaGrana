import type { Prisma, TransactionSuggestion } from "@prisma/client";
import { prisma, atomic } from "../../db";
import { protectInvoice, fail } from "../../service";
import { budgetStatus, budgetLines, brl, monthLabel } from "../../budget";
import { confirmSuggestion, householdChoices } from "./suggestions";
import { identity } from "./identity";
import type { Extraction } from "./analyzer";
import type { Keyboard } from "./providers";

/**
 * Lançamento rápido: quando a mensagem ou o comprovante já trazem tudo o que é necessário,
 * a despesa é salva sem perguntas e o usuário recebe um "Desfazer". Qualquer dúvida
 * (duplicata, moeda, parcela ambígua, conta ou cartão indefinidos) volta ao fluxo de revisão.
 */
export const QUICK_MIN_CONFIDENCE = 0.6;

type Choices = Awaited<ReturnType<typeof householdChoices>>;
const walletTypes = ["Carteira", "Dinheiro"];

export function defaultPayment(
  choices: Pick<Choices, "accounts" | "cards">,
  userName: string,
  method: string | null,
): {
  cardId?: string;
  accountId?: string;
  owner: string;
  paymentMethod: string;
} | null {
  const single = <T extends { owner: string }>(items: T[]) => {
    const mine = items.filter((i) => i.owner === userName);
    return mine.length === 1 ? mine[0] : items.length === 1 ? items[0] : null;
  };
  if (!method || method === "OUTRO" || method === "CREDITO") {
    // A casa usa o cartão para quase tudo: sem forma de pagamento citada, vai para o cartão.
    const card = single(choices.cards);
    return card
      ? {
          cardId: card.id,
          owner: card.owner,
          paymentMethod: "CREDITO",
        }
      : null;
  }
  const pool =
    method === "DINHEIRO"
      ? choices.accounts.filter((a) => walletTypes.includes(a.type))
      : choices.accounts.filter(
          (a) => !walletTypes.includes(a.type) && a.type !== "Investimento",
        );
  const account = single(pool);
  return account
    ? { accountId: account.id, owner: account.owner, paymentMethod: method }
    : null;
}

/** Ajusta a sugestão para lançamento direto ou devolve null para seguir a revisão. */
export function quickChanges(
  s: TransactionSuggestion,
  extraction: Extraction,
  choices: Pick<Choices, "accounts" | "cards">,
  userName: string,
): Prisma.TransactionSuggestionUncheckedUpdateManyInput | null {
  if (s.suggestedType !== "DESPESA" || !s.suggestedAmount || !s.suggestedDate)
    return null;
  if (s.possibleDuplicate || s.confidence < QUICK_MIN_CONFIDENCE) return null;
  if (s.suggestedStatus === "PENDENTE") return null;
  if (s.reviewReasons.includes("currency") || extraction.currency !== "BRL")
    return null;
  const changes: Prisma.TransactionSuggestionUncheckedUpdateManyInput = {
    suggestedStatus: "CONFIRMADA",
  };
  if (!s.suggestedAccountId && !s.suggestedCreditCardId) {
    const payment = defaultPayment(choices, userName, s.suggestedPaymentMethod);
    if (!payment) return null;
    changes.suggestedCreditCardId = payment.cardId || null;
    changes.suggestedAccountId = payment.accountId || null;
    changes.suggestedOwner = payment.owner;
    changes.suggestedPaymentMethod = payment.paymentMethod as "CREDITO";
  } else if (!s.suggestedOwner) return null;
  const isCard = Boolean(
    changes.suggestedCreditCardId ?? s.suggestedCreditCardId,
  );
  const count = s.installments;
  if (s.reviewReasons.includes("installments") || count > 1) {
    if (!isCard || count < 2 || (extraction.currentInstallment || 1) > 1)
      return null;
    if (extraction.amountMeaning === "INSTALLMENT")
      changes.suggestedAmount = s.suggestedAmount * count;
    else if (extraction.amountMeaning !== "TOTAL") return null;
  }
  changes.reviewReasons = s.reviewReasons.filter((r) => r !== "installments");
  return changes;
}

export async function tryQuickConfirm(
  senderId: string,
  s: TransactionSuggestion,
): Promise<{ text: string; keyboard: Keyboard } | null> {
  const who = await identity(senderId);
  if (!who || who.userId !== s.userId) return null;
  const choices = await householdChoices(s.householdId);
  const changes = quickChanges(
    s,
    s.rawExtraction as unknown as Extraction,
    choices,
    who.user.name,
  );
  if (!changes) return null;
  const updated = await prisma.transactionSuggestion.updateMany({
    where: {
      id: s.id,
      version: s.version,
      status: { in: ["NEEDS_REVIEW", "PENDING"] },
    },
    data: { ...changes, version: { increment: 1 } },
  });
  if (!updated.count) return null;
  let ids: string[];
  try {
    ({ ids } = await confirmSuggestion(senderId, s.id, s.version + 1));
  } catch {
    return null; // Ex.: limite do cartão. A sugestão segue para revisão normal.
  }
  return quickReceipt(s.householdId, s.id, ids);
}

export async function quickReceipt(
  householdId: string,
  suggestionId: string,
  ids: string[],
  heading = "✅ Lançado",
) {
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: { card: true, account: true, category: true },
    orderBy: { date: "asc" },
  });
  const first = rows[0];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const status = await budgetStatus(
    householdId,
    first.date.toISOString().slice(0, 7),
  );
  const where = first.card
    ? "💳 " +
      first.card.name +
      (first.card.last4 ? " final " + first.card.last4 : "") +
      " · fatura de " +
      monthLabel(first.competence)
    : "🏦 " + (first.account?.name || "Conta");
  const text = [
    heading + ": " + (first.description.replace(/ 1\/\d+$/, "") || "Despesa"),
    "💰 " +
      brl(total) +
      (rows.length > 1
        ? " em " + rows.length + "x de " + brl(first.amount)
        : ""),
    where,
    "",
    ...budgetLines(status, rows.map((r) => r.categoryId || "").filter(Boolean)),
  ].join("\n");
  const keyboard: Keyboard = [
    [
      { text: "↩️ Desfazer", callback_data: "q:u:" + suggestionId },
      { text: "🏷 Trocar categoria", callback_data: "q:c:" + suggestionId },
    ],
  ];
  return { text, keyboard };
}

async function ownedQuick(senderId: string, suggestionId: string) {
  const who = await identity(senderId);
  if (!who) fail("Conecte o Telegram nas Configurações do Coflu.", 403);
  const s = await prisma.transactionSuggestion.findFirst({
    where: {
      id: suggestionId,
      userId: who.userId,
      householdId: who.user.householdId,
      status: "CONFIRMED",
    },
  });
  if (!s) fail("Lançamento indisponível.", 404);
  return { who, s };
}

export async function undoQuick(senderId: string, suggestionId: string) {
  const { s } = await ownedQuick(senderId, suggestionId);
  return atomic(async (tx) => {
    const rows = await tx.transaction.findMany({
      where: {
        suggestionId: s.id,
        householdId: s.householdId,
        status: { not: "CANCELADA" },
      },
    });
    for (const r of rows) await protectInvoice(tx, r.invoiceId);
    await tx.transaction.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "CANCELADA", cancelledAt: new Date() },
    });
    return rows.length;
  });
}

export async function quickCategories(senderId: string, suggestionId: string) {
  const { s } = await ownedQuick(senderId, suggestionId);
  const categories = await prisma.category.findMany({
    where: { householdId: s.householdId },
    orderBy: { name: "asc" },
  });
  const keyboard: Keyboard = [];
  for (let i = 0; i < categories.length && i < 60; i += 2)
    keyboard.push(
      categories.slice(i, i + 2).map((c) => ({
        text: c.name.slice(0, 30),
        callback_data: "q:s:" + s.id + ":" + c.id,
      })),
    );
  return keyboard;
}

export async function recategorizeQuick(
  senderId: string,
  suggestionId: string,
  categoryId: string,
) {
  const { s } = await ownedQuick(senderId, suggestionId);
  const category = await prisma.category.findFirst({
    where: { id: categoryId, householdId: s.householdId },
  });
  if (!category) fail("Categoria indisponível.");
  const rows = await prisma.transaction.findMany({
    where: {
      suggestionId: s.id,
      householdId: s.householdId,
      status: { not: "CANCELADA" },
    },
    select: { id: true },
  });
  if (!rows.length) fail("Este lançamento foi desfeito.");
  await prisma.transaction.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { categoryId: category.id, subcategoryId: null },
  });
  return quickReceipt(
    s.householdId,
    s.id,
    rows.map((r) => r.id),
    "🏷 Categoria trocada para " + category.name,
  );
}
