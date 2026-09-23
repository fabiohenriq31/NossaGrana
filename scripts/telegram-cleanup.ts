import "dotenv/config";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration";
import { prisma } from "../apps/api/src/db";
try {
  await new TelegramIntegration().cleanup();
  console.log("Retenção aplicada a anexos não confirmados e tokens expirados.");
} catch {
  console.error("A limpeza não pôde ser concluída; tente novamente.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
