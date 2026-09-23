import { TelegramIntegration } from "./integrations/telegram/integration";
import { configured } from "./integrations/telegram/config";
import "dotenv/config";
import { buildApp } from "./app";
import { prisma } from "./db";
const integration = new TelegramIntegration();
const app = await buildApp(integration);
if (configured()) integration.start();
const cleanup = setInterval(() => { if(configured()) void integration.cleanup().catch(() => {}); }, 3600000);
app.addHook("onClose", async () => {clearInterval(cleanup); await integration.stop();});
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3001),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
