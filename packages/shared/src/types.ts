export type Person = "Fábio" | "Bianca" | "Casa";
export type TransactionType = "RECEITA" | "DESPESA" | "TRANSFERENCIA";
export type Status = "CONFIRMADA" | "PENDENTE" | "CANCELADA";
export interface Bank {
  id: string;
  name: string;
}
export interface Account {
  id: string;
  bankId: string;
  name: string;
  owner: Person;
  type: string;
  initialBalance: number;
  openingDate: string;
  color: string;
  notes: string;
  balance: number;
  active: boolean;
}
export interface CreditCard {
  id: string;
  bankId: string;
  name: string;
  owner: Person;
  brand: string;
  last4: string;
  limit: number;
  paymentAccountId: string | null;
  closingDay: number;
  dueDay: number;
  color: string;
  active: boolean;
  used: number;
  available: number;
}
export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  subcategories: { id: string; name: string }[];
}
export interface Transaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  competence: string;
  paymentMethod: string;
  dueDate?: string | null;
  purchaseDate?: string;
  type: TransactionType;
  status: Status;
  owner: Person;
  accountId: string | null;
  destinationAccountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  invoiceId: string | null;
  paymentInvoiceId: string | null;
  notes: string;
  tags: string[];
  source: string;
  installmentNumber: number | null;
  installmentPurchaseId: string | null;
  recurringId: string | null;
}
export interface Invoice {
  id: string;
  cardId: string;
  competence: string;
  closingDate: string;
  dueDate: string;
  total: number;
  paid: number;
  remaining: number;
  status: string;
}
export interface Recurring {
  id: string;
  description: string;
  amount: number;
  frequency: string;
  interval: number;
  nextDate: string;
  active: boolean;
  template: Record<string, unknown>;
}
export interface Summary {
  balance: number;
  income: number;
  expenses: number;
  result: number;
  payable: number;
  receivable: number;
  payableCount: number;
  receivableCount: number;
  invoices: number;
}
export interface Analytics {
  accountTotal: number;
  month: string;
  summary: Summary;
  previous: Summary;
  history: {
    month: string;
    name: string;
    receitas: number;
    despesas: number;
  }[];
  categorySpending: {
    id: string;
    name: string;
    color: string;
    value: number;
    percentage: number;
  }[];
  personSpending: { name: string; value: number; percentage: number }[];
  wealth: { name: string; value: number }[];
}
export interface Overview {
  analytics: Analytics;
  user: { id: string; name: string; email: string };
  accounts: Account[];
  cards: CreditCard[];
  categories: Category[];
  transactions: Transaction[];
  invoices: Invoice[];
  recurrences: Recurring[];
  banks: Bank[];
}
