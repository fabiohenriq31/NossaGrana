import type {
  FinancialSnapshot,
  MonthlyGoalFields,
  RecommendationCandidate,
} from "../../../../packages/shared/src/health";
import { shiftMonth } from "./calculations";

export class FinancialRecommendationEngine {
  static generate(s: FinancialSnapshot): RecommendationCandidate[] {
    const result: RecommendationCandidate[] = [];
    const month =
      s.month < s.asOf.slice(0, 7) ? shiftMonth(s.month, 1) : s.month;
    const monthly = (
      type: MonthlyGoalFields["type"],
      name: string,
      targetAmount: number,
      categoryId: string | null = null,
      financialGoalId: string | null = null,
    ): MonthlyGoalFields => ({
      month,
      type,
      name,
      targetAmount,
      categoryId,
      financialGoalId,
      userId: null,
      status: "ACTIVE",
      manualProgress: 0,
    });
    const add = (
      r: Omit<RecommendationCandidate, "dataQuality" | "decision">,
    ) =>
      result.push({ ...r, dataQuality: s.dataQuality.status, decision: null });
    if (s.overdueAmount > 0)
      add({
        key: "overdue",
        type: "OVERDUE_OBLIGATIONS",
        priority: 100,
        title: "Confira os compromissos vencidos",
        explanation:
          "Existem obrigações registradas com vencimento passado e saldo em aberto. Verifique se já foram pagas antes de definir novos compromissos.",
        evidence: { overdueAmount: s.overdueAmount },
        suggestedGoal: null,
        relatedEntity: null,
        href: "/planejamento",
      });
    if (s.interestAndFees > 0)
      add({
        key: "fees",
        type: "INTEREST_AND_FEES",
        priority: 95,
        title: "Revise os juros e as taxas identificados",
        explanation:
          "Estas despesas foram classificadas explicitamente como juros ou taxas. Confira os lançamentos e as condições que originaram a cobrança.",
        evidence: { interestAndFees: s.interestAndFees },
        suggestedGoal: null,
        relatedEntity: null,
        href: "/transacoes",
      });
    if (s.reserve.coverageMonths === null)
      add({
        key: "reserve-data",
        type: "INSUFFICIENT_RESERVE_DATA",
        priority: 80,
        title: "Conheça seu custo essencial",
        explanation:
          "Ainda precisamos conhecer melhor suas despesas essenciais para calcular sua cobertura de emergência. Você pode declarar uma estimativa temporária e revisar a classificação.",
        evidence: {
          reserveAmount: s.reserve.amount,
          observedEssentialMonthly: s.reserve.observedEssentialMonthly,
        },
        suggestedGoal: null,
        relatedEntity: null,
        href: "#reserva",
      });
    let available = s.savingsCapacity ?? 0;
    const activeGoals = s.financialGoals
      .filter((g) => g.status === "ACTIVE" && g.remainingAmount > 0)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    if (
      s.reserve.remainingToMilestone !== null &&
      s.reserve.remainingToMilestone > 0
    ) {
      const amount = Math.min(
        s.reserve.remainingToMilestone,
        activeGoals.length ? Math.floor((available * 2) / 3) : available,
      );
      available -= amount;
      add({
        key: "reserve-milestone",
        type: "EMERGENCY_FUND_MILESTONE",
        priority:
          s.reserve.coverageMonths !== null &&
          s.reserve.coverageMonths <
            Math.min(...s.reserve.milestones.map((m) => m.months))
            ? 90
            : 70,
        title: "Avance no próximo marco da reserva",
        explanation:
          "Seu próximo marco é uma referência educacional. A sugestão divide a capacidade média observada com seus outros objetivos; você pode ajustar os valores ou preferir outra prioridade.",
        evidence: {
          currentFund: s.reserve.amount,
          essentialMonthly: s.reserve.essentialMonthly,
          coverageMonths: s.reserve.coverageMonths,
          nextMilestoneMonths: s.reserve.nextMilestoneMonths,
          nextMilestoneAmount: s.reserve.nextMilestoneAmount,
          remaining: s.reserve.remainingToMilestone,
          suggestedMonthly: amount,
        },
        suggestedGoal:
          amount > 0
            ? monthly(
                "EMERGENCY_FUND_CONTRIBUTION",
                "Contribuir para a reserva",
                amount,
              )
            : null,
        relatedEntity: null,
        href: "#reserva",
      });
    }
    for (const goal of activeGoals.slice(0, 2)) {
      const amount = Math.min(
        goal.remainingAmount,
        goal.monthlyRequired ?? goal.remainingAmount,
        available,
      );
      available -= amount;
      add({
        key: "goal-" + goal.id,
        type: "GOAL_PROGRESS",
        priority: 60 - goal.priority,
        title: "Planeje: " + goal.name,
        explanation: goal.overdue
          ? "O prazo escolhido já passou. Você pode revisar a data, o valor desejado ou o aporte mensal, sem considerar rendimentos."
          : goal.capacityGap
            ? "O aporte necessário supera sua capacidade média observada. Experimente ampliar o prazo ou ajustar o valor do objetivo."
            : "O valor sugerido considera a capacidade média ainda não distribuída nas outras sugestões. Não há contribuição automática.",
        evidence: {
          targetAmount: goal.targetAmount,
          currentAmount: goal.currentAmount,
          monthlyRequired: goal.monthlyRequired,
          observedCapacity: s.savingsCapacity,
          capacityGap: goal.capacityGap,
          suggestedMonthly: amount,
        },
        suggestedGoal:
          amount > 0
            ? monthly(
                "GOAL_CONTRIBUTION",
                "Contribuir: " + goal.name,
                amount,
                null,
                goal.id,
              )
            : null,
        relatedEntity: goal.id,
        href: "#objetivos",
      });
    }
    for (const c of s.categoryBreakdown
      .filter(
        (c) =>
          c.variation !== null &&
          c.variation > 0 &&
          c.previous !== null &&
          c.previous > 0 &&
          c.essentiality === "NON_ESSENTIAL",
      )
      .sort((a, b) => (b.variation || 0) - (a.variation || 0))
      .slice(0, 1))
      add({
        key: "category-" + c.id,
        type: "CATEGORY_INCREASE",
        priority: 65,
        title: "Revise os gastos com " + c.name,
        explanation:
          "O gasto confirmado aumentou em relação ao mês anterior completo. Como você classificou esta categoria como não essencial, pode avaliar um limite baseado no valor anterior, se fizer sentido para sua rotina.",
        evidence: {
          current: c.amount,
          previous: c.previous,
          variation: c.variation,
        },
        suggestedGoal: monthly(
          "CATEGORY_LIMIT",
          "Limite: " + c.name,
          c.previous!,
          c.id,
        ),
        relatedEntity: c.id,
        href: "/transacoes",
      });
    if (s.futureCommittedExpenses > 0)
      add({
        key: "future",
        type: "FUTURE_COMMITMENTS",
        priority: 50,
        title: "Considere os compromissos do próximo mês",
        explanation:
          "Faturas em aberto, pendências e recorrências previstas já comprometem parte do próximo mês. Confira a composição antes de adicionar novas parcelas.",
        evidence: {
          nextMonthCommitted: s.futureCommittedExpenses,
          installmentsNextMonth: s.installmentsNextMonth,
        },
        suggestedGoal: null,
        relatedEntity: null,
        href: "#compromissos",
      });
    if (
      s.complete &&
      s.threeMonthAverage &&
      s.history.slice(-3).every((m) => m.complete && m.monthlyResult > 0)
    )
      add({
        key: "positive-streak",
        type: "POSITIVE_RESULTS",
        priority: 40,
        title: "Você manteve resultados positivos",
        explanation:
          "Os últimos três meses completos terminaram com receitas superiores às despesas registradas. Decida explicitamente quanto deseja destinar à reserva ou a seus objetivos.",
        evidence: { averageResult: s.threeMonthAverage.result },
        suggestedGoal: null,
        relatedEntity: null,
        href: "#evolucao",
      });
    return result.sort((a, b) => b.priority - a.priority);
  }
}
