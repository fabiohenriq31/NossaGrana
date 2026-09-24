import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma, atomic } from "../db";
import { overview, fail } from "../service";
import {
  settingsInput,
  goalInput,
  monthlyGoalInput,
  planInput,
  type HealthSettings,
  type GoalView,
  type ContributionView,
  type HealthResponse,
  type FinancialSnapshot,
  type RecommendationCandidate,
} from "../../../../packages/shared/src/health";
import {
  buildMonthlySnapshot,
  civilToday,
  goalProjection,
  netContributions,
  type ClassifiedCategory,
} from "./calculations";
import { FinancialRecommendationEngine } from "./recommendations";

export const defaultHealthSettings: HealthSettings = {
  motivations: [],
  reserveAnswer: "UNKNOWN",
  onboarded: false,
  reserveInitialAmount: 0,
  reserveTargetMonths: 6,
  reserveTargetAmount: null,
  milestones: [1, 3, 6, 9, 12],
  essentialEstimate: null,
  essentialSource: "OBSERVED_DATA",
  historyStart: null,
};
export const snapshotHash = (snapshot: FinancialSnapshot) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
export const jsonValue = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const dateString = (v: Date | string) =>
  (v instanceof Date ? v.toISOString() : v).slice(0, 10);
export function settingsView(
  row: Record<string, unknown> | null,
): HealthSettings {
  return row
    ? settingsInput
        .strip()
        .parse({
          ...row,
          historyStart: row.historyStart
            ? dateString(row.historyStart as Date)
            : null,
        })
    : { ...defaultHealthSettings };
}
export class FinancialHealthService {
  static async getMonthlySnapshot(
    householdId: string,
    year: number,
    month: number,
    today = civilToday(),
  ) {
    return (
      await this.getHealth(
        householdId,
        `${year}-${String(month).padStart(2, "0")}`,
        today,
      )
    ).snapshot;
  }
  static async getHealth(
    h: string,
    month: string,
    today = civilToday(),
  ): Promise<HealthResponse> {
    const [
      data,
      rawSettings,
      members,
      categories,
      goals,
      contributions,
      monthlyGoals,
      plan,
      decisions,
      reviews,
    ] = await Promise.all([
      overview(h, { id: "", name: "", email: "" }, month),
      prisma.financialHealthSettings.findUnique({ where: { householdId: h } }),
      prisma.user.findMany({
        where: { householdId: h },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      }),
      prisma.category.findMany({
        where: { householdId: h },
        include: { subcategories: true },
        orderBy: { id: "asc" },
      }),
      prisma.financialGoal.findMany({
        where: { householdId: h },
        orderBy: { id: "asc" },
      }),
      prisma.goalContribution.findMany({
        where: { householdId: h },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      prisma.monthlyGoal.findMany({
        where: { householdId: h, month },
        orderBy: { id: "asc" },
      }),
      prisma.cofluPlanItem.findMany({
        where: { householdId: h, status: { not: "CANCELLED" } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
      prisma.financialRecommendationDecision.findMany({
        where: { householdId: h, month },
      }),
      prisma.monthlyFinancialReview.findMany({
        where: { householdId: h, month },
        orderBy: { version: "desc" },
        select: {
          id: true,
          month: true,
          version: true,
          status: true,
          generatedAt: true,
          snapshotHash: true,
        },
      }),
    ]);
    const settings = settingsView(rawSettings);
    const snapshot = buildMonthlySnapshot(
      {
        data,
        settings,
        members,
        categories,
        today,
        goals: goals.map((g) => ({
          ...goalInput
            .strip()
            .parse({ ...g, targetDate: dateString(g.targetDate) }),
          id: g.id,
        })),
        contributions: contributions.map((c) => ({
          ...c,
          date: dateString(c.date),
        })) as ContributionView[],
        monthlyGoals: monthlyGoals.map((g) => ({
          ...monthlyGoalInput.strip().parse(g),
          id: g.id,
          source: g.source,
        })),
      },
      month,
    );
    const recommendations = FinancialRecommendationEngine.generate(
      snapshot,
    ).map<RecommendationCandidate>((r) => {
      const decision = decisions.find((d) => d.key === r.key)?.decision;
      return {
        ...r,
        decision:
          decision === "ACCEPTED" || decision === "IGNORED" ? decision : null,
      };
    });
    return {
      fingerprint: createHash("sha256")
        .update(
          snapshotHash(snapshot) +
            JSON.stringify(recommendations.map((r) => r.decision)),
        )
        .digest("hex"),
      snapshot,
      settings,
      members,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        essentiality: c.essentiality,
        expenseNature: c.expenseNature,
        financialRole: c.financialRole,
        subcategories: c.subcategories.map((s) => ({
          id: s.id,
          name: s.name,
          essentiality: s.essentiality,
        })),
      })) as ClassifiedCategory[],
      recommendations,
      plan: plan.map((p) => {
        const goal = snapshot.financialGoals.find(
          (g) => g.id === p.financialGoalId,
        );
        const targetAmount = p.reserveMonths
          ? snapshot.reserve.essentialMonthly &&
            snapshot.reserve.essentialMonthly > 0
            ? p.reserveMonths * snapshot.reserve.essentialMonthly
            : null
          : (goal?.targetAmount ?? null);
        const currentAmount = p.reserveMonths
          ? snapshot.reserve.amount
          : (goal?.currentAmount ?? null);
        return {
          ...planInput.strip().parse(p),
          id: p.id,
          currentAmount,
          targetAmount,
          progress:
            targetAmount && currentAmount !== null
              ? Math.min(100, Math.max(0, (currentAmount / targetAmount) * 100))
              : null,
        };
      }),
      reviews: reviews.map((r) => ({
        ...r,
        generatedAt: r.generatedAt.toISOString(),
      })),
    };
  }
  static async review(h: string, month: string) {
    if (month > civilToday().slice(0, 7))
      fail("Não é possível fechar um mês futuro.");
    const snapshot = (await this.getHealth(h, month)).snapshot;
    const hash = snapshotHash(snapshot);
    return atomic(async (tx) => {
      const latest = await tx.monthlyFinancialReview.findFirst({
        where: { householdId: h, month },
        orderBy: { version: "desc" },
      });
      if (latest?.snapshotHash === hash) return latest;
      return tx.monthlyFinancialReview.create({
        data: {
          householdId: h,
          month,
          version: (latest?.version || 0) + 1,
          snapshotHash: hash,
          snapshotData: jsonValue(snapshot),
          status: snapshot.complete ? "CLOSED" : "PARTIAL",
        },
      });
    });
  }
}
export class FinancialGoalService {
  static async get(
    h: string,
    id: string,
    today = civilToday(),
  ): Promise<GoalView> {
    const g = await prisma.financialGoal.findFirst({
      where: { id, householdId: h },
      include: { contributions: true },
    });
    if (!g) fail("Objetivo indisponível.", 404);
    const contributions = g.contributions
      .filter((c) => dateString(c.date) <= today)
      .map((c) => ({ ...c, date: dateString(c.date) })) as ContributionView[];
    return goalProjection(
      {
        ...goalInput
          .strip()
          .parse({ ...g, targetDate: dateString(g.targetDate) }),
        id: g.id,
      },
      g.initialAmount + netContributions(contributions),
      today,
      null,
    );
  }
}
export class EmergencyFundService {
  static async get(h: string) {
    return (await FinancialHealthService.getHealth(h, civilToday().slice(0, 7)))
      .snapshot.reserve;
  }
}
