import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthlySnapshot,
  reserveStatus,
  goalProjection,
  FinancialProjectionService,
  shiftMonth,
} from "../apps/api/src/financial-health/calculations";
import { FinancialRecommendationEngine } from "../apps/api/src/financial-health/recommendations";
import {
  coachPayload,
  validateCoachOutput,
} from "../apps/api/src/financial-health/coach";
import {
  settingsInput,
  goalInput,
  monthlyGoalInput,
  contributionInput,
  type MonthlyGoalFields,
} from "../packages/shared/src/health";
import {
  fixture,
  movement,
  travelGoal,
  healthFixture,
} from "./health-fixtures";

test("aceitação: setembro, resultado 780, economia 14,44%, reserva 2,5 meses e viagem 18%", () => {
  const s = buildMonthlySnapshot(fixture(), "2026-09");
  assert.equal(s.income, 540000);
  assert.equal(s.expenses, 462000);
  assert.equal(s.monthlyResult, 78000);
  assert.equal(s.savingsRate, 14.44);
  assert.equal(s.essentialExpenses, 300000);
  assert.equal(s.nonEssentialExpenses, 162000);
  assert.equal(s.unclassifiedExpenses, 0);
  assert.equal(s.averageEssentialExpenses, 300000);
  assert.equal(s.emergencyFundAmount, 750000);
  assert.equal(s.emergencyFundCoverageMonths, 2.5);
  assert.equal(s.reserve.nextMilestoneMonths, 3);
  assert.equal(s.reserve.nextMilestoneAmount, 900000);
  assert.equal(s.reserve.remainingToMilestone, 150000);
  assert.equal(s.reserve.targetAmount, 1800000);
  assert.equal(s.reserve.progressToMilestone, 83.33);
  assert.equal(s.financialGoals[0].progress, 18);
  assert.equal(s.futureCommittedExpenses, 142000);
  assert.equal(
    s.categoryBreakdown.reduce((n, c) => n + c.amount, 0),
    462000,
  );
  assert.equal(s.dataQuality.status, "SUFFICIENT");
  assert.equal(s.personBreakdown[0].memberId, "member-a");
});
test("snapshot: pagamentos, transferências, cancelamentos e pendências não duplicam despesas", () => {
  const f = fixture();
  f.data.transactions.push(
    movement({ amount: 90000, paymentInvoiceId: "invoice-opening" }),
    movement({
      amount: 80000,
      type: "TRANSFERENCIA",
      destinationAccountId: "account-b",
    }),
    movement({ amount: 70000, status: "CANCELADA" }),
    movement({ amount: 60000, status: "PENDENTE" }),
  );
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.expenses, 462000);
  assert.equal(s.accountsPayable, 60000);
  assert.equal(s.savingsAmount, 78000);
});
test("snapshot: parcelas são movimentos individuais, saldo importado só compõe obrigação", () => {
  const f = fixture();
  f.data.transactions.push(
    movement({
      amount: 12000,
      cardId: "card-a",
      accountId: null,
      invoiceId: "sept",
      installmentPurchaseId: "purchase",
      installmentNumber: 1,
    }),
    movement({
      amount: 12000,
      cardId: "card-a",
      accountId: null,
      invoiceId: "invoice-opening",
      installmentPurchaseId: "purchase",
      installmentNumber: 2,
      competence: "2026-10",
      date: "2026-10-10",
    }),
  );
  f.data.invoices[0].total += 12000;
  f.data.invoices[0].remaining += 12000;
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.expenses, 474000);
  assert.equal(s.installmentsCurrentMonth, 12000);
  assert.equal(s.installmentsNextMonth, 12000);
  assert.equal(s.futureCommittedExpenses, 154000);
  assert.equal(s.futureInvoiceCommitments, 154000);
});
test("snapshot: pagamento parcial reduz fatura futura sem mudar categorias", () => {
  const f = fixture();
  f.data.invoices[0].paid = 42000;
  f.data.invoices[0].remaining = 100000;
  f.data.transactions.push(
    movement({ amount: 42000, paymentInvoiceId: f.data.invoices[0].id }),
  );
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.futureCommittedExpenses, 100000);
  assert.equal(s.expenses, 462000);
});
test("classificação: subcategoria prevalece, não classificado impede média essencial inventada", () => {
  const f = fixture();
  f.data.transactions.push(
    movement({ subcategoryId: "optional-sub", amount: 20000 }),
  );
  let s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.nonEssentialExpenses, 182000);
  assert.equal(s.essentialExpenses, 300000);
  f.categories[0].essentiality = "UNCLASSIFIED";
  s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.unclassifiedExpenses, 300000);
  assert.equal(s.averageEssentialExpenses, null);
  assert.equal(s.reserve.coverageMonths, null);
});
test("juros, assinaturas e amortização somente por classificação explícita", () => {
  const f = fixture();
  for (const [role, amount] of [
    ["INTEREST_FEES", 1000],
    ["DEBT_PAYMENT", 3000],
    ["SUBSCRIPTION", 5000],
  ] as const) {
    f.categories.push({
      id: role,
      name: role,
      essentiality: "NON_ESSENTIAL",
      expenseNature: "VARIABLE",
      financialRole: role,
      subcategories: [],
    });
    f.data.transactions.push(movement({ amount, categoryId: role }));
  }
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.interestAndFees, 1000);
  assert.equal(s.debtPayments, 3000);
  assert.equal(s.subscriptionExpenses, 5000);
  assert.equal(
    s.fixedExpenses + s.variableExpenses + s.unclassifiedNatureExpenses,
    s.expenses,
  );
});
test("médias: três meses reais, seis meses ausentes e comparação de períodos completos", () => {
  const f = fixture(),
    s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.threeMonthAverage?.income, 540000);
  assert.equal(s.threeMonthAverage?.expenses, 462000);
  assert.equal(s.sixMonthAverage, null);
  assert.equal(s.previousMonthComparison?.expensesPercent, 0);
  const original = [...f.data.transactions];
  for (const [source, target] of [
    ["2026-07", "2026-04"],
    ["2026-08", "2026-05"],
    ["2026-09", "2026-06"],
  ])
    for (const t of original.filter((t) => t.competence === source))
      f.data.transactions.push({
        ...t,
        id: t.id + target,
        competence: target,
        date: t.date.replace(source, target),
      });
  assert.equal(
    buildMonthlySnapshot(f, "2026-09").sixMonthAverage?.essentialExpenses,
    300000,
  );
});
test("usuário novo com dez dias: nenhuma média ou comparação falsa, estimativa preservada", () => {
  const f = fixture();
  f.today = "2026-09-24";
  f.data.transactions = [
    movement({ date: "2026-09-15", type: "RECEITA", amount: 100000 }),
  ];
  f.data.invoices = [];
  let s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.threeMonthAverage, null);
  assert.equal(s.sixMonthAverage, null);
  assert.equal(s.previousMonthComparison, null);
  assert.equal(s.reserve.coverageMonths, null);
  assert.equal(s.projection, null);
  assert.equal(s.dataQuality.status, "PARTIAL");
  f.settings.essentialSource = "USER_ESTIMATE";
  f.settings.essentialEstimate = 300000;
  s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.reserve.source, "USER_ESTIMATE");
  assert.equal(s.reserve.coverageMonths, 2.5);
  const complete = fixture();
  complete.settings = f.settings;
  complete.settings.essentialEstimate = 250000;
  s = buildMonthlySnapshot(complete, "2026-09");
  assert.equal(s.reserve.essentialMonthly, 250000);
  assert.equal(s.reserve.observedEssentialMonthly, 300000);
  assert.equal(s.reserve.estimateDifference, 50000);
});
test("usuário vazio: insuficiente e divisor zero não produz infinito", () => {
  const f = fixture();
  f.data.transactions = [];
  f.settings.reserveInitialAmount = 0;
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.dataQuality.status, "INSUFFICIENT");
  assert.equal(s.savingsRate, null);
  assert.equal(s.reserve.coverageMonths, null);
  assert.equal(s.savingsCapacity, null);
  f.settings.essentialSource = "USER_ESTIMATE";
  f.settings.essentialEstimate = 0;
  assert.equal(buildMonthlySnapshot(f, "2026-09").reserve.coverageMonths, null);
});
for (const [fund, coverage, next] of [
  [0, 0, 1],
  [300000, 1, 3],
  [750000, 2.5, 3],
  [900000, 3, 6],
  [1800000, 6, 9],
  [2700000, 9, 12],
  [3600000, 12, null],
] as const)
  test(`reserva: ${fund} centavos cobrem ${coverage} meses e avançam o marco`, () => {
    const r = reserveStatus(fixture().settings, fund, 300000, 300000);
    assert.equal(r.coverageMonths, coverage);
    assert.equal(r.nextMilestoneMonths, next);
    assert.ok(r.remainingToTarget! >= 0);
    assert.ok(r.progressToMilestone === null || r.progressToMilestone <= 100);
  });
test("reserva: mudança essencial explica novo alvo; meta personalizada e marcos próprios", () => {
  const settings = fixture().settings;
  let r = reserveStatus(settings, 750000, 350000, 300000);
  assert.equal(r.targetAmount, 2100000);
  assert.equal(r.referenceChange, 300000);
  settings.reserveTargetMonths = 9;
  settings.milestones = [2, 4, 9];
  settings.reserveTargetAmount = 2500000;
  r = reserveStatus(settings, 750000, 300000, 300000);
  assert.equal(r.nextMilestoneMonths, 4);
  assert.equal(r.targetAmount, 2500000);
  assert.equal(r.targetIsCustom, true);
});
test("saldo de conta e sobra mensal não viram reserva nem objetivo", () => {
  const f = fixture();
  f.data.accounts.push({
    id: "rich",
    initialBalance: 99900000,
    balance: 99900000,
    openingDate: "2026-01-01",
  } as OverviewAccount);
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.reserve.amount, 750000);
  assert.equal(s.financialGoals[0].currentAmount, 270000);
});
type OverviewAccount = ReturnType<typeof fixture>["data"]["accounts"][number];
test("contribuições explícitas: reserva e objetivo separados, retiradas preservam matemática", () => {
  const f = fixture();
  f.contributions = [
    {
      id: "a",
      amount: 50000,
      goalId: null,
      direction: "DEPOSIT",
      date: "2026-09-10",
      notes: "",
      requestId: "a",
    },
    {
      id: "b",
      amount: 30000,
      goalId: "travel",
      direction: "DEPOSIT",
      date: "2026-09-10",
      notes: "",
      requestId: "b",
    },
    {
      id: "c",
      amount: 10000,
      goalId: null,
      direction: "WITHDRAWAL",
      date: "2026-09-11",
      notes: "",
      requestId: "c",
    },
  ];
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.reserve.amount, 790000);
  assert.equal(s.financialGoals[0].currentAmount, 300000);
  assert.equal(s.monthlyResult, 78000);
});
test("projeção de objetivo: 20000 em 27 meses, aporte arredondado para cima", () => {
  const g = goalProjection(
    { ...travelGoal, targetAmount: 2000000, initialAmount: 0 },
    0,
    "2026-09-24",
    35000,
  );
  assert.equal(g.monthsRemaining, 27);
  assert.equal(g.monthlyRequired, 74075);
  assert.equal(g.capacityGap, 39075);
  const simulation = FinancialProjectionService.simulateGoal(
    travelGoal,
    270000,
    "2026-09-24",
    50000,
  );
  assert.equal(simulation.simulatedMonths, 25);
  assert.equal(simulation.estimatedDate, "2028-10-24");
  assert.equal(simulation.includesReturns, false);
  const reduced = FinancialProjectionService.simulateGoal(
    travelGoal,
    270000,
    "2026-09-24",
    50000,
    1000000,
  );
  assert.equal(reduced.simulatedMonths, 15);
});
test("objetivo: prazo vencido, mesmo mês, meta ultrapassada e aporte zero", () => {
  assert.equal(
    goalProjection(
      { ...travelGoal, targetDate: "2026-08-01" },
      0,
      "2026-09-24",
      null,
    ).monthlyRequired,
    null,
  );
  assert.equal(
    goalProjection(
      { ...travelGoal, targetDate: "2026-09-30" },
      0,
      "2026-09-24",
      null,
    ).monthsRemaining,
    1,
  );
  assert.equal(
    goalProjection(travelGoal, 2000000, "2026-09-24", null).progress,
    100,
  );
  assert.equal(
    FinancialProjectionService.simulateGoal(travelGoal, 0, "2026-09-24", 0)
      .estimatedDate,
    null,
  );
});
test("metas mensais: orçamento, poupança, reserva, objetivo e personalizada", () => {
  const f = fixture();
  const base: MonthlyGoalFields = {
    month: "2026-09",
    name: "Meta",
    type: "SAVE_AMOUNT",
    targetAmount: 100000,
    categoryId: null,
    financialGoalId: null,
    userId: null,
    status: "ACTIVE",
    manualProgress: 0,
  };
  for (const type of [
    "SAVE_AMOUNT",
    "CATEGORY_LIMIT",
    "EMERGENCY_FUND_CONTRIBUTION",
    "GOAL_CONTRIBUTION",
    "CUSTOM",
  ] as const)
    f.monthlyGoals.push({
      ...base,
      id: type,
      type,
      source: "USER",
      categoryId: type === "CATEGORY_LIMIT" ? "optional" : null,
      financialGoalId: type === "GOAL_CONTRIBUTION" ? "travel" : null,
      manualProgress: type === "CUSTOM" ? 15000 : 0,
    });
  f.contributions.push(
    {
      id: "a",
      amount: 35000,
      goalId: null,
      direction: "DEPOSIT",
      date: "2026-09-10",
      notes: "",
      requestId: "a",
    },
    {
      id: "b",
      amount: 30000,
      goalId: "travel",
      direction: "DEPOSIT",
      date: "2026-09-11",
      notes: "",
      requestId: "b",
    },
  );
  const s = buildMonthlySnapshot(f, "2026-09"),
    byType = Object.fromEntries(s.monthlyGoals.map((g) => [g.type, g]));
  assert.equal(byType.SAVE_AMOUNT.currentAmount, 78000);
  assert.equal(byType.CATEGORY_LIMIT.currentAmount, 162000);
  assert.equal(byType.CATEGORY_LIMIT.withinPlan, false);
  assert.equal(byType.EMERGENCY_FUND_CONTRIBUTION.currentAmount, 35000);
  assert.equal(byType.GOAL_CONTRIBUTION.currentAmount, 30000);
  assert.equal(byType.CUSTOM.currentAmount, 15000);
  assert.equal(buildMonthlySnapshot(f, "2026-10").monthlyGoals.length, 0);
});
test("recorrências futuras estimadas não duplicam ocorrência já gerada", () => {
  const f = fixture();
  f.data.invoices = [];
  f.data.recurrences.push({
    id: "rec",
    amount: 10000,
    description: "Mensal",
    frequency: "MENSAL",
    interval: 1,
    nextDate: "2026-10-15",
    active: true,
    template: { type: "DESPESA" },
  });
  assert.equal(
    buildMonthlySnapshot(f, "2026-09").futureCommittedExpenses,
    10000,
  );
  f.data.transactions.push(
    movement({
      recurringId: "rec",
      date: "2026-10-15",
      competence: "2026-10",
      status: "PENDENTE",
      dueDate: "2026-10-15",
    }),
  );
  const s = buildMonthlySnapshot(f, "2026-09");
  assert.equal(s.futureCommittedExpenses, 10000);
  assert.equal(s.commitments.length, 1);
  assert.equal(s.commitments[0].estimated, false);
});
test("recommendations: reserva baixa e categoria crescente têm evidência e não ativam meta", () => {
  const f = fixture();
  f.settings.reserveInitialAmount = 60000;
  f.data.transactions.push(movement({ amount: 20000, categoryId: "optional" }));
  const s = buildMonthlySnapshot(f, "2026-09"),
    before = JSON.stringify(s),
    result = FinancialRecommendationEngine.generate(s);
  assert.ok(
    result.find((r) => r.type === "EMERGENCY_FUND_MILESTONE")!.priority >= 90,
  );
  assert.ok(
    result.find((r) => r.type === "CATEGORY_INCREASE")!.evidence.variation,
  );
  assert.ok(result.every((r) => Object.keys(r.evidence).length > 0));
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.monthlyGoals.length, 0);
  const contributions = result.filter(
    (r) =>
      r.suggestedGoal &&
      ["GOAL_CONTRIBUTION", "EMERGENCY_FUND_CONTRIBUTION"].includes(
        r.suggestedGoal.type,
      ),
  );
  assert.ok(
    contributions.reduce((n, r) => n + r.suggestedGoal!.targetAmount, 0) <=
      s.savingsCapacity!,
  );
  assert.ok(result.filter((r) => r.suggestedGoal).length <= 4);
});
test("sem histórico completo não afirma aumento nem capacidade inventada", () => {
  const f = fixture();
  f.today = "2026-09-10";
  f.data.transactions = f.data.transactions.filter(
    (t) => t.competence === "2026-09",
  );
  const s = buildMonthlySnapshot(f, "2026-09"),
    result = FinancialRecommendationEngine.generate(s);
  assert.equal(
    result.some((r) => r.type === "CATEGORY_INCREASE"),
    false,
  );
  assert.equal(
    result.some((r) => r.suggestedGoal),
    false,
  );
});
test("validação monetária: negativos, zero como alvo e campos extras são rejeitados", () => {
  assert.equal(
    settingsInput.safeParse({ ...fixture().settings, reserveInitialAmount: -1 })
      .success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({ ...fixture().settings, essentialEstimate: -1 })
      .success,
    false,
  );
  assert.equal(
    goalInput.safeParse({ ...travelGoal, targetAmount: 0 }).success,
    false,
  );
  assert.equal(
    contributionInput.safeParse({
      amount: -1,
      date: "2026-09-01",
      requestId: "bad",
    }).success,
    false,
  );
  assert.equal(
    monthlyGoalInput.safeParse({ householdId: "other" }).success,
    false,
  );
});
test("OpenAI: payload só contém fatos agregados; não envia nomes, e-mails, notas, contas ou comprovantes", () => {
  const health = healthFixture(),
    payload = coachPayload(health),
    serialized = JSON.stringify(payload);
  for (const secret of [
    "Pessoa Um",
    "Pessoa Dois",
    "private@example.test",
    "Viagem sintética",
    "bank",
    "password",
    "pixKey",
    "transactions",
    "notes",
  ])
    assert.equal(serialized.includes(secret), false);
  assert.equal(payload.metrics.coverageMonths, 2.5);
  assert.equal(payload.metrics.nextMonthCommitted, 142000);
});
test("OpenAI: saída estruturada interpola valores do backend; número divergente é rejeitado", () => {
  const health = healthFixture(),
    payload = coachPayload(health),
    before = JSON.stringify(health.snapshot);
  const valid = {
    summary: "Seu resultado registrado é {{result}}.",
    positivePoints: [],
    attentionPoints: [],
    recommendations: [],
    monthlyGoalSuggestions: [],
    goalInsights: [],
    emergencyFundInsight:
      "Sua reserva cobre {{coverageMonths}} de despesas essenciais.",
  };
  assert.match(
    validateCoachOutput(valid, payload).emergencyFundInsight,
    /2,5 meses/,
  );
  assert.throws(() =>
    validateCoachOutput(
      { ...valid, emergencyFundInsight: "Cobre 3,1 meses." },
      payload,
    ),
  );
  assert.throws(() =>
    validateCoachOutput({ ...valid, summary: "Valor {{inventado}}." }, payload),
  );
  assert.throws(() =>
    validateCoachOutput(
      { ...valid, monthlyGoalSuggestions: ["invented"] },
      payload,
    ),
  );
  assert.throws(() => validateCoachOutput({ summary: "invalid" }, payload));
  assert.equal(JSON.stringify(health.snapshot), before);
});
test("meses viram o ano sem perder ancoragem", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});
