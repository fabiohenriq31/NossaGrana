import "dotenv/config";
import {
  TelegramAPI,
  SupabaseAttachmentStorage,
} from "../apps/api/src/integrations/telegram/providers";
import {
  configured,
  config,
} from "../apps/api/src/integrations/telegram/config";
async function main() {
  if (!configured())
    throw new Error(
      "Configure as variáveis da integração no ambiente do backend.",
    );
  await new SupabaseAttachmentStorage().ensurePrivateBucket();
  const telegram = new TelegramAPI();
  const me = await telegram.me();
  console.log("Bucket privado verificado. Bot: @" + me.username);
  const url = process.argv[2];
  if (!url) {
    console.log(
      "Para registrar: pnpm telegram:setup https://SEU-BACKEND/api/integrations/telegram/webhook",
    );
    return;
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/api/integrations/telegram/webhook" ||
    parsed.search ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Informe a URL HTTPS exata do endpoint no backend.");
  const health = await fetch(parsed.origin + "/api/health", {
    signal: AbortSignal.timeout(30000),
  });
  if (!health.ok) throw new Error("Backend indisponível.");
  // Verifica endpoint antes de mudar o webhook do bot. Um segredo errado deve ser rejeitado com 403.
  const probe = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30000),
  });
  if (probe.status !== 403)
    throw new Error(
      "Publique a integração no backend antes de registrar o webhook.",
    );
  const authenticatedProbe = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": config().webhookSecret,
    },
    body: "{}",
    signal: AbortSignal.timeout(30000),
  });
  if (authenticatedProbe.status !== 200)
    throw new Error(
      "As variáveis e o segredo do backend publicado precisam coincidir com este ambiente.",
    );
  await telegram.call("setWebhook", {
    url,
    secret_token: config().webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  console.log(
    "Webhook registrado. Long polling não deve ser executado simultaneamente.",
  );
}
main().catch(() => {
  console.error(
    "Não foi possível configurar a integração. Verifique as variáveis, o bucket privado e a disponibilidade do backend.",
  );
  process.exitCode = 1;
});
