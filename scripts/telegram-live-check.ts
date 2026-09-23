// Verificação manual opcional: usa serviços reais e consome chamadas OpenAI.
// Documento sintético; nunca cria transações nem envia mensagens pelo bot.
import "dotenv/config";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { OpenAIReceiptAnalyzer } from "../apps/api/src/integrations/telegram/analyzer";
import {
  TelegramAPI,
  SupabaseAttachmentStorage,
} from "../apps/api/src/integrations/telegram/providers";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const storage = new SupabaseAttachmentStorage(),
  path = "verification/" + randomUUID() + ".png";
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 550 } });
  await page.setContent(
    '<html lang="pt-BR"><body style="font:24px Arial;padding:35px;background:white;color:black"><h1>COMPROVANTE DE TESTE</h1><p>PIX ENVIADO — Nubank</p><p>Valor: R$ 187,42</p><p>Data: 23/09/2026</p><p>Pagador: Fábio</p><p>Destinatário: Posto Teste</p><p>DOCUMENTO SINTÉTICO · SEM VALOR BANCÁRIO</p></body></html>',
  );
  const png = await page.screenshot(),
    pdf = await page.pdf({ format: "A4" });
  await storage.upload(path, png, "image/png");
  const signed = await storage.signedDownloadUrl(path, 60);
  const response = await fetch(signed, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("SIGNED_DOWNLOAD");
  const analyzer = new OpenAIReceiptAnalyzer(),
    results = [];
  for (const [bytes, mime] of [
    [png, "image/png"],
    [pdf, "application/pdf"],
  ] as const) {
    const r = await analyzer.analyze(
      bytes,
      mime,
      "Documento sintético de teste. Extraia os campos visíveis.",
    );
    if (
      r.extraction.amount !== "187.42" ||
      r.extraction.transactionDate !== "2026-09-23"
    )
      throw new Error("EXTRACTION_MISMATCH");
    results.push({
      mime,
      model: r.model,
      amount: r.extraction.amount,
      type: r.extraction.transactionType,
      date: r.extraction.transactionDate,
      totalTokens: r.totalTokens,
    });
  }
  await new TelegramAPI().me();
  await writeFile(
    "docs/telegram-live-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        storagePrivate: true,
        signedDownload: true,
        telegramGetMe: true,
        openai: results,
        financialWrites: false,
        messagesSent: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ storage: "ok", telegram: "ok", openai: results }),
  );
} catch (e) {
  console.error(
    "Verificação externa não concluída: " +
      ((e as { code?: string }).code || "LIVE_CHECK_FAILED"),
  );
  process.exitCode = 1;
} finally {
  await storage.remove(path).catch(() => {});
  await browser.close();
}
