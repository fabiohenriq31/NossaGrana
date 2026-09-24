import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/src/db";
import { buildApp } from "../apps/api/src/app";
import { FinancialCoachAI } from "../apps/api/src/financial-health/coach";
import { FinancialHealthService } from "../apps/api/src/financial-health/service";
import type {
  HealthResponse,
  GoalFields,
  MonthlyGoalFields,
} from "../packages/shared/src/health";

test("Saúde Financeira: API e persistência isoladas, OpenAI simulada", async (t) => {
  process.env.NODE_ENV = "test";
  const h = "health-test-" + randomUUID(),
    foreign = h + "-other";
  const fakeOutput = {
    summary: "Seu resultado é {{result}}.",
    positivePoints: [],
    attentionPoints: [],
    recommendations: [],
    monthlyGoalSuggestions: [],
    goalInsights: [],
    emergencyFundInsight: "Sua cobertura é {{coverageMonths}}.",
  };
  let aiCalls = 0,
    mode = "valid";
  const coach = new FinancialCoachAI(async () => {
    aiCalls++;
    if (["timeout", "rate-limit", "error", "no-credit"].includes(mode))
      throw new Error(mode);
    if (mode === "invalid")
      return {
        output: {
          ...fakeOutput,
          emergencyFundInsight: "Sua cobertura é 9,9 meses.",
        },
        model: "mock",
        tokens: 10,
      };
    return { output: fakeOutput, model: "mock", tokens: 10 };
  });
  const app = await buildApp(undefined, coach);
  let uid = "",
    secondUid = "",
    foreignUid = "",
    categoryId = "",
    foreignCategory = "",
    accountId = "",
    cardId: string,
    goalId = "";
  const goal: GoalFields = {
    name: "Viagem QA",
    type: "TRAVEL",
    scope: "HOUSEHOLD",
    memberId: null,
    targetAmount: 1500000,
    initialAmount: 270000,
    targetDate: "2028-12-31",
    priority: 2,
    status: "ACTIVE",
    icon: "target",
    notes: "",
  };
  function request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    other = false,
  ) {
    const token = app.jwt.sign({
      id: other ? foreignUid : uid,
      householdId: other ? foreign : h,
      version: 0,
    });
    return app.inject({
      method,
      url: "/api" + url,
      headers: { origin: process.env.APP_ORIGIN || "http://127.0.0.1:5173" },
      cookies: { ng_session: token },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }
  async function health(month = "2026-09") {
    const r = await request("GET", "/financial-health/" + month);
    assert.equal(r.statusCode, 200, r.body);
    return r.json<HealthResponse>();
  }
  try {
    await prisma.household.createMany({
      data: [
        { id: h, name: "Núcleo sintético QA" },
        { id: foreign, name: "Núcleo externo QA" },
      ],
    });
    for (const [householdId, name] of [
      [h, "Pessoa Um"],
      [h, "Pessoa Dois"],
      [foreign, "Pessoa Externa"],
    ]) {
      const u = await prisma.user.create({
        data: {
          householdId,
          name,
          email: randomUUID() + "@example.test",
          passwordHash: "unused",
        },
      });
      if (householdId === foreign) foreignUid = u.id;
      else if (!uid) uid = u.id;
      else secondUid = u.id;
    }
    await prisma.bank.upsert({
      where: { id: "outro" },
      create: { id: "outro", name: "Outro" },
      update: {},
    });
    accountId = (
      await prisma.account.create({
        data: {
          householdId: h,
          bankId: "outro",
          name: "Conta de teste",
          owner: "Pessoa Um",
          type: "Corrente",
          initialBalance: 9990000,
        },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: {
          householdId: h,
          name: "Moradia sintética",
          color: "#4389ff",
          icon: "home",
          essentiality: "ESSENTIAL",
          expenseNature: "FIXED",
        },
      })
    ).id;
    const optionalCategory = await prisma.category.create({
      data: {
        householdId: h,
        name: "Lazer sintético",
        color: "#4389ff",
        icon: "wallet",
        essentiality: "NON_ESSENTIAL",
        expenseNature: "VARIABLE",
      },
    });
    foreignCategory = (
      await prisma.category.create({
        data: {
          householdId: foreign,
          name: "Categoria externa",
          color: "#4389ff",
          icon: "wallet",
        },
      })
    ).id;
    const sub = await prisma.subcategory.create({
      data: { categoryId, name: "Exceção sintética" },
    });
    await t.test(
      "novo núcleo: estado vazio sem inventar renda ou reserva; autenticação obrigatória",
      async () => {
        const s = (await health()).snapshot;
        assert.equal(s.dataQuality.status, "INSUFFICIENT");
        assert.equal(s.reserve.amount, 0);
        assert.equal(s.reserve.coverageMonths, null);
        const r = await app.inject({
          method: "GET",
          url: "/api/financial-health/2026-09",
        });
        assert.equal(r.statusCode, 401);
      },
    );
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"])
      await prisma.transaction.createMany({
        data: [
          {
            householdId: h,
            accountId,
            amount: 540000,
            type: "RECEITA",
            owner: "Pessoa Um",
            description: "Renda sintética",
            competence: month,
            date: new Date(month + "-01T12:00:00Z"),
            tags: [],
          },
          {
            householdId: h,
            accountId,
            categoryId,
            amount: 300000,
            type: "DESPESA",
            owner: "Pessoa Um",
            description: "Essencial sintética",
            competence: month,
            date: new Date(month + "-05T12:00:00Z"),
            tags: [],
          },
          {
            householdId: h,
            accountId,
            categoryId: optionalCategory.id,
            amount: 162000,
            type: "DESPESA",
            owner: "Pessoa Dois",
            description: "Não essencial sintética",
            competence: month,
            date: new Date(month + "-06T12:00:00Z"),
            tags: [],
          },
        ],
      });
    cardId = (
      await prisma.creditCard.create({
        data: {
          householdId: h,
          bankId: "outro",
          name: "Cartão sintético",
          owner: "Pessoa Um",
          brand: "Visa",
          last4: "1234",
          limit: 1000000,
          closingDay: 5,
          dueDay: 10,
          color: "#4389ff",
        },
      })
    ).id;
    await prisma.invoice.create({
      data: {
        cardId,
        competence: "2026-10",
        openingBalance: 142000,
        openingBalanceDate: new Date("2026-09-01"),
        closingDate: new Date("2026-10-05"),
        dueDate: new Date("2026-10-10"),
      },
    });
    await t.test(
      "onboarding e cenário de aceitação persistido preservam saldos bancários",
      async () => {
        const r = await request("PATCH", "/financial-health/settings", {
          onboarded: true,
          reserveAnswer: "YES",
          reserveInitialAmount: 750000,
          motivations: ["Ter segurança", "Viver experiências"],
        });
        assert.equal(r.statusCode, 200, r.body);
        const s = (await health()).snapshot;
        assert.equal(s.income, 540000);
        assert.equal(s.expenses, 462000);
        assert.equal(s.monthlyResult, 78000);
        assert.equal(s.savingsRate, 14.44);
        assert.equal(s.reserve.coverageMonths, 2.5);
        assert.equal(s.reserve.nextMilestoneMonths, 3);
        assert.equal(s.reserve.nextMilestoneAmount, 900000);
        assert.equal(s.reserve.remainingToMilestone, 150000);
        assert.equal(s.reserve.targetAmount, 1800000);
        assert.equal(s.futureCommittedExpenses, 142000);
        assert.equal(
          (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
            .initialBalance,
          9990000,
        );
      },
    );
    await t.test(
      "objetivo da casa: criar, editar, simular sem alterar, pausar e retomar",
      async () => {
        let r = await request("POST", "/financial-goals", goal);
        assert.equal(r.statusCode, 200, r.body);
        goalId = r.json().id;
        const before = await prisma.financialGoal.findUniqueOrThrow({
          where: { id: goalId },
        });
        r = await request("POST", "/financial-goals/simulate", {
          goalId,
          goal: { ...goal, targetAmount: 1000000 },
          monthlyContribution: 50000,
        });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.json().includesReturns, false);
        assert.deepEqual(
          await prisma.financialGoal.findUniqueOrThrow({
            where: { id: goalId },
          }),
          before,
        );
        for (const status of ["PAUSED", "ACTIVE"]) {
          r = await request("PATCH", "/financial-goals/" + goalId, { status });
          assert.equal(r.statusCode, 200);
          assert.equal(r.json().status, status);
        }
        assert.equal((await health()).snapshot.financialGoals[0].progress, 18);
      },
    );
    await t.test(
      "objetivo pessoal usa membro real e rejeita membro estrangeiro",
      async () => {
        let r = await request("POST", "/financial-goals", {
          ...goal,
          name: "Curso pessoal",
          type: "EDUCATION",
          scope: "PERSONAL",
          memberId: secondUid,
        });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.json().memberId, secondUid);
        r = await request("POST", "/financial-goals", {
          ...goal,
          scope: "PERSONAL",
          memberId: foreignUid,
        });
        assert.equal(r.statusCode, 404);
        r = await request("POST", "/financial-goals", {
          ...goal,
          scope: "PERSONAL",
          memberId: null,
        });
        assert.equal(r.statusCode, 400);
      },
    );
    await t.test(
      "contribuições: idempotência concorrente, retirada e nenhuma Transaction nova",
      async () => {
        const count = await prisma.transaction.count({
          where: { householdId: h },
        });
        const body = {
          amount: 30000,
          date: "2026-09-15",
          requestId: randomUUID(),
        };
        const [first, repeated] = await Promise.all([
          request("POST", `/financial-goals/${goalId}/contributions`, body),
          request("POST", `/financial-goals/${goalId}/contributions`, body),
        ]);
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(repeated.statusCode, 200, repeated.body);
        assert.equal(first.json().id, repeated.json().id);
        assert.equal(
          (
            await request("POST", `/financial-goals/${goalId}/contributions`, {
              ...body,
              amount: 20000,
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await request("POST", `/financial-goals/${goalId}/contributions`, {
              amount: 10000,
              direction: "WITHDRAWAL",
              date: "2026-09-16",
              requestId: randomUUID(),
            })
          ).statusCode,
          200,
        );
        const s = (await health()).snapshot;
        assert.equal(
          s.financialGoals.find((g) => g.id === goalId)?.currentAmount,
          290000,
        );
        assert.equal(s.reserve.amount, 750000);
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          count,
        );
        assert.equal(
          (
            await request("POST", `/financial-goals/${goalId}/contributions`, {
              amount: 300001,
              direction: "WITHDRAWAL",
              date: "2026-09-16",
              requestId: randomUUID(),
            })
          ).statusCode,
          400,
        );
      },
    );
    await t.test(
      "reserva: contribuição explícita, saldo não negativo e estimativa manual preservada",
      async () => {
        let r = await request("POST", "/emergency-fund/contributions", {
          amount: 35000,
          date: "2026-09-15",
          requestId: randomUUID(),
        });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal((await health()).snapshot.reserve.amount, 785000);
        r = await request("PATCH", "/financial-health/settings", {
          essentialSource: "USER_ESTIMATE",
          essentialEstimate: 250000,
        });
        assert.equal(r.statusCode, 200);
        const s = (await health()).snapshot;
        assert.equal(s.reserve.source, "USER_ESTIMATE");
        assert.equal(s.reserve.essentialMonthly, 250000);
        assert.equal(s.reserve.observedEssentialMonthly, 300000);
        r = await request("PATCH", "/financial-health/settings", {
          reserveTargetMonths: 9,
        });
        assert.equal(r.statusCode, 200);
        assert.equal((await health()).settings.essentialEstimate, 250000);
        await request("PATCH", "/financial-health/settings", {
          essentialSource: "OBSERVED_DATA",
          reserveTargetMonths: 6,
        });
      },
    );
    await t.test(
      "classificação por categoria e subcategoria é explícita e isolada",
      async () => {
        let r = await request(
          "PATCH",
          "/financial-health/categories/" + categoryId,
          { essentiality: "UNCLASSIFIED" },
        );
        assert.equal(r.statusCode, 200);
        assert.equal((await health()).snapshot.reserve.coverageMonths, null);
        r = await request(
          "PATCH",
          "/financial-health/categories/" + categoryId,
          { essentiality: "ESSENTIAL" },
        );
        assert.equal(r.statusCode, 200);
        r = await request(
          "PATCH",
          "/financial-health/subcategories/" + sub.id,
          { essentiality: "NON_ESSENTIAL" },
        );
        assert.equal(r.statusCode, 200);
        assert.equal(r.json().essentiality, "NON_ESSENTIAL");
        r = await request(
          "PATCH",
          "/financial-health/categories/" + foreignCategory,
          { essentiality: "ESSENTIAL" },
        );
        assert.equal(r.statusCode, 404);
        r = await request(
          "PATCH",
          "/financial-health/subcategories/" + sub.id,
          { essentiality: null },
          true,
        );
        assert.equal(r.statusCode, 404);
      },
    );
    await t.test(
      "sugestão não vira meta; aceitar após editar é idempotente",
      async () => {
        const before = await prisma.monthlyGoal.count({
          where: { householdId: h },
        });
        const recommendation = (await health()).recommendations.find(
          (r) => r.type === "EMERGENCY_FUND_MILESTONE",
        )!;
        assert.ok(recommendation.suggestedGoal);
        assert.equal(
          await prisma.monthlyGoal.count({ where: { householdId: h } }),
          before,
        );
        const body = {
          key: recommendation.key,
          changes: { targetAmount: 50000, month: "2026-09" },
        };
        const r = await request(
          "POST",
          "/financial-health/2026-09/recommendations/accept",
          body,
        );
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.json().targetAmount, 50000);
        assert.equal(r.json().source, "COFLU_SUGGESTION");
        const repeated = await request(
          "POST",
          "/financial-health/2026-09/recommendations/accept",
          body,
        );
        assert.equal(repeated.json().id, r.json().id);
        assert.equal(
          await prisma.monthlyGoal.count({ where: { householdId: h } }),
          before + 1,
        );
        const view = (await health()).snapshot.monthlyGoals.find(
          (g) => g.id === r.json().id,
        )!;
        assert.equal(view.currentAmount, 35000);
        assert.equal(view.remaining, 15000);
      },
    );
    await t.test("ignorar e reconsiderar não criam metas", async () => {
      const before = await prisma.monthlyGoal.count({
        where: { householdId: h },
      });
      let r = await request(
        "POST",
        "/financial-health/2026-09/recommendations/decision",
        { key: "future", decision: "IGNORED" },
      );
      assert.equal(r.statusCode, 200);
      assert.equal(
        (await health()).recommendations.find((r) => r.key === "future")
          ?.decision,
        "IGNORED",
      );
      r = await request(
        "POST",
        "/financial-health/2026-09/recommendations/decision",
        { key: "future", decision: "RESET" },
      );
      assert.equal(r.statusCode, 200);
      assert.equal(
        (await health()).recommendations.find((r) => r.key === "future")
          ?.decision,
        null,
      );
      assert.equal(
        await prisma.monthlyGoal.count({ where: { householdId: h } }),
        before,
      );
    });
    await t.test(
      "metas: limite, poupança, contribuição, personalizada e mudança de mês",
      async () => {
        const base: MonthlyGoalFields = {
          name: "Meta QA",
          month: "2026-09",
          type: "SAVE_AMOUNT",
          targetAmount: 100000,
          manualProgress: 0,
          status: "ACTIVE",
          userId: null,
          categoryId: null,
          financialGoalId: null,
        };
        for (const patch of [
          {
            type: "CATEGORY_LIMIT",
            categoryId: optionalCategory.id,
            targetAmount: 160000,
          },
          {
            type: "GOAL_CONTRIBUTION",
            financialGoalId: goalId,
            targetAmount: 30000,
          },
          { type: "SAVE_AMOUNT" },
          { type: "CUSTOM", manualProgress: 20000 },
        ]) {
          const r = await request("POST", "/monthly-goals", {
            ...base,
            ...patch,
          });
          assert.equal(r.statusCode, 200, r.body);
        }
        const s = (await health()).snapshot;
        assert.equal(s.budgetPerformance[0].withinPlan, false);
        assert.equal(
          s.monthlyGoals.find((g) => g.type === "SAVE_AMOUNT")?.currentAmount,
          78000,
        );
        assert.equal(
          s.monthlyGoals.find((g) => g.type === "GOAL_CONTRIBUTION")
            ?.currentAmount,
          20000,
        );
        assert.equal((await health("2026-11")).snapshot.monthlyGoals.length, 0);
        const id = s.monthlyGoals[0].id;
        assert.equal(
          (await request("PATCH", "/monthly-goals/" + id, { status: "PAUSED" }))
            .statusCode,
          200,
        );
        assert.equal(
          (
            await request("POST", "/monthly-goals", {
              ...base,
              type: "CATEGORY_LIMIT",
              categoryId: foreignCategory,
            })
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      "Plano Coflu: adicionar, reordenar, pausar, editar e remover sem movimentar dinheiro",
      async () => {
        const transactions = await prisma.transaction.count({
          where: { householdId: h },
        });
        const p = {
          title: "Reserva primeiro marco",
          notes: "",
          stage: "NOW",
          position: 0,
          status: "ACTIVE",
          financialGoalId: null,
          reserveMonths: 1,
        };
        const first = await request("POST", "/coflu-plan", p);
        const second = await request("POST", "/coflu-plan", {
          ...p,
          title: "Viagem em paralelo",
          stage: "PARALLEL",
          financialGoalId: goalId,
          reserveMonths: null,
          position: 1,
        });
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(second.statusCode, 200, second.body);
        assert.equal(
          (
            await request("POST", "/coflu-plan/order", {
              ids: [second.json().id, first.json().id],
            })
          ).statusCode,
          200,
        );
        assert.equal((await health()).plan[0].id, second.json().id);
        assert.equal(
          (
            await request("PATCH", "/coflu-plan/" + first.json().id, {
              status: "PAUSED",
              title: "Reserva revisada",
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await request("PATCH", "/coflu-plan/" + first.json().id, {
              status: "CANCELLED",
            })
          ).statusCode,
          200,
        );
        assert.equal((await health()).plan.length, 1);
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          transactions,
        );
        assert.equal(
          (
            await request(
              "PATCH",
              "/coflu-plan/" + second.json().id,
              { title: "Ataque" },
              true,
            )
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      "fechamentos preservam versões; mesma fotografia não duplica fechamento",
      async () => {
        const first = await request("POST", "/financial-health/2026-08/review");
        assert.equal(first.statusCode, 200, first.body);
        const repeated = await request(
          "POST",
          "/financial-health/2026-08/review",
        );
        assert.equal(repeated.json().id, first.json().id);
        const before = first.json().snapshotData;
        await request("PATCH", "/financial-health/settings", {
          reserveTargetMonths: 9,
        });
        const next = await request("POST", "/financial-health/2026-08/review");
        assert.equal(next.json().version, first.json().version + 1);
        const saved = await request(
          "GET",
          "/financial-reviews/" + first.json().id,
        );
        assert.deepEqual(saved.json().snapshotData, before);
        assert.equal(
          (
            await request(
              "GET",
              "/financial-reviews/" + first.json().id,
              undefined,
              true,
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (await request("POST", "/financial-health/2199-12/review"))
            .statusCode,
          400,
        );
      },
    );
    await t.test(
      "OpenAI simulada: estrutura válida, cache e alteração relevante invalidam cache",
      async () => {
        const before = aiCalls;
        const first = await request(
          "POST",
          "/financial-health/2026-09/analysis",
          {},
        );
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(first.json().status, "READY");
        const second = await request(
          "POST",
          "/financial-health/2026-09/analysis",
          {},
        );
        assert.equal(second.json().cached, true);
        assert.equal(aiCalls, before + 1);
        await request("PATCH", "/financial-health/settings", {
          reserveInitialAmount: 800000,
        });
        const third = await request(
          "POST",
          "/financial-health/2026-09/analysis",
          {},
        );
        assert.equal(third.json().cached, false);
        assert.equal(aiCalls, before + 2);
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          12,
        );
      },
    );
    for (const error of [
      "invalid",
      "timeout",
      "rate-limit",
      "error",
      "no-credit",
    ])
      await t.test(
        "OpenAI: " + error + " retorna fallback e mantém snapshot",
        async () => {
          await prisma.financialCoachAnalysis.deleteMany({
            where: { householdId: h },
          });
          mode = error;
          const data = await FinancialHealthService.getHealth(h, "2026-09"),
            before = JSON.stringify(data.snapshot),
            calls = aiCalls;
          const first = await coach.analyze(h, data),
            repeated = await coach.analyze(h, data);
          assert.equal(first.status, "FALLBACK");
          assert.equal(repeated.cached, true);
          assert.equal(aiCalls, calls + 1);
          assert.equal(JSON.stringify(data.snapshot), before);
          assert.equal((await health()).snapshot.income, 540000);
        },
      );
    await t.test(
      "OpenAI: requisições simultâneas compartilham lease e cache expirado é renovado",
      async () => {
        mode = "valid";
        await prisma.financialCoachAnalysis.deleteMany({
          where: { householdId: h },
        });
        const data = await FinancialHealthService.getHealth(h, "2026-09"),
          before = aiCalls;
        await Promise.all([coach.analyze(h, data), coach.analyze(h, data)]);
        assert.equal(aiCalls, before + 1);
        await prisma.financialCoachAnalysis.updateMany({
          where: { householdId: h },
          data: { expiresAt: new Date(0) },
        });
        await coach.analyze(h, data);
        assert.equal(aiCalls, before + 2);
      },
    );
    await t.test(
      "conclusão exige valor alcançado; cancelamento preserva objetivo e histórico",
      async () => {
        assert.equal(
          (
            await request("PATCH", "/financial-goals/" + goalId, {
              status: "COMPLETED",
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request("PATCH", "/financial-goals/" + goalId, {
              targetAmount: 290000,
              status: "COMPLETED",
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (await request("DELETE", "/financial-goals/" + goalId)).statusCode,
          200,
        );
        assert.ok(
          await prisma.financialGoal.findUnique({ where: { id: goalId } }),
        );
        assert.equal(
          await prisma.goalContribution.count({ where: { goalId } }),
          2,
        );
      },
    );
    await t.test(
      "isolamento do Household em lista, edição, contribuição, simulação e metas",
      async () => {
        const outside = await request(
          "GET",
          "/financial-health/2026-09",
          undefined,
          true,
        );
        assert.equal(outside.json().snapshot.financialGoals.length, 0);
        assert.equal(outside.json().snapshot.income, 0);
        assert.equal(outside.json().snapshot.reserve.amount, 0);
        assert.equal(
          (
            await request(
              "PATCH",
              "/financial-goals/" + goalId,
              { name: "Ataque" },
              true,
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/financial-goals/${goalId}/contributions`,
              { amount: 100, date: "2026-09-15", requestId: randomUUID() },
              true,
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await request(
              "POST",
              "/financial-goals/simulate",
              { goalId, goal, monthlyContribution: 100 },
              true,
            )
          ).statusCode,
          404,
        );
        const m = await prisma.monthlyGoal.findFirstOrThrow({
          where: { householdId: h },
        });
        assert.equal(
          (
            await request(
              "PATCH",
              "/monthly-goals/" + m.id,
              { targetAmount: 1 },
              true,
            )
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      "Zod e regras rejeitam negativos, reserva duplicada, data futura e campos intrusivos",
      async () => {
        assert.equal(
          (
            await request("PATCH", "/financial-health/settings", {
              reserveInitialAmount: -1,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request("PATCH", "/financial-health/settings", {
              householdId: foreign,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request("POST", "/financial-goals", {
              ...goal,
              type: "EMERGENCY_FUND",
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request("POST", "/emergency-fund/contributions", {
              amount: 100,
              date: "2199-12-31",
              requestId: randomUUID(),
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (await request("GET", "/financial-health/2026-13")).statusCode,
          400,
        );
      },
    );
  } finally {
    await app.close();
    for (const householdId of [h, foreign]) {
      await prisma.financialCoachAnalysis.deleteMany({
        where: { householdId },
      });
      await prisma.monthlyFinancialReview.deleteMany({
        where: { householdId },
      });
      await prisma.financialRecommendationDecision.deleteMany({
        where: { householdId },
      });
      await prisma.cofluPlanItem.deleteMany({ where: { householdId } });
      await prisma.monthlyGoal.deleteMany({ where: { householdId } });
      await prisma.goalContribution.deleteMany({ where: { householdId } });
      await prisma.financialGoal.deleteMany({ where: { householdId } });
      await prisma.financialHealthSettings.deleteMany({
        where: { householdId },
      });
      await prisma.transaction.deleteMany({ where: { householdId } });
      await prisma.invoice.deleteMany({ where: { card: { householdId } } });
      await prisma.creditCard.deleteMany({ where: { householdId } });
      await prisma.account.deleteMany({ where: { householdId } });
      await prisma.category.deleteMany({ where: { householdId } });
      await prisma.user.deleteMany({ where: { householdId } });
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  }
});
