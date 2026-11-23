import type { Household, Prisma } from "@prisma/client";
import { prisma, atomic } from "./db";
import { fail } from "./service";
import {
  getSettings,
  featureLabels,
  type AppSettings,
  type FeatureKey,
  type Plan,
  type UsageKind,
} from "./settings";

/**
 * Planos e créditos de IA de cada núcleo (casal). O saldo fica em Household.credits e
 * cada movimento entra em CreditLedger. Créditos nunca ficam negativos: o débito é um
 * UPDATE condicionado ao saldo, então dois usos simultâneos não passam do limite.
 */
type Db = Prisma.TransactionClient | typeof prisma;
type HouseholdPlan = Pick<Household, "plan" | "planExpiresAt">;

export const usageReasons: Record<UsageKind, string> = {
  text: "USO_TEXTO",
  receipt: "USO_COMPROVANTE",
  statement: "USO_FATURA",
  coach: "USO_ANALISE",
};
export const usageFeature: Record<UsageKind, FeatureKey> = {
  text: "telegramText",
  receipt: "telegramReceipt",
  statement: "statementImport",
  coach: "coach",
};

export class CreditError extends Error {
  statusCode = 402;
  constructor(
    message: string,
    public needed: number,
    public balance: number,
  ) {
    super(message);
  }
}

const free = (s: AppSettings) => s.plans.find((p) => p.id === "FREE")!;

/** Plano em vigor: plano vencido ou removido volta para o gratuito. */
export function effectivePlan(
  h: HouseholdPlan,
  s: AppSettings,
  now = new Date(),
): Plan {
  if (h.planExpiresAt && h.planExpiresAt <= now) return free(s);
  return s.plans.find((p) => p.id === h.plan) || free(s);
}

export function featureAllowed(
  h: HouseholdPlan,
  s: AppSettings,
  f: FeatureKey,
) {
  return effectivePlan(h, s).features.includes(f);
}

/** Um mês depois, no mesmo dia (31/01 → 28/02). */
export function nextMonth(d: Date) {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + 1);
  if (r.getUTCDate() !== d.getUTCDate()) r.setUTCDate(0);
  return r;
}

async function entry(
  db: Db,
  householdId: string,
  delta: number,
  balanceAfter: number,
  reason: string,
  note?: string | null,
  actorUserId?: string | null,
) {
  await db.creditLedger.create({
    data: { householdId, delta, balanceAfter, reason, note, actorUserId },
  });
}

/**
 * Créditos mensais do plano, aplicados de forma preguiçosa: quando o núcleo usa ou abre a
 * tela, cada mês vencido gera uma recarga. Só a primeira recarga atrasada é aplicada, para
 * um núcleo parado meses não acumular créditos de uma vez.
 */
export async function refillIfDue(
  householdId: string,
  db: Db = prisma,
  now = new Date(),
) {
  const s = await getSettings();
  const h = await db.household.findUniqueOrThrow({
    where: { id: householdId },
  });
  const plan = effectivePlan(h, s, now);
  if (plan.id === "FREE" || !h.planRenewsAt || h.planRenewsAt > now) return h;
  let renews = h.planRenewsAt;
  while (renews <= now) renews = nextMonth(renews);
  const updated = await db.household.updateMany({
    where: { id: h.id, planRenewsAt: h.planRenewsAt },
    data: { planRenewsAt: renews, credits: { increment: plan.monthlyCredits } },
  });
  if (!updated.count)
    return db.household.findUniqueOrThrow({ where: { id: h.id } });
  const after = await db.household.findUniqueOrThrow({ where: { id: h.id } });
  if (plan.monthlyCredits)
    await entry(
      db,
      h.id,
      plan.monthlyCredits,
      after.credits,
      "PLANO_MENSAL",
      plan.name,
    );
  return after;
}

export function creditMessage(s: AppSettings, needed: number, balance: number) {
  return (
    "🪙 Seus créditos acabaram: este uso precisa de " +
    needed +
    " e você tem " +
    balance +
    ". Veja os planos ou compre créditos em " +
    (process.env.APP_ORIGIN || "") +
    "/plano"
  );
}

/** Confere plano e saldo sem debitar (para quando o tipo de uso só se sabe depois). */
export async function check(householdId: string, kind: UsageKind) {
  const s = await getSettings();
  if (!s.aiEnabled)
    fail(
      "A leitura por IA está temporariamente desligada. Tente mais tarde.",
      503,
    );
  const h = await refillIfDue(householdId);
  const plan = effectivePlan(h, s);
  if (!plan.features.includes(usageFeature[kind]))
    throw new CreditError(
      "🔒 " +
        featureLabels[usageFeature[kind]] +
        " faz parte de outro plano. Veja em " +
        (process.env.APP_ORIGIN || "") +
        "/plano",
      0,
      h.credits,
    );
  const cost = plan.unlimited ? 0 : s.creditCosts[kind];
  if (h.credits < cost)
    throw new CreditError(creditMessage(s, cost, h.credits), cost, h.credits);
}

/** Saldo baixo: aviso enviado junto da resposta do Telegram (null = não avisar). */
export async function lowCreditNotice(balance: number | null) {
  const s = await getSettings();
  if (balance == null || balance > s.lowCreditWarning) return null;
  return (
    "🪙 Restam " +
    balance +
    " crédito" +
    (balance === 1 ? "" : "s") +
    " de IA. Planos e créditos: " +
    (process.env.APP_ORIGIN || "") +
    "/plano"
  );
}

/**
 * Reserva os créditos de um uso de IA antes de chamar o modelo. Se a chamada falhar,
 * use refund() com o valor devolvido. Planos ilimitados registram o uso sem debitar.
 */
export async function reserve(
  householdId: string,
  kind: UsageKind,
  note?: string,
) {
  const s = await getSettings();
  if (!s.aiEnabled)
    fail(
      "A leitura por IA está temporariamente desligada. Tente mais tarde.",
      503,
    );
  return atomic(async (tx) => {
    const h = await refillIfDue(householdId, tx);
    const plan = effectivePlan(h, s);
    if (!plan.features.includes(usageFeature[kind]))
      throw new CreditError(
        "🔒 " +
          featureLabels[usageFeature[kind]] +
          " faz parte de outro plano. Veja em " +
          (process.env.APP_ORIGIN || "") +
          "/plano",
        0,
        h.credits,
      );
    const cost = plan.unlimited ? 0 : s.creditCosts[kind];
    if (cost) {
      const ok = await tx.household.updateMany({
        where: { id: householdId, credits: { gte: cost } },
        data: { credits: { decrement: cost } },
      });
      if (!ok.count)
        throw new CreditError(
          creditMessage(s, cost, h.credits),
          cost,
          h.credits,
        );
    }
    const balance = h.credits - cost;
    await entry(tx, householdId, -cost, balance, usageReasons[kind], note);
    return { charged: cost, balance: plan.unlimited ? null : balance };
  });
}

/** Devolve créditos de um uso que não chegou a acontecer (falha da IA, por exemplo). */
export async function refund(
  householdId: string,
  amount: number,
  note: string,
) {
  if (!amount) return;
  await atomic(async (tx) => {
    const h = await tx.household.update({
      where: { id: householdId },
      data: { credits: { increment: amount } },
    });
    await entry(tx, householdId, amount, h.credits, "ESTORNO", note);
  });
}

/** Ajuste manual (admin) ou compra de créditos. Débito nunca deixa o saldo negativo. */
export async function adjustCredits(
  householdId: string,
  delta: number,
  reason: string,
  note: string | null,
  actorUserId: string | null,
  db: Db = prisma,
) {
  const h = await db.household.findUniqueOrThrow({
    where: { id: householdId },
  });
  if (h.credits + delta < 0)
    fail("O saldo não pode ficar negativo (saldo atual: " + h.credits + ").");
  const after = await db.household.update({
    where: { id: householdId },
    data: { credits: { increment: delta } },
  });
  await entry(db, householdId, delta, after.credits, reason, note, actorUserId);
  return after.credits;
}

/** Ativa um plano: renova todo mês a partir de hoje e já entrega os créditos do 1º mês. */
export async function setPlan(
  householdId: string,
  planId: string,
  expiresAt: Date | null,
  grantNow: boolean,
  actorUserId: string,
  db: Db = prisma,
) {
  const s = await getSettings();
  const plan = s.plans.find((p) => p.id === planId);
  if (!plan) fail("Plano inexistente.");
  const now = new Date();
  await db.household.update({
    where: { id: householdId },
    data: {
      plan: plan.id,
      planExpiresAt: plan.id === "FREE" ? null : expiresAt,
      planRenewsAt: plan.id === "FREE" ? null : nextMonth(now),
    },
  });
  if (grantNow && plan.id !== "FREE" && plan.monthlyCredits)
    await adjustCredits(
      householdId,
      plan.monthlyCredits,
      "PLANO_ATIVADO",
      plan.name,
      actorUserId,
      db,
    );
}

/** O que a tela "Plano e créditos" e os bloqueios do app precisam saber. */
export async function billingSummary(householdId: string) {
  const s = await getSettings();
  const h = await refillIfDue(householdId);
  const plan = effectivePlan(h, s);
  const ledger = await prisma.creditLedger.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      delta: true,
      balanceAfter: true,
      reason: true,
      note: true,
      createdAt: true,
    },
  });
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      unlimited: plan.unlimited,
      monthlyCredits: plan.monthlyCredits,
      expiresAt: h.plan === plan.id ? h.planExpiresAt : null,
      renewsAt: h.plan === plan.id ? h.planRenewsAt : null,
    },
    credits: h.credits,
    lowCredit: !plan.unlimited && h.credits <= s.lowCreditWarning,
    features: plan.features,
    creditCosts: s.creditCosts,
    plans: s.plans.filter((p) => p.active),
    creditPacks: s.creditPacks.filter((p) => p.active),
    featureLabels,
    upgrade: s.upgrade,
    aiEnabled: s.aiEnabled,
    ledger,
  };
}

/** Bloqueio de rota por plano. Usado nas rotas de recursos pagos. */
export async function requireFeature(householdId: string, feature: FeatureKey) {
  const [s, h] = await Promise.all([
    getSettings(),
    prisma.household.findUniqueOrThrow({ where: { id: householdId } }),
  ]);
  if (!featureAllowed(h, s, feature))
    fail(
      featureLabels[feature] +
        " faz parte de um plano pago. Veja em Plano e créditos.",
      402,
    );
}
