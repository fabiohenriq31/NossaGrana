import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, atomic } from "../db";
import { fail } from "../service";
import {
  healthMonth,
  settingsInput,
  goalInput,
  monthlyGoalInput,
  planInput,
  contributionInput,
  essentiality,
  nonnegativeMoney,
  type MonthlyGoalFields,
  type ContributionView,
} from "../../../../packages/shared/src/health";
import {
  FinancialHealthService,
  FinancialGoalService,
  EmergencyFundService,
  settingsView,
  dateString,
} from "./service";
import {
  civilToday,
  netContributions,
  FinancialProjectionService,
} from "./calculations";
import { FinancialCoachAI } from "./coach";

const dateValue = (v: string) => new Date(v + "T12:00:00Z");
async function member(
  tx: Prisma.TransactionClient,
  h: string,
  id: string | null,
) {
  if (id && !(await tx.user.findFirst({ where: { id, householdId: h } })))
    fail("Membro indisponível neste núcleo.", 404);
}
async function goalReferences(
  tx: Prisma.TransactionClient,
  h: string,
  v: { scope: string; memberId: string | null },
) {
  if ((v.scope === "PERSONAL") !== !!v.memberId)
    fail(
      "Objetivos pessoais exigem um membro; objetivos da casa não possuem titular individual.",
    );
  await member(tx, h, v.memberId);
}
async function monthlyReferences(
  tx: Prisma.TransactionClient,
  h: string,
  v: MonthlyGoalFields,
) {
  // Metas mensais acompanham o núcleo; objetivos pessoais mantêm seu membro no FinancialGoal.
  if (v.userId !== null)
    fail(
      "As metas mensais acompanham o núcleo financeiro. Para uma pessoa, vincule um objetivo pessoal.",
    );
  if ((v.type === "CATEGORY_LIMIT") !== !!v.categoryId)
    fail(
      "Limite de categoria exige uma categoria; outros tipos não recebem categoria.",
    );
  if ((v.type === "GOAL_CONTRIBUTION") !== !!v.financialGoalId)
    fail(
      "Contribuição para objetivo exige um objetivo; outros tipos não recebem objetivo.",
    );
  if (v.manualProgress && v.type !== "CUSTOM")
    fail("O progresso desta meta é calculado pelos registros existentes.");
  if (
    v.categoryId &&
    !(await tx.category.findFirst({
      where: { id: v.categoryId, householdId: h },
    }))
  )
    fail("Categoria indisponível.", 404);
  if (
    v.financialGoalId &&
    !(await tx.financialGoal.findFirst({
      where: {
        id: v.financialGoalId,
        householdId: h,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
    }))
  )
    fail("Objetivo indisponível.", 404);
}
async function planReferences(
  tx: Prisma.TransactionClient,
  h: string,
  goalId: string | null,
  reserveMonths: number | null,
) {
  if (goalId && reserveMonths)
    fail("Escolha um objetivo ou um marco de reserva.");
  if (
    goalId &&
    !(await tx.financialGoal.findFirst({
      where: { id: goalId, householdId: h },
    }))
  )
    fail("Objetivo indisponível.", 404);
}
export async function recordContribution(
  h: string,
  userId: string,
  goalId: string | null,
  body: unknown,
) {
  const v = contributionInput.parse(body);
  if (v.date > civilToday())
    fail(
      "Contribuições registram valores já separados. Para o futuro, crie uma meta mensal.",
    );
  return atomic(async (tx) => {
    await member(tx, h, userId);
    const existing = await tx.goalContribution.findUnique({
      where: {
        householdId_requestId: { householdId: h, requestId: v.requestId },
      },
    });
    if (existing) {
      if (
        existing.goalId !== goalId ||
        existing.amount !== v.amount ||
        existing.direction !== v.direction ||
        dateString(existing.date) !== v.date ||
        existing.notes !== v.notes
      )
        fail("Esta solicitação já foi usada para outra contribuição.", 409);
      return existing;
    }
    let initial: number;
    if (goalId) {
      const goal = await tx.financialGoal.findFirst({
        where: { id: goalId, householdId: h },
      });
      if (!goal) fail("Objetivo indisponível.", 404);
      if (goal.status === "CANCELLED")
        fail("Reative o objetivo antes de registrar contribuições.");
      initial = goal.initialAmount;
    } else {
      const settings = await tx.financialHealthSettings.findUnique({
        where: { householdId: h },
      });
      initial = settings?.reserveInitialAmount || 0;
    }
    const prior = await tx.goalContribution.findMany({
      where: { householdId: h, goalId },
    });
    const balance =
      initial +
      netContributions(
        prior.map((c) => ({
          ...c,
          date: dateString(c.date),
        })) as ContributionView[],
      );
    if (v.direction === "WITHDRAWAL" && v.amount > balance)
      fail(
        "A retirada não pode exceder o valor destinado a este objetivo ou reserva.",
      );
    return tx.goalContribution.create({
      data: {
        ...v,
        householdId: h,
        createdByUserId: userId,
        goalId,
        date: dateValue(v.date),
      },
    });
  });
}
export async function financialHealthRoutes(
  app: FastifyInstance,
  coach = new FinancialCoachAI(),
) {
  app.get<{ Params: { month: string } }>(
    "/api/financial-health/:month",
    (req) =>
      FinancialHealthService.getHealth(
        req.user.householdId,
        healthMonth.parse(req.params.month),
      ),
  );
  app.get<{ Params: { month: string } }>(
    "/api/financial-health/:month/recommendations",
    async (req) =>
      (
        await FinancialHealthService.getHealth(
          req.user.householdId,
          healthMonth.parse(req.params.month),
        )
      ).recommendations,
  );
  app.patch("/api/financial-health/settings", async (req) => {
    const patch = settingsInput.partial().parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      const current = await tx.financialHealthSettings.findUnique({
        where: { householdId: h },
      });
      const v = settingsInput.parse({ ...settingsView(current), ...patch });
      if (v.essentialSource === "USER_ESTIMATE" && v.essentialEstimate === null)
        fail("Informe seu custo essencial mensal estimado.");
      if (v.historyStart && v.historyStart > civilToday())
        fail("O início do histórico completo não pode estar no futuro.");
      const contributions = await tx.goalContribution.findMany({
        where: { householdId: h, goalId: null },
      });
      if (
        v.reserveInitialAmount +
          netContributions(contributions as unknown as ContributionView[]) <
        0
      )
        fail(
          "O valor inicial não pode deixar a reserva negativa após as retiradas registradas.",
        );
      const data = {
        ...v,
        historyStart: v.historyStart ? dateValue(v.historyStart) : null,
      };
      return tx.financialHealthSettings.upsert({
        where: { householdId: h },
        create: { ...data, householdId: h },
        update: data,
      });
    });
  });
  app.patch<{ Params: { id: string } }>(
    "/api/financial-health/categories/:id",
    async (req) => {
      const v = z
        .object({
          essentiality: essentiality.optional(),
          expenseNature: z
            .enum(["FIXED", "VARIABLE", "UNCLASSIFIED"])
            .optional(),
          financialRole: z
            .enum(["GENERAL", "INTEREST_FEES", "DEBT_PAYMENT", "SUBSCRIPTION"])
            .optional(),
        })
        .strict()
        .parse(req.body);
      return atomic(async (tx) => {
        if (
          !(await tx.category.findFirst({
            where: { id: req.params.id, householdId: req.user.householdId },
          }))
        )
          fail("Categoria indisponível.", 404);
        return tx.category.update({ where: { id: req.params.id }, data: v });
      });
    },
  );
  app.patch<{ Params: { id: string } }>(
    "/api/financial-health/subcategories/:id",
    async (req) => {
      const v = z
        .object({ essentiality: essentiality.nullable() })
        .strict()
        .parse(req.body);
      return atomic(async (tx) => {
        if (
          !(await tx.subcategory.findFirst({
            where: {
              id: req.params.id,
              category: { householdId: req.user.householdId },
            },
          }))
        )
          fail("Subcategoria indisponível.", 404);
        return tx.subcategory.update({ where: { id: req.params.id }, data: v });
      });
    },
  );
  app.get("/api/emergency-fund", (req) =>
    EmergencyFundService.get(req.user.householdId),
  );
  app.post("/api/emergency-fund/contributions", (req) =>
    recordContribution(req.user.householdId, req.user.id, null, req.body),
  );
  app.get(
    "/api/financial-goals",
    async (req) =>
      (
        await FinancialHealthService.getHealth(
          req.user.householdId,
          civilToday().slice(0, 7),
        )
      ).snapshot.financialGoals,
  );
  app.post("/api/financial-goals", async (req) => {
    const v = goalInput.parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      await goalReferences(tx, h, v);
      if (v.type === "EMERGENCY_FUND")
        fail(
          "A reserva já possui uma área própria. Use Reserva de emergência para evitar destinar o mesmo valor duas vezes.",
        );
      if (v.status === "COMPLETED" && v.initialAmount < v.targetAmount)
        fail("Registre o valor alcançado antes de concluir o objetivo.");
      return tx.financialGoal.create({
        data: {
          ...v,
          targetDate: dateValue(v.targetDate),
          householdId: h,
          createdByUserId: req.user.id,
        },
      });
    });
  });
  app.post("/api/financial-goals/simulate", async (req) => {
    const v = z
      .object({
        goalId: z.string().optional(),
        goal: goalInput,
        monthlyContribution: nonnegativeMoney,
      })
      .strict()
      .parse(req.body);
    const current = v.goalId
      ? await FinancialGoalService.get(req.user.householdId, v.goalId)
      : null;
    return FinancialProjectionService.simulateGoal(
      { ...v.goal, id: current?.id || "draft" },
      current?.currentAmount ?? v.goal.initialAmount,
      civilToday(),
      v.monthlyContribution,
      v.goal.targetAmount,
      v.goal.targetDate,
    );
  });
  app.patch<{ Params: { id: string } }>(
    "/api/financial-goals/:id",
    async (req) => {
      const patch = goalInput.partial().parse(req.body),
        h = req.user.householdId;
      return atomic(async (tx) => {
        const old = await tx.financialGoal.findFirst({
          where: { id: req.params.id, householdId: h },
          include: { contributions: true },
        });
        if (!old) fail("Objetivo indisponível.", 404);
        const v = goalInput.parse({
          ...goalInput
            .strip()
            .parse({ ...old, targetDate: dateString(old.targetDate) }),
          ...patch,
        });
        await goalReferences(tx, h, v);
        if (v.type === "EMERGENCY_FUND")
          fail("Use a área Reserva de emergência.");
        const amount =
          v.initialAmount +
          netContributions(old.contributions as unknown as ContributionView[]);
        if (amount < 0) fail("O ajuste deixaria o objetivo negativo.");
        if (v.status === "COMPLETED" && amount < v.targetAmount)
          fail("Registre o valor alcançado antes de concluir o objetivo.");
        return tx.financialGoal.update({
          where: { id: old.id },
          data: { ...v, targetDate: dateValue(v.targetDate) },
        });
      });
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/financial-goals/:id",
    async (req) => {
      const result = await prisma.financialGoal.updateMany({
        where: { id: req.params.id, householdId: req.user.householdId },
        data: { status: "CANCELLED" },
      });
      if (!result.count) fail("Objetivo indisponível.", 404);
      return { cancelled: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/financial-goals/:id/contributions",
    (req) =>
      recordContribution(
        req.user.householdId,
        req.user.id,
        req.params.id,
        req.body,
      ),
  );
  app.get<{ Params: { month: string } }>(
    "/api/monthly-goals/:month",
    async (req) =>
      (
        await FinancialHealthService.getHealth(
          req.user.householdId,
          healthMonth.parse(req.params.month),
        )
      ).snapshot.monthlyGoals,
  );
  app.post("/api/monthly-goals", async (req) => {
    const v = monthlyGoalInput.parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      await monthlyReferences(tx, h, v);
      return tx.monthlyGoal.create({ data: { ...v, householdId: h } });
    });
  });
  app.patch<{ Params: { id: string } }>(
    "/api/monthly-goals/:id",
    async (req) => {
      const patch = monthlyGoalInput.partial().parse(req.body),
        h = req.user.householdId;
      return atomic(async (tx) => {
        const old = await tx.monthlyGoal.findFirst({
          where: { id: req.params.id, householdId: h },
        });
        if (!old) fail("Meta indisponível.", 404);
        const v = monthlyGoalInput.parse({
          ...monthlyGoalInput.strip().parse(old),
          ...patch,
        });
        await monthlyReferences(tx, h, v);
        return tx.monthlyGoal.update({ where: { id: old.id }, data: v });
      });
    },
  );
  app.post<{ Params: { month: string } }>(
    "/api/financial-health/:month/recommendations/accept",
    async (req) => {
      const body = z
        .object({
          key: z.string().max(180),
          changes: monthlyGoalInput.partial().default({}),
        })
        .strict()
        .parse(req.body);
      const h = req.user.householdId,
        month = healthMonth.parse(req.params.month);
      const candidate = (
        await FinancialHealthService.getHealth(h, month)
      ).recommendations.find((r) => r.key === body.key);
      if (!candidate?.suggestedGoal)
        fail(
          "Esta dica não possui uma meta pronta. Revise seus dados e crie uma meta manual.",
        );
      const v = monthlyGoalInput.parse({
        ...candidate.suggestedGoal,
        ...body.changes,
      });
      return atomic(async (tx) => {
        const key = month + ":" + candidate.key;
        const existing = await tx.monthlyGoal.findFirst({
          where: { householdId: h, sourceKey: key },
        });
        if (existing) return existing;
        await monthlyReferences(tx, h, v);
        const created = await tx.monthlyGoal.create({
          data: {
            ...v,
            householdId: h,
            source: "COFLU_SUGGESTION",
            sourceKey: key,
          },
        });
        await tx.financialRecommendationDecision.upsert({
          where: {
            householdId_month_key: {
              householdId: h,
              month,
              key: candidate.key,
            },
          },
          create: {
            householdId: h,
            month,
            key: candidate.key,
            decision: "ACCEPTED",
          },
          update: { decision: "ACCEPTED" },
        });
        return created;
      });
    },
  );
  app.post<{ Params: { month: string } }>(
    "/api/financial-health/:month/recommendations/decision",
    async (req) => {
      const v = z
        .object({
          key: z.string().min(1).max(180),
          decision: z.enum(["IGNORED", "RESET"]),
        })
        .strict()
        .parse(req.body);
      const h = req.user.householdId,
        month = healthMonth.parse(req.params.month);
      return prisma.financialRecommendationDecision.upsert({
        where: { householdId_month_key: { householdId: h, month, key: v.key } },
        create: { ...v, householdId: h, month },
        update: { decision: v.decision },
      });
    },
  );
  app.post("/api/coflu-plan", async (req) => {
    const v = planInput.parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      await planReferences(tx, h, v.financialGoalId, v.reserveMonths);
      return tx.cofluPlanItem.create({ data: { ...v, householdId: h } });
    });
  });
  app.patch<{ Params: { id: string } }>("/api/coflu-plan/:id", async (req) => {
    const patch = planInput.partial().parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      const old = await tx.cofluPlanItem.findFirst({
        where: { id: req.params.id, householdId: h },
      });
      if (!old) fail("Prioridade indisponível.", 404);
      const v = planInput.parse({ ...planInput.strip().parse(old), ...patch });
      await planReferences(tx, h, v.financialGoalId, v.reserveMonths);
      return tx.cofluPlanItem.update({ where: { id: old.id }, data: v });
    });
  });
  app.post("/api/coflu-plan/order", async (req) => {
    const v = z
        .object({ ids: z.array(z.string()).max(200) })
        .strict()
        .parse(req.body),
      h = req.user.householdId;
    return atomic(async (tx) => {
      const rows = await tx.cofluPlanItem.findMany({
        where: { householdId: h, status: { not: "CANCELLED" } },
      });
      if (
        v.ids.length !== rows.length ||
        new Set(v.ids).size !== rows.length ||
        rows.some((r) => !v.ids.includes(r.id))
      )
        fail("A lista mudou. Atualize antes de reordenar.");
      for (const [position, id] of v.ids.entries())
        await tx.cofluPlanItem.update({ where: { id }, data: { position } });
      return { ordered: true };
    });
  });
  app.post<{ Params: { month: string } }>(
    "/api/financial-health/:month/review",
    (req) =>
      FinancialHealthService.review(
        req.user.householdId,
        healthMonth.parse(req.params.month),
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/financial-reviews/:id",
    async (req) => {
      const review = await prisma.monthlyFinancialReview.findFirst({
        where: { id: req.params.id, householdId: req.user.householdId },
      });
      if (!review) fail("Fechamento indisponível.", 404);
      return review;
    },
  );
  app.post<{ Params: { month: string } }>(
    "/api/financial-health/:month/analysis",
    { config: { rateLimit: { max: 6, timeWindow: "1 hour" } } },
    async (req) => {
      const body = z
        .object({ refresh: z.boolean().default(false) })
        .strict()
        .parse(req.body || {});
      const month = healthMonth.parse(req.params.month),
        h = req.user.householdId;
      return coach.analyze(
        h,
        await FinancialHealthService.getHealth(h, month),
        body.refresh,
      );
    },
  );
}
