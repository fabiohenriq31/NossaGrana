import type { CreditCard, Prisma } from "@prisma/client";
import { prisma, atomic } from "../../db";
import { createTransaction, fail } from "../../service";
import { transactionInput } from "../../../../../packages/shared/src/validation";
import { addMonths, dateAt, invoiceDates } from "../../domain";
import { budgetStatus, budgetLines, brl, monthLabel } from "../../budget";
import { hash, safeText } from "./config";
import {
  bankKey,
  categoryMatch,
  defaultCategory,
  householdChoices,
  uniqueMatch,
} from "./suggestions";
import { civilDate, moneyToCents, type Statement } from "./analyzer";
import type { Keyboard } from "./providers";

/**
 * Importação de fatura/lista de compras do cartão enviada como print ou PDF.
 * Fica guardada em ExternalImport até o usuário tocar em "Lançar"; tudo é criado numa
 * única transação. Compras parceladas recebem só as parcelas que ainda faltam, a partir
 * da fatura importada, e cada compra só é importada uma vez (chave por cartão).
 */
export interface ImportItem {
  date: string;
  description: string;
  amount: number;
  current: number | null;
  total: number | null;
  categoryId: string;
}
export interface ImportPayload {
  userId: string;
  cardId: string | null;
  bankName: string | null;
  cardLast4: string | null;
  closingDate: string | null;
  dueDate: string | null;
  items: ImportItem[];
  ignored: { payments: number; refunds: number; unreadable: number };
  attachmentId: string | null;
  keys?: string[];
  transactionIds?: string[];
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, " ")
    .replace(/parcela|parc\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function itemKey(cardId: string, i: ImportItem) {
  // Parcelas: a chave não usa data nem número da parcela, para que a fatura do mês
  // seguinte (4/10) não recrie a compra lançada a partir da 3/10.
  return hash(
    i.total && i.total > 1
      ? [cardId, normalize(i.description), i.amount, i.total].join("|")
      : [cardId, normalize(i.description), i.amount, i.date].join("|"),
  );
}

export async function buildPayload(
  householdId: string,
  userId: string,
  statement: Statement,
  today: string,
  attachmentId: string | null,
): Promise<ImportPayload> {
  const choices = await householdChoices(householdId);
  const fallback =
    categoryMatch(choices.categories, "Outros") ||
    (await defaultCategory(householdId));
  const ignored = { payments: 0, refunds: 0, unreadable: 0 };
  const items: ImportItem[] = [];
  for (const row of statement.items.slice(0, 200)) {
    if (row.kind === "PAYMENT") ignored.payments++;
    else if (row.kind === "REFUND") ignored.refunds++;
    if (row.kind !== "PURCHASE" && row.kind !== "FEE") continue;
    const amount = moneyToCents(row.amount);
    const description = safeText(row.description.trim(), 140);
    if (!amount || !description || description.length < 2) {
      ignored.unreadable++;
      continue;
    }
    const date = civilDate(row.date)?.toISOString().slice(0, 10) || today;
    const cur = row.currentInstallment,
      tot = row.totalInstallments;
    const installment =
      cur && tot && tot > 1 && tot <= 120 && cur >= 1 && cur <= tot;
    items.push({
      date: date > today ? today : date,
      description,
      amount,
      current: installment ? cur : null,
      total: installment ? tot : null,
      categoryId: (
        categoryMatch(choices.categories, row.categorySuggestion) || fallback
      ).id,
    });
  }
  const last4 =
    statement.cardLast4 && /^\d{4}$/.test(statement.cardLast4)
      ? statement.cardLast4
      : null;
  const bank = bankKey(statement.bankName);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const card =
    (last4 &&
      uniqueMatch(
        choices.cards,
        (c) => c.last4 === last4 && (!bank || bankKey(c.bank.name) === bank),
      )) ||
    (bank &&
      uniqueMatch(choices.cards, (c) => bankKey(c.bank.name) === bank)) ||
    uniqueMatch(choices.cards, (c) => c.owner === user.name) ||
    (choices.cards.length === 1 ? choices.cards[0] : null);
  return {
    userId,
    cardId: card?.id || null,
    bankName: safeText(statement.bankName, 60),
    cardLast4: last4,
    closingDate:
      civilDate(statement.closingDate)?.toISOString().slice(0, 10) || null,
    dueDate: civilDate(statement.dueDate)?.toISOString().slice(0, 10) || null,
    items,
    ignored,
    attachmentId,
  };
}

/** Fatura de referência do print: fechamento informado, vencimento informado ou a compra mais recente. */
export function statementCycle(
  card: Pick<CreditCard, "closingDay" | "dueDay">,
  p: Pick<ImportPayload, "closingDate" | "dueDate" | "items">,
  today: string,
) {
  let anchor: Date;
  if (p.closingDate) anchor = new Date(p.closingDate + "T12:00:00Z");
  else if (p.dueDate) {
    const due = new Date(p.dueDate + "T12:00:00Z");
    anchor = dateAt(
      due.getUTCFullYear(),
      due.getUTCMonth() - (card.dueDay <= card.closingDay ? 1 : 0),
      card.closingDay,
    );
  } else {
    const dates = p.items
      .filter((i) => !i.total)
      .map((i) => i.date)
      .sort();
    anchor = new Date((dates.at(-1) || today) + "T12:00:00Z");
  }
  const cycle = invoiceDates(anchor, card.closingDay, card.dueDay);
  const previous = addMonths(cycle.closingDate, -1, card.closingDay);
  const start = new Date(previous.getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  return { ...cycle, start };
}

export interface PlannedItem extends ImportItem {
  key: string;
  launchDate: string;
  installments: number;
  launchTotal: number;
  duplicate: boolean;
}

export async function plan(
  householdId: string,
  p: ImportPayload,
  today: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (!p.cardId) return null;
  const card = await db.creditCard.findFirst({
    where: { id: p.cardId, householdId, active: true },
  });
  if (!card) return null;
  const cycle = statementCycle(card, p, today);
  const previous = await db.externalImport.findMany({
    where: { householdId, source: "TELEGRAM", status: "CONFIRMADA" },
    select: { payload: true },
  });
  const known = new Set(
    previous.flatMap((r) => (r.payload as unknown as ImportPayload).keys || []),
  );
  // Compras já lançadas à mão ou pelo Telegram no mesmo cartão: mesmo valor (da parcela)
  // e data da compra a até 3 dias. Cada lançamento existente só cobre um item do print.
  const dates = p.items.map((i) => i.date).sort();
  const existing = dates.length
    ? await db.transaction.findMany({
        where: {
          householdId,
          cardId: card.id,
          type: "DESPESA",
          status: { not: "CANCELADA" },
          date: {
            gte: new Date(Date.parse(dates[0]) - 3 * 86400000),
            lte: new Date(Date.parse(dates.at(-1)!) + 3 * 86400000),
          },
        },
        select: { id: true, amount: true, date: true },
      })
    : [];
  const used = new Set<string>();
  const launched = (i: ImportItem) => {
    const match = existing.find(
      (t) =>
        !used.has(t.id) &&
        t.amount === i.amount &&
        Math.abs(t.date.getTime() - Date.parse(i.date)) <= 3 * 86400000,
    );
    if (match) used.add(match.id);
    return Boolean(match);
  };
  // Compras idênticas no mesmo print (dois cafés iguais no dia) são compras distintas:
  // a 2ª ocorrência ganha sufixo, e reenviar o mesmo print continua sem duplicar.
  const seen = new Map<string, number>();
  const items: PlannedItem[] = p.items.map((i) => {
    const base = itemKey(card.id, i);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const key = n ? base + ":" + n : base;
    // launched() roda sempre: um item já importado consome o seu lançamento e não
    // deixa outra compra de mesmo valor ser confundida com ele.
    const hit = launched(i);
    const duplicate = known.has(key) || hit;
    const remaining = i.total ? i.total - (i.current || 1) + 1 : 1;
    return {
      ...i,
      key,
      duplicate,
      installments: remaining,
      launchTotal: i.amount * remaining,
      // Compras antigas (parcelas) entram na fatura importada, não em faturas passadas.
      launchDate: i.date < cycle.start ? cycle.start : i.date,
    };
  });
  return { card, cycle, items };
}

const day = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);

export async function previewText(
  householdId: string,
  p: ImportPayload,
  today: string,
) {
  const planned = await plan(householdId, p, today);
  const fresh = planned?.items.filter((i) => !i.duplicate) || [];
  const dupes = (planned?.items.length || 0) - fresh.length;
  const categories = await prisma.category.findMany({
    where: { householdId },
    select: { id: true, name: true },
  });
  const name = (id: string) =>
    categories.find((c) => c.id === id)?.name || "Outros";
  const byCategory = new Map<string, { sum: number; n: number }>();
  for (const i of fresh) {
    const c = byCategory.get(i.categoryId) || { sum: 0, n: 0 };
    c.sum += i.amount;
    c.n++;
    byCategory.set(i.categoryId, c);
  }
  const parcelled = fresh.filter((i) => i.total);
  const lines = [
    "🧾 " +
      (planned
        ? "Fatura " +
          planned.card.name +
          (planned.card.last4 ? " final " + planned.card.last4 : "") +
          " · " +
          monthLabel(planned.cycle.competence)
        : "Lista de compras do cartão"),
    fresh.length +
      " compra" +
      (fresh.length === 1 ? "" : "s") +
      " nesta fatura · " +
      brl(fresh.reduce((s, i) => s + i.amount, 0)),
    "",
    ...[...byCategory.entries()]
      .sort((a, b) => b[1].sum - a[1].sum)
      .map(([id, c]) => "• " + name(id) + ": " + brl(c.sum) + " (" + c.n + ")"),
  ];
  if (parcelled.length)
    lines.push(
      "",
      "📆 " +
        parcelled.length +
        " parcelada" +
        (parcelled.length === 1 ? "" : "s") +
        ": lanço só as parcelas que faltam (" +
        brl(parcelled.reduce((s, i) => s + i.launchTotal - i.amount, 0)) +
        " em faturas futuras).",
    );
  if (dupes)
    lines.push(
      "↪️ " +
        dupes +
        " já lançada" +
        (dupes === 1 ? "" : "s") +
        " no app, vou ignorar.",
    );
  if (p.ignored.payments + p.ignored.refunds)
    lines.push(
      "↪️ Ignorei " +
        [
          p.ignored.payments ? p.ignored.payments + " pagamento(s)" : "",
          p.ignored.refunds ? p.ignored.refunds + " estorno(s)" : "",
        ]
          .filter(Boolean)
          .join(" e ") +
        ".",
    );
  if (p.ignored.unreadable)
    lines.push(
      "⚠️ " + p.ignored.unreadable + " linha(s) ilegível(is) ficaram de fora.",
    );
  if (!planned) lines.push("", "💳 Em qual cartão estão essas compras?");
  else if (!fresh.length) lines.push("", "Nada novo para lançar.");
  else lines.push("", "Categorias erradas podem ser corrigidas depois no app.");
  return {
    text: lines.join("\n"),
    ready: !!planned && fresh.length > 0,
    fresh: fresh.length,
  };
}

export function listText(
  items: {
    date: string;
    description: string;
    amount: number;
    current: number | null;
    total: number | null;
  }[],
) {
  return items
    .map(
      (i) =>
        day(i.date) +
        " " +
        i.description +
        (i.total ? " (" + i.current + "/" + i.total + ")" : "") +
        " · " +
        brl(i.amount),
    )
    .join("\n");
}

export async function previewKeyboard(
  householdId: string,
  importId: string,
  ready: boolean,
  fresh: number,
  needsCard: boolean,
): Promise<Keyboard> {
  const keyboard: Keyboard = [];
  if (needsCard) {
    const cards = await prisma.creditCard.findMany({
      where: { householdId, active: true },
      orderBy: { createdAt: "asc" },
    });
    for (const c of cards.slice(0, 20))
      keyboard.push([
        {
          text:
            "💳 " + c.name + (c.last4 ? " · " + c.last4 : "") + " · " + c.owner,
          callback_data: "imp:card:" + importId + ":" + c.id,
        },
      ]);
  }
  if (ready)
    keyboard.push([
      {
        text: "✅ Lançar " + fresh + " compra" + (fresh === 1 ? "" : "s"),
        callback_data: "imp:ok:" + importId,
      },
    ]);
  keyboard.push([
    { text: "📋 Ver lista", callback_data: "imp:list:" + importId },
    ...(!needsCard
      ? [{ text: "💳 Outro cartão", callback_data: "imp:cards:" + importId }]
      : []),
    { text: "🗑 Descartar", callback_data: "imp:no:" + importId },
  ]);
  return keyboard;
}

export async function ownedImport(
  householdId: string,
  userId: string,
  id: string,
) {
  const row = await prisma.externalImport.findFirst({
    where: { id, householdId, source: "TELEGRAM" },
  });
  const payload = row?.payload as unknown as ImportPayload | undefined;
  if (!row || payload?.userId !== userId) fail("Importação indisponível.", 404);
  return { row, payload: payload! };
}

export async function confirmImport(
  householdId: string,
  userId: string,
  id: string,
  today: string,
) {
  const result = await atomic(async (tx) => {
    const row = await tx.externalImport.findFirst({
      where: { id, householdId, source: "TELEGRAM" },
    });
    const p = row?.payload as unknown as ImportPayload | undefined;
    if (!row || p?.userId !== userId) fail("Importação indisponível.", 404);
    if (row.status === "CONFIRMADA")
      return {
        already: true as const,
        ids: p!.transactionIds || [],
        competence: null,
      };
    if (row.status !== "PENDENTE") fail("Esta importação foi descartada.");
    const planned = await plan(householdId, p!, today, tx);
    if (!planned) fail("Escolha o cartão antes de lançar.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const ids: string[] = [];
    const keys: string[] = [];
    for (const i of planned.items.filter((x) => !x.duplicate)) {
      const input = transactionInput.parse({
        description: i.description,
        amount: i.launchTotal,
        date: i.launchDate,
        type: "DESPESA",
        paymentMethod: "CREDITO",
        status: "CONFIRMADA",
        owner: planned.card.owner,
        cardId: planned.card.id,
        categoryId: i.categoryId,
        notes:
          "Importado de print da fatura pelo Telegram (" + user.name + ").",
        installments: i.installments,
      });
      const rows = await createTransaction(tx, householdId, input, {
        source: "IMPORTACAO",
      });
      // Mantém a numeração da fatura (3/10, 4/10…) em vez de recomeçar em 1/8.
      if (i.total && i.current && i.current > 1)
        for (const [n, r] of rows.entries())
          await tx.transaction.update({
            where: { id: r.id },
            data: {
              description:
                i.description + " " + (i.current + n) + "/" + i.total,
            },
          });
      ids.push(...rows.map((r) => r.id));
      keys.push(i.key);
    }
    await tx.externalImport.update({
      where: { id: row.id },
      data: {
        status: "CONFIRMADA",
        payload: {
          ...p!,
          keys,
          transactionIds: ids,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    if (p!.attachmentId)
      await tx.attachment.updateMany({
        where: { id: p!.attachmentId, householdId },
        data: { transactionId: ids[0] || null },
      });
    return {
      already: false as const,
      ids,
      competence: planned.cycle.competence,
      count: keys.length,
    };
  });
  if (result.already)
    return "✅ Esta importação já foi lançada. Nada foi duplicado.";
  const rows = await prisma.transaction.findMany({
    where: { id: { in: result.ids } },
    select: { categoryId: true, competence: true, amount: true },
  });
  const now = rows.filter((r) => r.competence === result.competence);
  const status = await budgetStatus(householdId, today.slice(0, 7));
  return [
    "✅ " +
      result.count +
      " compra(s) lançada(s) na fatura de " +
      monthLabel(result.competence!) +
      " · " +
      brl(now.reduce((s, r) => s + r.amount, 0)),
    "",
    ...budgetLines(
      status,
      [...new Set(rows.map((r) => r.categoryId || ""))].filter(Boolean),
    ),
  ].join("\n");
}
