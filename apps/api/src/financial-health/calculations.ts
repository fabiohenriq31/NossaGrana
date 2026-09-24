import type { Overview } from "../../../../packages/shared/src/types";
import type {
  HealthSettings,
  GoalFields,
  GoalView,
  MonthlyGoalFields,
  MonthlyGoalView,
  ContributionView,
  FinancialSnapshot,
  MonthlyMetrics,
  AverageMetrics,
  ReserveView,
  Commitment,
} from "../../../../packages/shared/src/health";
import { monthly } from "../analytics";
import { addMonths, nextOccurrence } from "../domain";

export const sum = (rows: { amount: number }[]) =>
  rows.reduce((n, r) => n + r.amount, 0);
export const round = (n: number) => Math.round(n * 100) / 100;
export const shiftMonth = (month: string, n: number) =>
  addMonths(new Date(month + "-01T12:00:00Z"), n)
    .toISOString()
    .slice(0, 7);
export const civilToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const netContributions = (rows: ContributionView[]) =>
  rows.reduce(
    (n, r) => n + (r.direction === "WITHDRAWAL" ? -r.amount : r.amount),
    0,
  );
export const percent = (n: number, d: number) =>
  d > 0 ? round((n / d) * 100) : null;
const progress = (n: number, d: number) =>
  d > 0 ? Math.max(0, Math.min(100, round((n / d) * 100))) : 0;
export type ClassifiedCategory = {
  id: string;
  name: string;
  essentiality: string;
  expenseNature: string;
  financialRole: string;
  subcategories: { id: string; name: string; essentiality: string | null }[];
};
export interface SnapshotInputs {
  data: Overview;
  categories: ClassifiedCategory[];
  settings: HealthSettings;
  members: { id: string; name: string }[];
  goals: (GoalFields & { id: string })[];
  contributions: ContributionView[];
  monthlyGoals: (MonthlyGoalFields & { id: string; source: string })[];
  today: string;
}
export function goalProjection(
  goal: GoalFields & { id: string },
  currentAmount: number,
  today: string,
  capacity: number | null,
): GoalView {
  const remainingAmount = Math.max(0, goal.targetAmount - currentAmount);
  const overdue = goal.targetDate < today && remainingAmount > 0;
  const monthsRemaining = overdue
    ? 0
    : Math.max(
        1,
        (Number(goal.targetDate.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
          Number(goal.targetDate.slice(5, 7)) -
          Number(today.slice(5, 7)),
      );
  const monthlyRequired = !remainingAmount
    ? 0
    : monthsRemaining
      ? Math.ceil(remainingAmount / monthsRemaining)
      : null;
  return {
    ...goal,
    currentAmount,
    remainingAmount,
    monthsRemaining,
    monthlyRequired,
    overdue,
    progress: progress(currentAmount, goal.targetAmount),
    capacityGap:
      capacity !== null && monthlyRequired !== null
        ? Math.max(0, monthlyRequired - capacity)
        : null,
  };
}
export function reserveStatus(
  settings: HealthSettings,
  amount: number,
  observed: number | null,
  previousObserved: number | null,
): ReserveView {
  const essentialMonthly =
    settings.essentialSource === "USER_ESTIMATE"
      ? settings.essentialEstimate
      : observed;
  const usable = essentialMonthly !== null && essentialMonthly > 0;
  const milestones = [
    ...new Set([...settings.milestones, settings.reserveTargetMonths]),
  ]
    .sort((a, b) => a - b)
    .map((months) => ({
      months,
      amount: usable ? essentialMonthly * months : null,
      achieved: usable && amount >= essentialMonthly * months,
    }));
  const next = milestones.find((m) => m.amount !== null && m.amount > amount);
  const targetAmount =
    settings.reserveTargetAmount ??
    (usable ? essentialMonthly * settings.reserveTargetMonths : null);
  return {
    amount,
    essentialMonthly,
    observedEssentialMonthly: observed,
    source: settings.essentialSource,
    coverageMonths: usable ? round(amount / essentialMonthly) : null,
    nextMilestoneMonths: next?.months ?? null,
    nextMilestoneAmount: next?.amount ?? null,
    remainingToMilestone:
      next?.amount != null ? Math.max(0, next.amount - amount) : null,
    progressToMilestone: next?.amount ? progress(amount, next.amount) : null,
    targetMonths: settings.reserveTargetMonths,
    targetAmount,
    targetIsCustom: settings.reserveTargetAmount !== null,
    remainingToTarget:
      targetAmount !== null ? Math.max(0, targetAmount - amount) : null,
    milestones,
    estimateDifference:
      observed !== null && settings.essentialEstimate !== null
        ? observed - settings.essentialEstimate
        : null,
    referenceChange:
      settings.essentialSource === "OBSERVED_DATA" &&
      observed !== null &&
      previousObserved !== null &&
      !settings.reserveTargetAmount
        ? (observed - previousObserved) * settings.reserveTargetMonths
        : null,
  };
}
export class FinancialProjectionService {
  static simulateGoal(
    goal: GoalFields & { id: string },
    currentAmount: number,
    today: string,
    contribution: number,
    targetAmount = goal.targetAmount,
    targetDate = goal.targetDate,
  ) {
    const projected = goalProjection(
      { ...goal, targetAmount, targetDate },
      currentAmount,
      today,
      null,
    );
    const months =
      contribution > 0
        ? Math.ceil(projected.remainingAmount / contribution)
        : null;
    return {
      ...projected,
      simulatedMonthly: contribution,
      simulatedMonths: months,
      estimatedDate:
        months !== null && months <= 1200
          ? addMonths(new Date(today + "T12:00:00Z"), months)
              .toISOString()
              .slice(0, 10)
          : null,
      includesReturns: false,
    };
  }
  static commitments(data: Overview, month: string): Commitment[] {
    const result: Commitment[] = data.invoices
      .filter((i) => i.dueDate.slice(0, 7) === month && i.remaining > 0)
      .map((i) => ({
        id: i.id,
        kind: "INVOICE",
        name:
          "Fatura · " +
          (data.cards.find((c) => c.id === i.cardId)?.name || "Cartão"),
        amount: i.remaining,
        date: i.dueDate.slice(0, 10),
        estimated: false,
      }));
    result.push(
      ...data.transactions
        .filter(
          (t) =>
            t.type === "DESPESA" &&
            t.status === "PENDENTE" &&
            !t.cardId &&
            !t.paymentInvoiceId &&
            (t.dueDate || t.date).slice(0, 7) === month,
        )
        .map((t) => ({
          id: t.id,
          kind: "PAYABLE" as const,
          name: t.description,
          amount: t.amount,
          date: (t.dueDate || t.date).slice(0, 10),
          estimated: false,
        })),
    );
    // Ocorrências ainda não geradas são projeções, nunca novos lançamentos.
    for (const r of data.recurrences.filter(
      (r) => r.active && r.template.type === "DESPESA" && !r.template.cardId,
    )) {
      let next = new Date(r.nextDate);
      const original = data.recurrences.find(
        (x) => x.id === r.id,
      ) as typeof r & { anchorDay?: number; anchorMonth?: number };
      let guard = 0;
      while (next.toISOString().slice(0, 7) <= month && guard++ < 10000) {
        const date = next.toISOString().slice(0, 10);
        if (
          date.slice(0, 7) === month &&
          !data.transactions.some(
            (t) =>
              t.recurringId === r.id &&
              (
                (t as typeof t & { occurrenceDate?: string }).occurrenceDate ||
                t.date
              ).slice(0, 10) === date,
          )
        )
          result.push({
            id: r.id + ":" + date,
            kind: "RECURRENCE",
            name: r.description,
            amount: r.amount,
            date,
            estimated: true,
          });
        next = nextOccurrence(
          next,
          r.frequency,
          r.interval,
          original.anchorDay ?? new Date(r.nextDate).getUTCDate(),
          original.anchorMonth ?? new Date(r.nextDate).getUTCMonth(),
        );
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
}
export function buildMonthlySnapshot(
  input: SnapshotInputs,
  month: string,
): FinancialSnapshot {
  const { data, settings, categories, today } = input;
  const financial = data.transactions.filter(
    (t) =>
      t.status === "CONFIRMADA" &&
      !t.paymentInvoiceId &&
      t.type !== "TRANSFERENCIA",
  );
  const firstDate = financial.map((t) => t.date.slice(0, 10)).sort()[0] || null;
  const historyStart = settings.historyStart || firstDate;
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const classified = (t: Overview["transactions"][number]) => {
    const c = categoryMap.get(t.categoryId || "");
    return (
      c?.subcategories.find((s) => s.id === t.subcategoryId)?.essentiality ??
      c?.essentiality ??
      "UNCLASSIFIED"
    );
  };
  const expensesFor = (key: string) =>
    financial.filter((t) => t.competence === key && t.type === "DESPESA");
  const metrics = (key: string): MonthlyMetrics => {
    const summary = monthly(data, key),
      expenses = expensesFor(key);
    const hasData = financial.some((t) => t.competence === key);
    const complete =
      key < today.slice(0, 7) &&
      !!historyStart &&
      historyStart <= key + "-01" &&
      (hasData || !!settings.historyStart);
    return {
      month: key,
      income: summary.income,
      expenses: summary.expenses,
      monthlyResult: summary.result,
      essentialExpenses: sum(
        expenses.filter((t) => classified(t) === "ESSENTIAL"),
      ),
      nonEssentialExpenses: sum(
        expenses.filter((t) => classified(t) === "NON_ESSENTIAL"),
      ),
      unclassifiedExpenses: sum(
        expenses.filter((t) => classified(t) === "UNCLASSIFIED"),
      ),
      complete,
      hasData,
    };
  };
  const current = metrics(month),
    previous = metrics(shiftMonth(month, -1));
  const lastClosed =
    month < today.slice(0, 7) ? month : shiftMonth(today.slice(0, 7), -1);
  const average = (end: string, count: number): AverageMetrics | null => {
    const rows = Array.from({ length: count }, (_, i) =>
      metrics(shiftMonth(end, -i)),
    );
    if (rows.some((r) => !r.complete)) return null;
    const mean = (
      field: "income" | "expenses" | "essentialExpenses" | "monthlyResult",
    ) => Math.round(rows.reduce((n, r) => n + r[field], 0) / count);
    return {
      income: mean("income"),
      expenses: mean("expenses"),
      essentialExpenses: rows.some((r) => r.unclassifiedExpenses > 0)
        ? null
        : mean("essentialExpenses"),
      result: mean("monthlyResult"),
      months: rows.map((r) => r.month).reverse(),
    };
  };
  const threeMonthAverage = average(lastClosed, 3),
    sixMonthAverage = average(lastClosed, 6);
  const preferred = sixMonthAverage || threeMonthAverage;
  const observed = preferred?.essentialExpenses ?? null;
  const previousObserved =
    average(shiftMonth(lastClosed, -1), sixMonthAverage ? 6 : 3)
      ?.essentialExpenses ?? null;
  const contributions = input.contributions.filter((c) => c.date <= today);
  const reserve = reserveStatus(
    settings,
    settings.reserveInitialAmount +
      netContributions(contributions.filter((c) => !c.goalId)),
    observed,
    previousObserved,
  );
  const savingsCapacity = preferred ? Math.max(0, preferred.result) : null;
  const financialGoals = input.goals.map((g) =>
    goalProjection(
      g,
      g.initialAmount +
        netContributions(contributions.filter((c) => c.goalId === g.id)),
      today,
      savingsCapacity,
    ),
  );
  const expenses = expensesFor(month);
  const monthContributions = contributions.filter(
    (c) => c.date.slice(0, 7) === month,
  );
  const roleAmount = (role: string) =>
    sum(
      expenses.filter(
        (t) => categoryMap.get(t.categoryId || "")?.financialRole === role,
      ),
    );
  const monthlyGoals: MonthlyGoalView[] = input.monthlyGoals
    .filter((g) => g.month === month)
    .map((g) => {
      const currentAmount =
        g.type === "CATEGORY_LIMIT"
          ? sum(expenses.filter((t) => t.categoryId === g.categoryId))
          : g.type === "SAVE_AMOUNT"
            ? Math.max(0, current.monthlyResult)
            : g.type === "EMERGENCY_FUND_CONTRIBUTION"
              ? Math.max(
                  0,
                  netContributions(monthContributions.filter((c) => !c.goalId)),
                )
              : g.type === "GOAL_CONTRIBUTION"
                ? Math.max(
                    0,
                    netContributions(
                      monthContributions.filter(
                        (c) => c.goalId === g.financialGoalId,
                      ),
                    ),
                  )
                : g.type === "DEBT_REDUCTION"
                  ? roleAmount("DEBT_PAYMENT")
                  : g.manualProgress;
      return {
        ...g,
        currentAmount,
        progress: progress(currentAmount, g.targetAmount),
        remaining: Math.max(0, g.targetAmount - currentAmount),
        withinPlan:
          g.type === "CATEGORY_LIMIT"
            ? currentAmount <= g.targetAmount
            : currentAmount >= g.targetAmount,
      };
    });
  const nextMonth = shiftMonth(month, 1),
    commitments = FinancialProjectionService.commitments(data, nextMonth);
  const currentSummary = monthly(data, month);
  const categoryBreakdown = [
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      essentiality: c.essentiality,
    })),
    { id: "unclassified", name: "Sem categoria", essentiality: "UNCLASSIFIED" },
  ]
    .map((c) => {
      const amount = sum(
        expenses.filter((t) => (t.categoryId || "unclassified") === c.id),
      );
      const prev =
        current.complete && previous.complete
          ? sum(
              expensesFor(previous.month).filter(
                (t) => (t.categoryId || "unclassified") === c.id,
              ),
            )
          : null;
      return {
        ...c,
        amount,
        previous: prev,
        variation: prev !== null ? percent(amount - prev, prev) : null,
      };
    })
    .filter((c) => c.amount > 0 || (c.previous || 0) > 0);
  const history = Array.from({ length: 7 }, (_, i) =>
    metrics(shiftMonth(month, i - 6)),
  );
  const overdueAmount =
    sum(
      data.invoices
        .filter((i) => i.dueDate.slice(0, 10) < today && i.remaining > 0)
        .map((i) => ({ amount: i.remaining })),
    ) +
    sum(
      data.transactions.filter(
        (t) =>
          t.type === "DESPESA" &&
          t.status === "PENDENTE" &&
          !t.cardId &&
          !t.paymentInvoiceId &&
          (t.dueDate || t.date).slice(0, 10) < today,
      ),
    );
  const quality =
    !current.hasData && !settings.historyStart
      ? "INSUFFICIENT"
      : current.complete &&
          threeMonthAverage &&
          current.unclassifiedExpenses === 0
        ? "SUFFICIENT"
        : "PARTIAL";
  const daysElapsed = Number(today.slice(8)),
    daysInMonth = new Date(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)),
      0,
    ).getDate();
  return {
    ...current,
    schemaVersion: 1,
    asOf: today,
    fixedExpenses: sum(
      expenses.filter(
        (t) =>
          t.recurringId ||
          categoryMap.get(t.categoryId || "")?.expenseNature === "FIXED",
      ),
    ),
    variableExpenses: sum(
      expenses.filter(
        (t) =>
          !t.recurringId &&
          categoryMap.get(t.categoryId || "")?.expenseNature === "VARIABLE",
      ),
    ),
    unclassifiedNatureExpenses: sum(
      expenses.filter(
        (t) =>
          !t.recurringId &&
          (!categoryMap.has(t.categoryId || "") ||
            categoryMap.get(t.categoryId || "")?.expenseNature ===
              "UNCLASSIFIED"),
      ),
    ),
    debtPayments: roleAmount("DEBT_PAYMENT"),
    interestAndFees: roleAmount("INTEREST_FEES"),
    subscriptionExpenses: roleAmount("SUBSCRIPTION"),
    creditCardExpenses: sum(expenses.filter((t) => t.cardId)),
    installmentsCurrentMonth: sum(
      expenses.filter((t) => t.installmentPurchaseId),
    ),
    installmentsNextMonth: sum(
      expensesFor(nextMonth).filter((t) => t.installmentPurchaseId),
    ),
    futureCommittedExpenses: sum(commitments),
    futureInvoiceCommitments: sum(
      commitments.filter((c) => c.kind === "INVOICE"),
    ),
    accountsPayable: currentSummary.payable,
    accountsReceivable: currentSummary.receivable,
    savingsAmount: Math.max(0, current.monthlyResult),
    savingsRate: percent(current.monthlyResult, current.income),
    averageEssentialExpenses: observed,
    averageIncome: preferred?.income ?? null,
    averageExpenses: preferred?.expenses ?? null,
    emergencyFundAmount: reserve.amount,
    emergencyFundCoverageMonths: reserve.coverageMonths,
    recurringExpenses: sum(expenses.filter((t) => t.recurringId)),
    overdueAmount,
    categoryBreakdown,
    personBreakdown: [...new Set(expenses.map((t) => String(t.owner)))].map(
      (name) => ({
        name,
        amount: sum(expenses.filter((t) => t.owner === name)),
        memberId:
          input.members.find(
            (m) => m.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )?.id || null,
      }),
    ),
    previousMonthComparison:
      current.complete && previous.complete
        ? {
            income: current.income - previous.income,
            expenses: current.expenses - previous.expenses,
            result: current.monthlyResult - previous.monthlyResult,
            expensesPercent: percent(
              current.expenses - previous.expenses,
              previous.expenses,
            ),
          }
        : null,
    threeMonthAverage,
    sixMonthAverage,
    history,
    commitments,
    reserve,
    financialGoals,
    goalContributions: monthContributions,
    budgetPerformance: monthlyGoals.filter((g) => g.type === "CATEGORY_LIMIT"),
    monthlyGoals,
    savingsCapacity,
    projection:
      month === today.slice(0, 7) &&
      historyStart !== null &&
      historyStart <= month + "-01" &&
      daysElapsed >= 7 &&
      current.hasData
        ? {
            result: Math.round(
              (current.monthlyResult / daysElapsed) * daysInMonth,
            ),
            method:
              "Estimativa linear: resultado por competência até hoje ÷ dias decorridos × dias do mês. Entradas e despesas pontuais podem distorcer esta estimativa; não é saldo disponível.",
          }
        : null,
    dataQuality: {
      status: quality,
      message:
        quality === "INSUFFICIENT"
          ? "Ainda não temos dados suficientes para analisar sua saúde financeira."
          : quality === "PARTIAL"
            ? "Ainda estamos conhecendo sua rotina financeira. Os dados deste período são parciais."
            : "Histórico e classificação disponíveis para os indicadores deste período.",
      completeMonths: history.filter((h) => h.complete).length,
      historyStart,
      unclassifiedPercentage: percent(
        current.unclassifiedExpenses,
        current.expenses,
      ),
      warnings: [
        ...(!threeMonthAverage
          ? [
              "Não há três meses completos de histórico. Não extrapolamos dados incompletos.",
            ]
          : []),
        ...(current.unclassifiedExpenses
          ? [
              "Revise as despesas não classificadas. Elas não são presumidas essenciais.",
            ]
          : []),
        ...(observed === null
          ? [
              "A média essencial observada exige pelo menos três meses completos, sem despesas não classificadas.",
            ]
          : []),
        "Sobra mensal não é contribuição automática. Reserva e objetivos mostram a posição declarada atual; fechamentos guardam a posição na geração.",
        "Juros, assinaturas e amortizações só são identificados por classificação explícita. O uso de cartão, por si só, não indica dívida problemática.",
      ],
    },
    indicators: [
      {
        label: "Fluxo do mês",
        state: !current.hasData
          ? "NEUTRAL"
          : current.monthlyResult < 0
            ? "ATTENTION"
            : "POSITIVE",
        reason: !current.hasData
          ? "Ainda não há movimentos confirmados."
          : "Receitas confirmadas menos despesas por competência, sem transferências nem pagamento duplicado de fatura.",
      },
      {
        label: "Reserva",
        state:
          reserve.coverageMonths === null
            ? "NEUTRAL"
            : reserve.remainingToTarget === 0
              ? "POSITIVE"
              : "ATTENTION",
        reason:
          "Comparada à sua meta escolhida; os marcos são referências educacionais, não garantia de segurança.",
      },
      {
        label: "Compromissos futuros",
        state: overdueAmount > 0 ? "ATTENTION" : "NEUTRAL",
        reason:
          "Faturas em aberto por vencimento, contas pendentes e recorrências ainda não geradas. Parcelas contidas nas faturas não são somadas novamente.",
      },
      {
        label: "Metas",
        state: !monthlyGoals.length
          ? "NEUTRAL"
          : monthlyGoals.some(
                (g) =>
                  g.type === "CATEGORY_LIMIT" &&
                  !g.withinPlan &&
                  g.status === "ACTIVE",
              )
            ? "ATTENTION"
            : "POSITIVE",
        reason:
          "Limites comparados ao gasto confirmado; aportes comparados às contribuições explícitas. Metas de poupança usam resultado, não saldo bancário.",
      },
    ],
  };
}
