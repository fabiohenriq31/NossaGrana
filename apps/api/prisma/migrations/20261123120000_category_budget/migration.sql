-- Orçamento mensal por categoria (envelopes). Aditiva: não altera registros existentes.
ALTER TABLE "Category" ADD COLUMN "monthlyBudget" INTEGER;
ALTER TABLE "Category" ADD CONSTRAINT "Category_monthlyBudget_check" CHECK ("monthlyBudget" IS NULL OR "monthlyBudget" >= 0);
