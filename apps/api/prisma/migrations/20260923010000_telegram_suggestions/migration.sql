-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "suggestionId" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "processingStatus" TEXT NOT NULL DEFAULT 'STORED',
ADD COLUMN     "sha256" TEXT;

-- CreateTable
CREATE TABLE "TelegramIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "editSuggestionId" TEXT,
    "editField" TEXT,
    "editExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkToken" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSuggestion" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "TransactionSource" NOT NULL DEFAULT 'TELEGRAM',
    "attachmentId" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "suggestedType" "TransactionType",
    "suggestedDescription" TEXT,
    "suggestedAmount" INTEGER,
    "suggestedDate" DATE,
    "suggestedPaymentMethod" "PaymentMethod",
    "suggestedAccountId" TEXT,
    "suggestedDestinationAccountId" TEXT,
    "suggestedCreditCardId" TEXT,
    "suggestedCategoryId" TEXT,
    "suggestedSubcategoryId" TEXT,
    "suggestedOwner" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewReasons" TEXT[],
    "rawExtraction" JSONB NOT NULL,
    "transactionIdentifierHash" TEXT,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramCallback" (
    "token" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "value" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramCallback_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramIdentity_userId_key" ON "TelegramIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramIdentity_telegramUserId_key" ON "TelegramIdentity"("telegramUserId");

-- CreateIndex
CREATE INDEX "TelegramLinkToken_userId_expiresAt_idx" ON "TelegramLinkToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "TelegramUpdate_status_availableAt_idx" ON "TelegramUpdate"("status", "availableAt");

-- CreateIndex
CREATE INDEX "TelegramUpdate_senderId_createdAt_idx" ON "TelegramUpdate"("senderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSuggestion_attachmentId_key" ON "TransactionSuggestion"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSuggestion_updateId_key" ON "TransactionSuggestion"("updateId");

-- CreateIndex
CREATE INDEX "TransactionSuggestion_householdId_status_createdAt_idx" ON "TransactionSuggestion"("householdId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionSuggestion_householdId_transactionIdentifierHash_idx" ON "TransactionSuggestion"("householdId", "transactionIdentifierHash");

-- CreateIndex
CREATE INDEX "TransactionSuggestion_userId_status_idx" ON "TransactionSuggestion"("userId", "status");

-- CreateIndex
CREATE INDEX "TelegramCallback_suggestionId_idx" ON "TelegramCallback"("suggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_householdId_sha256_key" ON "Attachment"("householdId", "sha256");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "TransactionSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramIdentity" ADD CONSTRAINT "TelegramIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkToken" ADD CONSTRAINT "TelegramLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_suggestedAccountId_fkey" FOREIGN KEY ("suggestedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_suggestedDestinationAccountId_fkey" FOREIGN KEY ("suggestedDestinationAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_suggestedCreditCardId_fkey" FOREIGN KEY ("suggestedCreditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSuggestion" ADD CONSTRAINT "TransactionSuggestion_suggestedSubcategoryId_fkey" FOREIGN KEY ("suggestedSubcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramCallback" ADD CONSTRAINT "TelegramCallback_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "TransactionSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integração privada: acesso exclusivamente pela API autenticada.
DO $$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOREACH table_name IN ARRAY ARRAY['TelegramIdentity','TelegramLinkToken','TelegramUpdate','TransactionSuggestion','TelegramCallback'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;
