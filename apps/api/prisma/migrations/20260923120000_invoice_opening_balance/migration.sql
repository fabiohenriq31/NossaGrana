-- Additive: existing invoices keep their totals and default to zero.
ALTER TABLE "Invoice" ADD COLUMN "openingBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "openingBalanceDate" DATE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_openingBalance_nonnegative" CHECK ("openingBalance" >= 0);
