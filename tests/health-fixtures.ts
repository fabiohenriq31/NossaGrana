import type { Overview, Transaction } from "../packages/shared/src/types";
import type { GoalFields, HealthResponse } from "../packages/shared/src/health";
import { analytics } from "../apps/api/src/analytics";
import { defaultHealthSettings } from "../apps/api/src/financial-health/service";
import {
  buildMonthlySnapshot,
  type SnapshotInputs,
} from "../apps/api/src/financial-health/calculations";
import { FinancialRecommendationEngine } from "../apps/api/src/financial-health/recommendations";

let id = 0;
export function movement(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: "movement-" + ++id,
    description: "Movimento sintético",
    amount: 10000,
    date: "2026-09-10T12:00:00Z",
    competence: "2026-09",
    paymentMethod: "PIX",
    dueDate: null,
    type: "DESPESA",
    status: "CONFIRMADA",
    owner: "Pessoa Um" as Transaction["owner"],
    accountId: "account-a",
    destinationAccountId: null,
    cardId: null,
    categoryId: "essential",
    subcategoryId: null,
    invoiceId: null,
    paymentInvoiceId: null,
    notes: "",
    tags: [],
    source: "MANUAL",
    installmentNumber: null,
    installmentPurchaseId: null,
    recurringId: null,
    ...patch,
  };
}
export const travelGoal: GoalFields & { id: string } = {
  id: "travel",
  name: "Viagem sintética",
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
export function fixture(): SnapshotInputs {
  const categories = [
    {
      id: "essential",
      name: "Essencial revisada",
      essentiality: "ESSENTIAL",
      expenseNature: "FIXED",
      financialRole: "GENERAL",
      subcategories: [
        { id: "optional-sub", name: "Exceção", essentiality: "NON_ESSENTIAL" },
      ],
    },
    {
      id: "optional",
      name: "Não essencial revisada",
      essentiality: "NON_ESSENTIAL",
      expenseNature: "VARIABLE",
      financialRole: "GENERAL",
      subcategories: [],
    },
  ];
  const rows = ["2026-07", "2026-08", "2026-09"].flatMap((month) => [
    movement({
      amount: 540000,
      date: month + "-01T12:00:00Z",
      competence: month,
      type: "RECEITA",
      categoryId: null,
    }),
    movement({
      amount: 300000,
      date: month + "-05T12:00:00Z",
      competence: month,
    }),
    movement({
      amount: 162000,
      date: month + "-06T12:00:00Z",
      competence: month,
      categoryId: "optional",
    }),
  ]);
  const data = {
    user: { id: "member-a", name: "Pessoa Um", email: "private@example.test" },
    accounts: [],
    cards: [],
    categories: categories.map((c) => ({
      ...c,
      color: "#4389ff",
      icon: "wallet",
    })),
    transactions: rows,
    invoices: [
      {
        id: "invoice-opening",
        cardId: "card-a",
        competence: "2026-10",
        openingBalance: 142000,
        openingBalanceDate: "2026-09-01",
        total: 142000,
        paid: 0,
        remaining: 142000,
        closingDate: "2026-10-05",
        dueDate: "2026-10-10",
        status: "Aberta",
      },
    ],
    recurrences: [],
    banks: [],
  };
  return {
    data: {
      ...data,
      analytics: analytics(data as Omit<Overview, "analytics">, "2026-09"),
    } as Overview,
    categories,
    members: [
      { id: "member-a", name: "Pessoa Um" },
      { id: "member-b", name: "Pessoa Dois" },
    ],
    settings: { ...defaultHealthSettings, reserveInitialAmount: 750000 },
    goals: [{ ...travelGoal }],
    contributions: [],
    monthlyGoals: [],
    today: "2026-10-10",
  };
}
export function healthFixture(): HealthResponse {
  const f = fixture(),
    snapshot = buildMonthlySnapshot(f, "2026-09");
  return {
    fingerprint: "fixture",
    snapshot,
    recommendations: FinancialRecommendationEngine.generate(snapshot),
    settings: f.settings,
    members: f.members,
    categories: f.categories,
    plan: [],
    reviews: [],
  };
}
