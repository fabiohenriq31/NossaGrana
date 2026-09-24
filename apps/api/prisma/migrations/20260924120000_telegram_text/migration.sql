-- Mensagens de texto não precisam de anexo. Preserva comprovantes e sugestões existentes.
ALTER TABLE "TransactionSuggestion" ALTER COLUMN "attachmentId" DROP NOT NULL;
ALTER TABLE "TransactionSuggestion" ADD COLUMN "suggestedStatus" "TransactionStatus" DEFAULT 'CONFIRMADA';
