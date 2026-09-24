import { Prisma, type TransactionSuggestion } from "@prisma/client";
import { prisma, atomic } from "../../db";
import { createTransaction, fail } from "../../service";
import {
  transactionInput,
  paymentMethod,
  day,
  person,
} from "../../../../../packages/shared/src/validation";
import {
  moneyToCents,
  civilDate,
  sanitizeExtraction,
  identifierHash,
  type Analysis,
  type Extraction,
  type TextAnalysis,
} from "./analyzer";
import { safeText, IntegrationError } from "./config";
import { identity } from "./identity";
export const pendingStatuses = ["PENDING", "NEEDS_REVIEW"] as const;
const normalize = (s: string | null | undefined) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
type Named = { id: string; name: string };
export function uniqueMatch<T>(
  items: T[],
  match: (item: T) => boolean,
): T | null {
  const matches = items.filter(match);
  return matches.length === 1 ? matches[0] : null;
}
export function categoryMatch<T extends Named>(
  items: T[],
  text: string | null,
) {
  return text
    ? uniqueMatch(items, (item) => normalize(item.name) === normalize(text))
    : null;
}
// Só as palavras citadas na mensagem podem selecionar uma conta ativa deste núcleo.
export function matchTextAccount<
  T extends Named & { owner: string; bank: { name: string } },
>(accounts: T[], hint: string | null, message: string) {
  const stopWords = new Set([
    "a",
    "o",
    "as",
    "os",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "no",
    "na",
    "em",
    "para",
    "pro",
    "pra",
    "e",
    "meu",
    "minha",
    "conta",
    "banco",
  ]);
  const tokens = words(hint || "").filter((w) => !stopWords.has(w));
  const original = new Set(words(message));
  if (!tokens.length || tokens.some((w) => !original.has(w))) return null;
  const exact = accounts.filter(
    (a) => words(a.name).join(" ") === words(hint || "").join(" "),
  );
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  return uniqueMatch(accounts, (a) => {
    const label = new Set(words(a.name + " " + a.owner + " " + a.bank.name));
    return tokens.every((w) => label.has(w));
  });
}
// Correspondência por palavras completas: nunca usar substring ("Ana" ≠ "Mariana").
const words = (value: string) =>
  normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
export function bankKey(value: string | null | undefined) {
  const legal = new Set([
    "banco",
    "bank",
    "s",
    "a",
    "sa",
    "ltda",
    "instituicao",
    "de",
    "do",
    "da",
    "pagamento",
    "pagamentos",
    "financeira",
  ]);
  const key = words(value || "")
    .filter((word) => !legal.has(word))
    .join(" ");
  const aliases: Record<string, string> = {
    nu: "nubank",
    "itau unibanco": "itau",
  };
  return aliases[key] || key;
}
export function matchedOwner(receiptName: string, owners: string[]) {
  const received = words(receiptName);
  const scores = [...new Set(owners)].map((owner) => {
    const known = words(owner);
    const exact =
      known.length === received.length &&
      known.every((word, index) => word === received[index]);
    const prefix =
      known.length < received.length &&
      known.every((word, index) => word === received[index]);
    const score = exact
      ? 3
      : prefix && known[0]?.length >= 3 && normalize(owner) !== "casa"
        ? 1
        : 0;
    return { owner, score };
  });
  const best = Math.max(0, ...scores.map((candidate) => candidate.score));
  return best
    ? uniqueMatch(scores, (candidate) => candidate.score === best)?.owner ||
        null
    : null;
}
async function defaultCategory(householdId: string) {
  // Exceção explícita solicitada pelo usuário: somente a categoria reservada Outros.
  const existing = await prisma.category.findFirst({
    where: { householdId, name: { equals: "Outros", mode: "insensitive" } },
  });
  return (
    existing ||
    prisma.category.upsert({
      where: { householdId_name: { householdId, name: "Outros" } },
      update: {},
      create: { householdId, name: "Outros", icon: "wallet", color: "#ffb547" },
    })
  );
}
export async function householdChoices(householdId: string) {
  const [accounts, cards, categories, users] = await Promise.all([
    prisma.account.findMany({
      where: { householdId, active: true },
      include: { bank: true },
    }),
    prisma.creditCard.findMany({
      where: { householdId, active: true },
      include: { bank: true },
    }),
    prisma.category.findMany({
      where: { householdId },
      include: { subcategories: true },
    }),
    prisma.user.findMany({ where: { householdId }, select: { name: true } }),
  ]);
  return { accounts, cards, categories, users };
}
export function matchExtraction(
  e: Extraction,
  choices: {
    accounts: { id: string; owner: string; bank: { name: string } }[];
    cards: {
      id: string;
      owner: string;
      bank: { name: string };
      last4: string;
    }[];
    categories: {
      id: string;
      name: string;
      subcategories: { id: string; name: string }[];
    }[];
    users: { name: string }[];
  },
) {
  const bank = bankKey(e.bankName);
  const owner = e.transactionType === "INCOME" ? e.recipientName : e.payerName;
  const accountOwner = owner
    ? matchedOwner(
        owner,
        choices.accounts.map((a) => a.owner),
      )
    : null;
  const cardOwner = owner
    ? matchedOwner(
        owner,
        choices.cards.map((c) => c.owner),
      )
    : null;
  const account = uniqueMatch(
    choices.accounts,
    (a) =>
      !!bank &&
      bankKey(a.bank.name) === bank &&
      (!owner || a.owner === accountOwner),
  );
  const card =
    e.cardLast4 && /^\d{4}$/.test(e.cardLast4)
      ? uniqueMatch(
          choices.cards,
          (c) =>
            c.last4 === e.cardLast4 &&
            (!bank || bankKey(c.bank.name) === bank) &&
            (!owner || c.owner === cardOwner),
        )
      : null;
  const recognizedCategory = categoryMatch(
    choices.categories,
    e.categorySuggestion,
  );
  const category =
    recognizedCategory || categoryMatch(choices.categories, "Outros");
  const subcategory = recognizedCategory
    ? categoryMatch(recognizedCategory.subcategories, e.subcategorySuggestion)
    : null;
  const ownName = (name: string | null) =>
    !!name && choices.users.some((u) => normalize(u.name) === normalize(name));
  const isOwnTransfer = ownName(e.payerName) && ownName(e.recipientName);
  const type =
    isOwnTransfer || e.transactionType === "TRANSFER"
      ? "TRANSFERENCIA"
      : e.transactionType === "EXPENSE"
        ? "DESPESA"
        : e.transactionType === "INCOME"
          ? "RECEITA"
          : null;
  const reasons = [
    ...e.uncertainFields.slice(0, 20).map((x) => safeText(x, 80) || ""),
  ];
  if (e.needsReview || e.confidence < 0.8)
    reasons.push("Confira todos os campos extraídos.");
  if (e.currency !== "BRL") reasons.push("currency");
  const count = e.totalInstallments || e.installments || 1;
  if (
    count > 1 ||
    (e.currentInstallment || 1) > 1 ||
    e.amountMeaning !== "TOTAL"
  )
    reasons.push("installments");
  return {
    suggestedType: type,
    suggestedDescription: safeText(e.description || e.merchantName, 160),
    suggestedAmount: moneyToCents(e.amount),
    suggestedDate: civilDate(e.transactionDate),
    suggestedPaymentMethod: e.paymentMethod,
    suggestedAccountId:
      e.paymentMethod === "CREDITO" ? null : account?.id || null,
    suggestedCreditCardId:
      e.paymentMethod === "CREDITO" ? card?.id || null : null,
    suggestedDestinationAccountId: null as string | null,
    suggestedCategoryId: category?.id || null,
    suggestedSubcategoryId: subcategory?.id || null,
    suggestedOwner: (card || account)?.owner || null,
    installments:
      count >= 1 && count <= 120 && Number.isInteger(count) ? count : 1,
    reviewReasons: reasons,
  } satisfies Partial<TransactionSuggestion>;
}
export function toInput(s: TransactionSuggestion) {
  return transactionInput.safeParse({
    description: s.suggestedDescription,
    amount: s.suggestedAmount,
    date: s.suggestedDate?.toISOString().slice(0, 10),
    type: s.suggestedType,
    paymentMethod: s.suggestedPaymentMethod,
    owner: s.suggestedOwner,
    accountId: s.suggestedAccountId,
    cardId: s.suggestedCreditCardId,
    destinationAccountId: s.suggestedDestinationAccountId,
    categoryId: s.suggestedCategoryId,
    subcategoryId: s.suggestedSubcategoryId,
    installments: s.installments,
    status: s.suggestedStatus,
    notes: "",
    tags: [],
  });
}
export async function saveSuggestion(
  userId: string,
  householdId: string,
  attachmentId: string | null,
  updateId: string,
  analysis: Analysis,
  textInput?: { analysis: TextAnalysis; message: string },
) {
  const extraction = sanitizeExtraction(analysis.extraction);
  const choices = await householdChoices(householdId);
  if (
    !categoryMatch(choices.categories, extraction.categorySuggestion) &&
    !categoryMatch(choices.categories, "Outros")
  ) {
    const fallback = await defaultCategory(householdId);
    choices.categories.push({ ...fallback, subcategories: [] });
  }
  const matched = matchExtraction(extraction, choices);
  if (textInput) {
    const metadata = textInput.analysis.text;
    if (metadata.eventCount !== "SINGLE")
      fail("Envie um lançamento por mensagem.");
    const account = matchTextAccount(
      choices.accounts,
      metadata.accountHint,
      textInput.message,
    );
    const destination = matchTextAccount(
      choices.accounts,
      metadata.destinationAccountHint,
      textInput.message,
    );
    matched.suggestedAccountId =
      extraction.paymentMethod === "CREDITO" ? null : account?.id || null;
    // Não inferir a conta de texto usando apenas o banco extraído pelo modelo.
    matched.suggestedOwner =
      extraction.paymentMethod === "CREDITO"
        ? matched.suggestedOwner
        : account?.owner || null;
    matched.suggestedDestinationAccountId =
      matched.suggestedType === "TRANSFERENCIA"
        ? destination?.id || null
        : null;
  }
  const identifier = identifierHash(analysis.extraction);
  const duplicateById = identifier
    ? await prisma.transactionSuggestion.findFirst({
        where: {
          householdId,
          transactionIdentifierHash: identifier,
          status: "CONFIRMED",
        },
      })
    : null;
  const candidates =
    matched.suggestedAmount && matched.suggestedDate
      ? await prisma.transaction.findMany({
          where: {
            householdId,
            amount: matched.suggestedAmount,
            date: {
              gte: new Date(
                matched.suggestedDate.toISOString().slice(0, 10) + "T00:00:00Z",
              ),
              lt: new Date(matched.suggestedDate.getTime() + 12 * 3600000),
            },
            status: { not: "CANCELADA" },
          },
          take: 100,
        })
      : [];
  const possibleDuplicate =
    !!duplicateById ||
    candidates.some(
      (t) =>
        normalize(t.description) === normalize(matched.suggestedDescription) ||
        (!!matched.suggestedAccountId &&
          t.accountId === matched.suggestedAccountId) ||
        (!!matched.suggestedCreditCardId &&
          t.cardId === matched.suggestedCreditCardId),
    );
  return prisma.transactionSuggestion.create({
    data: {
      ...matched,
      suggestedStatus: textInput
        ? textInput.analysis.text.transactionStatus === "UNKNOWN"
          ? null
          : textInput.analysis.text.transactionStatus
        : "CONFIRMADA",
      userId,
      householdId,
      attachmentId,
      updateId,
      confidence: Math.max(0, Math.min(1, analysis.extraction.confidence)),
      rawExtraction: extraction as Prisma.InputJsonValue,
      transactionIdentifierHash: identifier,
      possibleDuplicate,
      status: "NEEDS_REVIEW",
      needsReview: true,
      expiresAt: new Date(Date.now() + 7 * 86400000),
      model: analysis.model,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      totalTokens: analysis.totalTokens,
    },
  });
}
export async function ownedSuggestion(senderId: string, id: string) {
  const who = await identity(senderId);
  if (!who)
    throw new IntegrationError(
      "UNLINKED",
      "Conecte o Telegram nas Configurações do Coflu.",
    );
  const s = await prisma.transactionSuggestion.findFirst({
    where: { id, userId: who.userId, householdId: who.user.householdId },
  });
  if (!s)
    throw new IntegrationError(
      "SUGGESTION_ACCESS",
      "Sugestão indisponível para este usuário.",
    );
  return { s, who };
}
export async function confirmSuggestion(
  senderId: string,
  id: string,
  version: number,
) {
  return atomic(async (tx) => {
    const who = await tx.telegramIdentity.findFirst({
      where: { telegramUserId: senderId, verified: true },
      include: { user: { include: { household: true } } },
    });
    if (!who || who.user.household.mode !== (process.env.APP_MODE || "REAL"))
      fail("Telegram não conectado.", 403);
    const s = await tx.transactionSuggestion.findFirst({
      where: { id, userId: who.userId, householdId: who.user.householdId },
    });
    if (!s) fail("Sugestão indisponível.", 404);
    if (s.status === "CONFIRMED")
      return {
        already: true,
        ids: (
          await tx.transaction.findMany({
            where: { suggestionId: id },
            select: { id: true },
          })
        ).map((x) => x.id),
      };
    if (
      !pendingStatuses.includes(s.status as (typeof pendingStatuses)[number]) ||
      s.expiresAt <= new Date()
    )
      fail("Esta sugestão está encerrada.");
    if (s.version !== version)
      fail("O resumo mudou. Confira a versão mais recente.");
    if (s.reviewReasons.includes("installments"))
      fail("Edite o valor TOTAL e as parcelas antes de confirmar.");
    if (s.reviewReasons.includes("currency"))
      fail("Somente valores em reais são aceitos. Corrija o valor em BRL.");
    const parsed = toInput(s);
    if (!parsed.success)
      fail(
        "Complete os campos: " +
          parsed.error.issues.map((x) => x.message).join(" "),
      );
    const claimed = await tx.transactionSuggestion.updateMany({
      where: { id, version, status: { in: [...pendingStatuses] } },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        needsReview: false,
        version: { increment: 1 },
      },
    });
    if (!claimed.count) fail("Sugestão já processada.");
    // Único ponto de criação financeira da integração. Mesma transação serializável da confirmação.
    const rows = await createTransaction(
      tx,
      who.user.householdId,
      parsed.data,
      { source: "TELEGRAM" },
    );
    await tx.transaction.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { suggestionId: id },
    });
    if (s.attachmentId)
      await tx.attachment.update({
        where: { id: s.attachmentId },
        data: { transactionId: rows[0].id, expiresAt: null },
      });
    return { already: false, ids: rows.map((r) => r.id) };
  });
}
export async function rejectSuggestion(
  senderId: string,
  id: string,
  version: number,
) {
  const { s } = await ownedSuggestion(senderId, id);
  const result = await prisma.transactionSuggestion.updateMany({
    where: { id: s.id, version, status: { in: [...pendingStatuses] } },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      version: { increment: 1 },
    },
  });
  return result.count > 0;
}
export const editFields = [
  "description",
  "amount",
  "date",
  "type",
  "status",
  "paymentMethod",
  "account",
  "destination",
  "card",
  "category",
  "subcategory",
  "owner",
  "installments",
] as const;
export type EditField = (typeof editFields)[number];
export async function editSuggestion(
  senderId: string,
  id: string,
  version: number,
  field: EditField,
  value: string,
) {
  const { s, who } = await ownedSuggestion(senderId, id);
  const changes: Prisma.TransactionSuggestionUncheckedUpdateManyInput = {};
  if (field === "status") {
    if (value !== "CONFIRMADA" && value !== "PENDENTE")
      fail("Situação inválida.");
    changes.suggestedStatus = value;
  }
  if (field === "description") {
    const text = safeText(value.trim(), 160);
    if (!text || text.length < 2)
      fail("Informe uma descrição com pelo menos 2 caracteres.");
    changes.suggestedDescription = text;
  }
  if (field === "amount") {
    const amount = moneyToCents(value.trim());
    if (!amount) fail("Informe o valor total em reais, por exemplo 187,42.");
    changes.suggestedAmount = amount;
  }
  if (field === "date") {
    day.parse(value);
    changes.suggestedDate = civilDate(value);
  }
  if (field === "installments") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 120)
      fail("Informe de 1 a 120 parcelas.");
    changes.installments = n;
  }
  if (field === "type") {
    if (!["DESPESA", "RECEITA", "TRANSFERENCIA"].includes(value))
      fail("Tipo inválido.");
    changes.suggestedType = value as "DESPESA";
    changes.suggestedDestinationAccountId = null;
    changes.suggestedCreditCardId = null;
    changes.installments = 1;
    changes.suggestedPaymentMethod = null;
  }
  if (field === "paymentMethod") {
    changes.suggestedPaymentMethod = paymentMethod.parse(value);
    if (value === "CREDITO") changes.suggestedAccountId = null;
    else {
      changes.suggestedCreditCardId = null;
      changes.installments = 1;
    }
  }
  if (field === "owner") changes.suggestedOwner = person.parse(value);
  if (
    ["account", "destination", "card", "category", "subcategory"].includes(
      field,
    )
  ) {
    const c = await householdChoices(who.user.householdId);
    if (field === "account" || field === "destination") {
      const a = c.accounts.find((a) => a.id === value);
      if (!a) fail("Conta indisponível.");
      if (field === "account") {
        changes.suggestedAccountId = a.id;
        changes.suggestedOwner = a.owner;
        changes.suggestedCreditCardId = null;
      } else changes.suggestedDestinationAccountId = a.id;
    }
    if (field === "card") {
      const card = c.cards.find((c) => c.id === value);
      if (!card) fail("Cartão indisponível.");
      changes.suggestedCreditCardId = card.id;
      changes.suggestedAccountId = null;
      changes.suggestedOwner = card.owner;
      changes.suggestedPaymentMethod = "CREDITO";
      changes.suggestedType = "DESPESA";
    }
    if (field === "category") {
      if (!c.categories.some((c) => c.id === value))
        fail("Categoria indisponível.");
      changes.suggestedCategoryId = value;
      changes.suggestedSubcategoryId = null;
    }
    if (field === "subcategory") {
      if (
        !c.categories
          .find((c) => c.id === s.suggestedCategoryId)
          ?.subcategories.some((c) => c.id === value)
      )
        fail("Subcategoria indisponível.");
      changes.suggestedSubcategoryId = value;
    }
  }
  // Valor revisado é explicitamente em BRL; parcelas só são liberadas após revisar ambos os campos.
  const reasons = s.reviewReasons.filter(
    (r) => !(field === "amount" && r === "currency"),
  );
  if (field === "amount") reasons.push("amountReviewed");
  if (field === "installments") reasons.push("installmentsReviewed");
  if (
    reasons.includes("amountReviewed") &&
    reasons.includes("installmentsReviewed")
  ) {
    const index = reasons.indexOf("installments");
    if (index >= 0) reasons.splice(index, 1);
  }
  const result = await prisma.transactionSuggestion.updateMany({
    where: {
      id,
      userId: who.userId,
      version,
      status: { in: [...pendingStatuses] },
      expiresAt: { gt: new Date() },
    },
    data: {
      ...changes,
      reviewReasons: [...new Set(reasons)],
      version: { increment: 1 },
    },
  });
  if (!result.count)
    fail("O resumo mudou ou expirou. Use o resumo mais recente.");
  return prisma.transactionSuggestion.findUniqueOrThrow({ where: { id } });
}
