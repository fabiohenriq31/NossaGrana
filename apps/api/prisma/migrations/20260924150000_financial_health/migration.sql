-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "essentiality" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
ADD COLUMN     "expenseNature" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
ADD COLUMN     "financialRole" TEXT NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "essentiality" TEXT;

-- CreateTable
CREATE TABLE "FinancialHealthSettings" (
    "householdId" TEXT NOT NULL,
    "motivations" TEXT[],
    "reserveAnswer" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "reserveInitialAmount" INTEGER NOT NULL DEFAULT 0,
    "reserveTargetMonths" INTEGER NOT NULL DEFAULT 6,
    "reserveTargetAmount" INTEGER,
    "milestones" INTEGER[] DEFAULT ARRAY[1, 3, 6, 9, 12]::INTEGER[],
    "essentialEstimate" INTEGER,
    "essentialSource" TEXT NOT NULL DEFAULT 'OBSERVED_DATA',
    "historyStart" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialHealthSettings_pkey" PRIMARY KEY ("householdId")
);

-- CreateTable
CREATE TABLE "FinancialGoal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "memberId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'HOUSEHOLD',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "initialAmount" INTEGER NOT NULL DEFAULT 0,
    "targetDate" DATE NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "icon" TEXT NOT NULL DEFAULT 'target',
    "notes" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalContribution" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "goalId" TEXT,
    "amount" INTEGER NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "date" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyGoal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "month" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "manualProgress" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "financialGoalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'USER',
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CofluPlanItem" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'NOW',
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "financialGoalId" TEXT,
    "reserveMonths" INTEGER,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CofluPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialRecommendationDecision" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialRecommendationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyFinancialReview" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyFinancialReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCoachAnalysis" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" JSONB,
    "model" TEXT,
    "totalTokens" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialCoachAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialGoal_householdId_status_idx" ON "FinancialGoal"("householdId", "status");

-- CreateIndex
CREATE INDEX "GoalContribution_householdId_date_idx" ON "GoalContribution"("householdId", "date");

-- CreateIndex
CREATE INDEX "GoalContribution_goalId_idx" ON "GoalContribution"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalContribution_householdId_requestId_key" ON "GoalContribution"("householdId", "requestId");

-- CreateIndex
CREATE INDEX "MonthlyGoal_householdId_month_idx" ON "MonthlyGoal"("householdId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyGoal_householdId_month_sourceKey_key" ON "MonthlyGoal"("householdId", "month", "sourceKey");

-- CreateIndex
CREATE INDEX "CofluPlanItem_householdId_position_idx" ON "CofluPlanItem"("householdId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CofluPlanItem_householdId_sourceKey_key" ON "CofluPlanItem"("householdId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRecommendationDecision_householdId_month_key_key" ON "FinancialRecommendationDecision"("householdId", "month", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyFinancialReview_householdId_month_version_key" ON "MonthlyFinancialReview"("householdId", "month", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCoachAnalysis_householdId_month_fingerprint_key" ON "FinancialCoachAnalysis"("householdId", "month", "fingerprint");

-- AddForeignKey
ALTER TABLE "FinancialHealthSettings" ADD CONSTRAINT "FinancialHealthSettings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "FinancialGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_financialGoalId_fkey" FOREIGN KEY ("financialGoalId") REFERENCES "FinancialGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CofluPlanItem" ADD CONSTRAINT "CofluPlanItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CofluPlanItem" ADD CONSTRAINT "CofluPlanItem_financialGoalId_fkey" FOREIGN KEY ("financialGoalId") REFERENCES "FinancialGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialRecommendationDecision" ADD CONSTRAINT "FinancialRecommendationDecision_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyFinancialReview" ADD CONSTRAINT "MonthlyFinancialReview_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCoachAnalysis" ADD CONSTRAINT "FinancialCoachAnalysis_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defesa em profundidade: valores financeiros e classificação explícita.
ALTER TABLE "Category" ADD CONSTRAINT "Category_essentiality_valid" CHECK ("essentiality" IN ('ESSENTIAL', 'NON_ESSENTIAL', 'UNCLASSIFIED'));
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_essentiality_valid" CHECK ("essentiality" IS NULL OR "essentiality" IN ('ESSENTIAL', 'NON_ESSENTIAL', 'UNCLASSIFIED'));
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_amounts_valid" CHECK ("targetAmount" > 0 AND "initialAmount" >= 0);
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_valid" CHECK ("amount" > 0 AND "direction" IN ('DEPOSIT', 'WITHDRAWAL'));
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_amounts_valid" CHECK ("targetAmount" > 0 AND "manualProgress" >= 0);
ALTER TABLE "FinancialHealthSettings" ADD CONSTRAINT "FinancialHealthSettings_values_valid" CHECK ("reserveInitialAmount" >= 0 AND "reserveTargetMonths" BETWEEN 1 AND 60 AND ("essentialEstimate" IS NULL OR "essentialEstimate" >= 0) AND ("reserveTargetAmount" IS NULL OR "reserveTargetAmount" > 0));

-- A API autenticada é o único caminho público para estes dados.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['FinancialHealthSettings','FinancialGoal','GoalContribution','MonthlyGoal','CofluPlanItem','FinancialRecommendationDecision','MonthlyFinancialReview','FinancialCoachAnalysis'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', table_name);
    END IF;
  END LOOP;
END $$;
