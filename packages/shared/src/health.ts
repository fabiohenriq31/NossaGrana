import { z } from "zod";
import { cents, day } from "./validation";

export const healthMonth = z
  .string()
  .regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, "Mês inválido.");
export const nonnegativeMoney = z.number().int().min(0).max(1000000000);
export const essentiality = z.enum([
  "ESSENTIAL",
  "NON_ESSENTIAL",
  "UNCLASSIFIED",
]);
export const lifecycle = z.enum(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]);
export const goalType = z.enum([
  "TRAVEL",
  "CAR",
  "HOME",
  "PHONE",
  "COMPUTER",
  "WEDDING",
  "EMERGENCY_FUND",
  "DEBT_PAYOFF",
  "INVESTMENT",
  "EDUCATION",
  "OTHER",
]);
export const monthlyGoalType = z.enum([
  "SAVE_AMOUNT",
  "CATEGORY_LIMIT",
  "GOAL_CONTRIBUTION",
  "EMERGENCY_FUND_CONTRIBUTION",
  "DEBT_REDUCTION",
  "CUSTOM",
]);
export const planStage = z.enum([
  "NOW",
  "NEXT",
  "PARALLEL",
  "LATER",
  "LONG_TERM",
]);
const optionalId = z.string().min(1).max(120).nullable();
export const settingsInput = z
  .object({
    motivations: z.array(z.string().trim().min(1).max(100)).max(10),
    reserveAnswer: z.enum(["YES", "NO", "UNKNOWN"]),
    onboarded: z.boolean(),
    reserveInitialAmount: nonnegativeMoney,
    reserveTargetMonths: z.number().int().min(1).max(60),
    reserveTargetAmount: cents.nullable(),
    milestones: z
      .array(z.number().int().min(1).max(60))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, "Não repita marcos."),
    essentialEstimate: nonnegativeMoney.nullable(),
    essentialSource: z.enum(["USER_ESTIMATE", "OBSERVED_DATA"]),
    historyStart: day.nullable(),
  })
  .strict();
export const goalInput = z
  .object({
    scope: z.enum(["PERSONAL", "HOUSEHOLD"]),
    memberId: optionalId,
    name: z.string().trim().min(2).max(100),
    type: goalType,
    targetAmount: cents,
    initialAmount: nonnegativeMoney,
    targetDate: day,
    priority: z.number().int().min(1).max(5),
    status: lifecycle.default("ACTIVE"),
    icon: z.string().max(40).default("target"),
    notes: z.string().max(1500).default(""),
  })
  .strict();
export const contributionInput = z
  .object({
    amount: cents,
    direction: z.enum(["DEPOSIT", "WITHDRAWAL"]).default("DEPOSIT"),
    date: day,
    notes: z.string().max(500).default(""),
    requestId: z.string().uuid(),
  })
  .strict();
export const monthlyGoalInput = z
  .object({
    month: healthMonth,
    name: z.string().trim().min(2).max(100),
    type: monthlyGoalType,
    targetAmount: cents,
    categoryId: optionalId,
    financialGoalId: optionalId,
    userId: optionalId,
    status: lifecycle.default("ACTIVE"),
    manualProgress: nonnegativeMoney.default(0),
  })
  .strict();
export const planInput = z
  .object({
    title: z.string().trim().min(2).max(100),
    notes: z.string().max(1500).default(""),
    stage: planStage,
    position: z.number().int().min(0).max(10000).default(0),
    status: lifecycle.default("ACTIVE"),
    financialGoalId: optionalId,
    reserveMonths: z.number().int().min(1).max(60).nullable(),
  })
  .strict();
export type HealthSettings = z.infer<typeof settingsInput>;
export type GoalFields = z.infer<typeof goalInput>;
export type MonthlyGoalFields = z.infer<typeof monthlyGoalInput>;
export type PlanFields = z.infer<typeof planInput>;
export type GoalView = GoalFields & {
  id: string;
  currentAmount: number;
  remainingAmount: number;
  monthsRemaining: number;
  monthlyRequired: number | null;
  progress: number;
  overdue: boolean;
  capacityGap: number | null;
};
export type MonthlyGoalView = MonthlyGoalFields & {
  id: string;
  source: string;
  currentAmount: number;
  progress: number;
  remaining: number;
  withinPlan: boolean;
};
export type PlanView = PlanFields & {
  id: string;
  currentAmount: number | null;
  targetAmount: number | null;
  progress: number | null;
};
export type ContributionView = z.infer<typeof contributionInput> & {
  id: string;
  goalId: string | null;
};
export type Quality = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
export type IndicatorState = "POSITIVE" | "ATTENTION" | "CRITICAL" | "NEUTRAL";
export interface ReserveView {
  amount: number;
  essentialMonthly: number | null;
  observedEssentialMonthly: number | null;
  source: "USER_ESTIMATE" | "OBSERVED_DATA";
  coverageMonths: number | null;
  nextMilestoneMonths: number | null;
  nextMilestoneAmount: number | null;
  remainingToMilestone: number | null;
  progressToMilestone: number | null;
  targetMonths: number;
  targetAmount: number | null;
  targetIsCustom: boolean;
  remainingToTarget: number | null;
  milestones: { months: number; amount: number | null; achieved: boolean }[];
  estimateDifference: number | null;
  referenceChange: number | null;
}
export interface MonthlyMetrics {
  month: string;
  income: number;
  expenses: number;
  monthlyResult: number;
  essentialExpenses: number;
  nonEssentialExpenses: number;
  unclassifiedExpenses: number;
  complete: boolean;
  hasData: boolean;
}
export interface AverageMetrics {
  income: number;
  expenses: number;
  essentialExpenses: number | null;
  result: number;
  months: string[];
}
export interface Commitment {
  id: string;
  kind: "INVOICE" | "PAYABLE" | "RECURRENCE";
  name: string;
  amount: number;
  date: string;
  estimated: boolean;
}
export interface FinancialSnapshot extends MonthlyMetrics {
  schemaVersion: 1;
  asOf: string;
  fixedExpenses: number;
  variableExpenses: number;
  unclassifiedNatureExpenses: number;
  debtPayments: number;
  interestAndFees: number;
  creditCardExpenses: number;
  installmentsCurrentMonth: number;
  installmentsNextMonth: number;
  futureCommittedExpenses: number;
  futureInvoiceCommitments: number;
  accountsPayable: number;
  accountsReceivable: number;
  savingsAmount: number;
  savingsRate: number | null;
  averageEssentialExpenses: number | null;
  averageIncome: number | null;
  averageExpenses: number | null;
  emergencyFundAmount: number;
  emergencyFundCoverageMonths: number | null;
  recurringExpenses: number;
  subscriptionExpenses: number;
  overdueAmount: number;
  categoryBreakdown: {
    id: string;
    name: string;
    amount: number;
    previous: number | null;
    variation: number | null;
    essentiality: string;
  }[];
  personBreakdown: { name: string; amount: number; memberId: string | null }[];
  previousMonthComparison: {
    income: number;
    expenses: number;
    result: number;
    expensesPercent: number | null;
  } | null;
  threeMonthAverage: AverageMetrics | null;
  sixMonthAverage: AverageMetrics | null;
  history: MonthlyMetrics[];
  commitments: Commitment[];
  reserve: ReserveView;
  financialGoals: GoalView[];
  goalContributions: ContributionView[];
  budgetPerformance: MonthlyGoalView[];
  monthlyGoals: MonthlyGoalView[];
  savingsCapacity: number | null;
  projection: { result: number; method: string } | null;
  dataQuality: {
    status: Quality;
    message: string;
    completeMonths: number;
    historyStart: string | null;
    unclassifiedPercentage: number | null;
    warnings: string[];
  };
  indicators: { label: string; state: IndicatorState; reason: string }[];
}
export interface RecommendationCandidate {
  key: string;
  type: string;
  priority: number;
  title: string;
  explanation: string;
  evidence: Record<string, number | string | null>;
  dataQuality: Quality;
  href: string;
  suggestedGoal: MonthlyGoalFields | null;
  relatedEntity: string | null;
  decision: "ACCEPTED" | "IGNORED" | null;
}
export interface CoachOutput {
  summary: string;
  positivePoints: string[];
  attentionPoints: string[];
  recommendations: { candidateId: string; explanation: string }[];
  monthlyGoalSuggestions: string[];
  goalInsights: string[];
  emergencyFundInsight: string;
}
export interface HealthResponse {
  fingerprint: string;
  snapshot: FinancialSnapshot;
  recommendations: RecommendationCandidate[];
  settings: HealthSettings;
  members: { id: string; name: string }[];
  plan: PlanView[];
  categories: {
    id: string;
    name: string;
    essentiality: string;
    expenseNature: string;
    financialRole: string;
    subcategories: { id: string; name: string; essentiality: string | null }[];
  }[];
  reviews: {
    id: string;
    month: string;
    version: number;
    status: string;
    generatedAt: string;
    snapshotHash: string;
  }[];
}
