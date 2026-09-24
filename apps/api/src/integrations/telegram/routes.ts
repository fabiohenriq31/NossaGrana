import type { FastifyInstance } from "fastify";
import { prisma } from "../../db";
import { fail } from "../../service";
import { configured, config, secretMatches } from "./config";
import { createLink, unlink } from "./identity";
import { TelegramIntegration } from "./integration";
export const WEBHOOK_PATH = "/api/integrations/telegram/webhook";
export async function telegramRoutes(
  app: FastifyInstance,
  integration: TelegramIntegration,
) {
  app.post(
    WEBHOOK_PATH,
    {
      bodyLimit: 64 * 1024,
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (
        !secretMatches(
          req.headers["x-telegram-bot-api-secret-token"],
          config().webhookSecret,
        )
      )
        fail("Webhook não autorizado.", 403);
      if (!configured()) fail("Integração indisponível.", 503);
      await integration.accept(req.body);
      return reply.send({ ok: true });
    },
  );
  app.get("/api/integrations/telegram", async (req) => {
    const row = await prisma.telegramIdentity.findUnique({
      where: { userId: req.user.id },
    });
    return {
      enabled: configured(),
      supportsText: true,
      connected: !!row?.verified,
      username: row?.telegramUsername || null,
    };
  });
  app.post(
    "/api/integrations/telegram/link",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req) => {
      if (!configured())
        fail("Configure a integração no servidor antes de conectar.", 503);
      const bot = await integration.deps.telegram.me();
      if (!/^[A-Za-z0-9_]+$/.test(bot.username)) fail("Bot indisponível.", 503);
      const link = await createLink(req.user.id);
      return {
        url: "https://t.me/" + bot.username + "?start=" + link.token,
        expiresAt: link.expiresAt,
      };
    },
  );
  app.delete("/api/integrations/telegram", async (req) => {
    await unlink(req.user.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>(
    "/api/integrations/telegram/suggestions/:id/attachment",
    async (req) => {
      const s = await prisma.transactionSuggestion.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
          householdId: req.user.householdId,
        },
        include: { attachment: true },
      });
      if (!s?.attachment || s.attachment.processingStatus !== "STORED")
        fail("Comprovante indisponível.", 404);
      return {
        url: await integration.deps.storage.signedDownloadUrl(
          s.attachment.storagePath,
          300,
        ),
      };
    },
  );
}
