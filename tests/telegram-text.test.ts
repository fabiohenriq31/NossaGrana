import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/src/db";
import { buildApp } from "../apps/api/src/app";
import { accountBalance } from "../apps/api/src/domain";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration";
import {
  normalizeUpdate,
  type Event,
} from "../apps/api/src/integrations/telegram/identity";
import {
  confirmSuggestion,
  editSuggestion,
  matchTextAccount,
} from "../apps/api/src/integrations/telegram/suggestions";
import type {
  TextAnalysis,
  TextContext,
} from "../apps/api/src/integrations/telegram/analyzer";
import { IntegrationError } from "../apps/api/src/integrations/telegram/config";
import type { Keyboard } from "../apps/api/src/integrations/telegram/providers";

const accounts = [
  {
    id: "checking",
    name: "Conta PicPay Fábio",
    owner: "Fábio",
    bank: { name: "PicPay" },
  },
  {
    id: "saving",
    name: "Cofrinho Bianca e Fábio",
    owner: "Fábio",
    bank: { name: "PicPay" },
  },
  {
    id: "bianca",
    name: "Conta PicPay Bianca",
    owner: "Bianca",
    bank: { name: "PicPay" },
  },
];
test("texto: cofrinho é distinto da conta corrente; banco ambíguo não escolhe conta", () => {
  assert.equal(
    matchTextAccount(
      accounts,
      "Conta PicPay Fábio",
      "Recebi na Conta PicPay Fábio",
    )?.id,
    "checking",
  );
  assert.equal(
    matchTextAccount(
      accounts,
      "cofrinho do PicPay",
      "Recebi 600 no cofrinho do PicPay",
    )?.id,
    "saving",
  );
  assert.equal(
    matchTextAccount(accounts, "PicPay", "Recebi 600 no PicPay"),
    null,
  );
  assert.equal(
    matchTextAccount(accounts, "PicPay Fábio", "Recebi no PicPay Fábio"),
    null,
  );
  assert.equal(
    matchTextAccount(accounts, "cofrinho", "Recebi no PicPay"),
    null,
  );
  assert.equal(
    matchTextAccount(accounts, "Santander", "Recebi no Santander"),
    null,
  );
  assert.equal(
    matchTextAccount(
      [...accounts, { ...accounts[1], id: "second" }],
      "cofrinho",
      "cofrinho",
    ),
    null,
  );
});
test("texto: preserva mensagem completa e data civil do envio para retries", () => {
  const text = "x".repeat(600) + " ainda não recebi";
  const result = normalizeUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: Date.parse("2026-09-24T01:00:00Z") / 1000,
      from: { id: 1 },
      chat: { id: 1, type: "private" },
      text,
    },
  });
  assert.equal(result?.text, text);
  assert.equal(result?.referenceDate, "2026-09-23");
});

const fixture = (): TextAnalysis => ({
  extraction: {
    documentType: "TEXT",
    transactionType: "INCOME",
    description: "Freelancer",
    amount: "600.00",
    currency: "BRL",
    transactionDate: "2026-09-24",
    transactionTime: null,
    paymentMethod: "OUTRO",
    bankName: "PicPay",
    cardLast4: null,
    payerName: null,
    recipientName: null,
    merchantName: null,
    pixKey: null,
    transactionIdentifier: null,
    categorySuggestion: "Freelancer",
    subcategorySuggestion: null,
    installments: 1,
    currentInstallment: null,
    totalInstallments: 1,
    amountMeaning: "TOTAL",
    confidence: 0.95,
    needsReview: true,
    uncertainFields: [],
    notes: null,
  },
  text: {
    eventCount: "SINGLE",
    transactionStatus: "CONFIRMADA",
    accountHint: "cofrinho do PicPay",
    destinationAccountHint: null,
  },
  model: "mock-text",
  inputTokens: 10,
  outputTokens: 10,
  totalTokens: 20,
});

test("Telegram texto: confirmação, saldo, isolamento, revisão e reentrega", async (t) => {
  process.env.NODE_ENV = "test";
  const h = "tg-text-" + randomUUID();
  const sender = String(Math.floor(1e12 + Math.random() * 1e12));
  const stranger = String(Number(sender) + 1);
  let sequence = Date.now() * 100;
  let analysis = fixture(),
    failSend = false,
    failAnalysis = false,
    calls = 0;
  let context: TextContext | undefined;
  const sent: { text: string; keyboard?: Keyboard }[] = [];
  const integration = new TelegramIntegration({
    telegram: {
      me: async () => ({ username: "test_bot" }),
      answer: async () => {},
      download: async () => {
        throw new Error("Texto não baixa arquivo");
      },
      send: async (_chat, text, keyboard) => {
        if (failSend) {
          failSend = false;
          throw new IntegrationError("SEND_FAILED", "Falha simulada", true);
        }
        sent.push({ text, keyboard });
      },
    },
    storage: {
      upload: async () => {
        throw new Error("Texto não cria anexo");
      },
      remove: async () => {},
      signedDownloadUrl: async () => "unused",
    },
    analyzer: {
      analyze: async () => {
        throw new Error("Texto não usa leitor de comprovantes");
      },
      analyzeText: async (_text, c) => {
        calls++;
        context = c;
        if (failAnalysis)
          throw new IntegrationError(
            "TEXT_ANALYSIS_FAILED",
            "Falha simulada",
            true,
          );
        return analysis;
      },
    },
  });
  const event = (
    text = "Recebi 600 reais de freelancer hoje no cofrinho do PicPay",
  ): Event => ({
    id: String(++sequence),
    senderId: sender,
    chatId: sender,
    kind: "text",
    text,
    referenceDate: "2026-09-24",
  });
  const suggest = async (message?: string) => {
    const e = event(message);
    await integration.process(e);
    return prisma.transactionSuggestion.findUniqueOrThrow({
      where: { updateId: e.id },
    });
  };
  let savingId = "";
  try {
    await prisma.household.create({ data: { id: h, name: "Coflu texto QA" } });
    const user = await prisma.user.create({
      data: {
        householdId: h,
        name: "Fábio",
        email: h + "@example.test",
        passwordHash: "unused",
      },
    });
    const userId = user.id;
    await prisma.telegramIdentity.create({
      data: {
        userId,
        telegramUserId: sender,
        telegramChatId: sender,
        verified: true,
      },
    });
    for (const a of accounts) {
      const created = await prisma.account.create({
        data: {
          householdId: h,
          bankId: "picpay",
          name: a.name,
          owner: a.owner,
          type: "Corrente",
          initialBalance: 0,
        },
      });
      if (a.id === "saving") savingId = created.id;
    }
    await t.test(
      "cria sugestão sem anexo; só confirma uma vez e credita 600 no cofrinho",
      async () => {
        const s = await suggest();
        assert.equal(s.attachmentId, null);
        assert.equal(s.suggestedAccountId, savingId);
        assert.equal(s.suggestedAmount, 60000);
        assert.equal(s.suggestedStatus, "CONFIRMADA");
        assert.equal(context?.today, "2026-09-24");
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          0,
        );
        assert.equal(
          (
            await prisma.category.findUniqueOrThrow({
              where: { id: s.suggestedCategoryId! },
            })
          ).name,
          "Outros",
        );
        assert.match(sent.at(-1)!.text, /Cofrinho Bianca e Fábio/);
        const callback = sent.at(-1)!.keyboard![0][0].callback_data;
        await integration.process({
          ...event(),
          kind: "callback",
          token: callback,
        });
        assert.match(sent.at(-1)!.text, /salvo no Coflu/);
        await confirmSuggestion(sender, s.id, s.version);
        const rows = await prisma.transaction.findMany({
          where: { householdId: h },
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].source, "TELEGRAM");
        assert.equal(accountBalance(0, savingId, rows), 60000);
        assert.equal(
          await prisma.attachment.count({ where: { householdId: h } }),
          0,
        );
      },
    );
    await t.test(
      "receita futura permanece pendente e não credita o saldo",
      async () => {
        analysis = fixture();
        analysis.text.transactionStatus = "PENDENTE";
        const s = await suggest("Vou receber 600 amanhã no cofrinho do PicPay");
        const callback = sent.at(-1)!.keyboard![0][0].callback_data;
        await integration.process({
          ...event(),
          kind: "callback",
          token: callback,
        });
        assert.match(sent.at(-1)!.text, /pendente salvo/);
        const rows = await prisma.transaction.findMany({
          where: { householdId: h },
        });
        assert.equal(
          rows.find((r) => r.suggestionId === s.id)?.status,
          "PENDENTE",
        );
        assert.equal(accountBalance(0, savingId, rows), 60000);
      },
    );
    await t.test(
      "situação desconhecida bloqueia salvar até edição explícita",
      async () => {
        analysis = fixture();
        analysis.text.transactionStatus = "UNKNOWN";
        const s = await suggest(
          "Fiz um freelancer de 600, vai pro cofrinho do PicPay",
        );
        assert.equal(s.suggestedStatus, null);
        await assert.rejects(
          () => confirmSuggestion(sender, s.id, s.version),
          /Complete/,
        );
        await integration.choices(sender, s, "status");
        assert.equal(sent.at(-1)!.keyboard!.length, 3);
        const edited = await editSuggestion(
          sender,
          s.id,
          s.version,
          "status",
          "PENDENTE",
        );
        await confirmSuggestion(sender, s.id, edited.version);
        assert.equal(
          (
            await prisma.transaction.findFirstOrThrow({
              where: { suggestionId: s.id },
            })
          ).status,
          "PENDENTE",
        );
      },
    );
    await t.test(
      "PicPay ambíguo exige escolher conta; outra identidade não confirma",
      async () => {
        analysis = fixture();
        analysis.text.accountHint = "PicPay";
        const s = await suggest("Recebi 600 no PicPay");
        assert.equal(s.suggestedAccountId, null);
        await assert.rejects(
          () => confirmSuggestion(sender, s.id, s.version),
          /Complete/,
        );
        await assert.rejects(() =>
          confirmSuggestion(stranger, s.id, s.version),
        );
        const edited = await editSuggestion(
          sender,
          s.id,
          s.version,
          "account",
          savingId,
        );
        assert.equal(edited.suggestedAccountId, savingId);
      },
    );
    await t.test(
      "conversa e múltiplos eventos não criam sugestões",
      async () => {
        for (const count of ["NONE", "MULTIPLE"] as const) {
          analysis = fixture();
          analysis.text.eventCount = count;
          const e = event("Oi / recebi 600 e paguei 100");
          await integration.process(e);
          assert.equal(
            await prisma.transactionSuggestion.count({
              where: { updateId: e.id },
            }),
            0,
          );
          assert.match(sent.at(-1)!.text, /Nada foi lançado/);
        }
      },
    );
    await t.test(
      "edição guiada tem prioridade e ajuda não chama o modelo",
      async () => {
        analysis = fixture();
        const s = await suggest();
        await integration.choices(sender, s, "description");
        const before = calls;
        await integration.process(event("Freelancer revisado"));
        assert.equal(calls, before);
        assert.equal(
          (
            await prisma.transactionSuggestion.findUniqueOrThrow({
              where: { id: s.id },
            })
          ).suggestedDescription,
          "Freelancer revisado",
        );
        await integration.process(event("/ajuda"));
        assert.equal(calls, before);
      },
    );
    await t.test(
      "fila repete falha temporária e reutiliza sugestão após falha no envio",
      async () => {
        analysis = fixture();
        const e = event();
        await integration.accept({
          update_id: Number(e.id),
          message: {
            message_id: 1,
            from: { id: Number(sender) },
            chat: { id: Number(sender), type: "private" },
            text: e.text,
          },
        });
        failAnalysis = true;
        await integration.runOne(e.id);
        assert.equal(
          (
            await prisma.telegramUpdate.findUniqueOrThrow({
              where: { id: e.id },
            })
          ).status,
          "QUEUED",
        );
        assert.equal(
          await prisma.transactionSuggestion.count({
            where: { updateId: e.id },
          }),
          0,
        );
        failAnalysis = false;
        failSend = true;
        await prisma.telegramUpdate.update({
          where: { id: e.id },
          data: { availableAt: new Date(0) },
        });
        await integration.runOne(e.id);
        const before = calls;
        await prisma.telegramUpdate.update({
          where: { id: e.id },
          data: { availableAt: new Date(0) },
        });
        await integration.runOne(e.id);
        assert.equal(calls, before);
        assert.equal(
          await prisma.transactionSuggestion.count({
            where: { updateId: e.id },
          }),
          1,
        );
        const job = await prisma.telegramUpdate.findUniqueOrThrow({
          where: { id: e.id },
        });
        assert.equal(job.status, "DONE");
        assert.deepEqual(job.payload, {});
      },
    );
    await t.test("desconectado não analisa texto", async () => {
      const before = calls;
      const e = event();
      await integration.accept({
        update_id: Number(e.id),
        message: {
          message_id: 1,
          from: { id: Number(stranger) },
          chat: { id: Number(stranger), type: "private" },
          text: e.text,
        },
      });
      await integration.runOne(e.id);
      assert.equal(calls, before);
    });
    await t.test("sugestão textual não tem URL de comprovante", async () => {
      analysis = fixture();
      const s = await suggest();
      const app = await buildApp(integration);
      try {
        const token = app.jwt.sign({ id: userId, householdId: h, version: 0 });
        const status = await app.inject({
          method: "GET",
          url: "/api/integrations/telegram",
          cookies: { ng_session: token },
        });
        assert.equal(status.statusCode, 200);
        assert.equal(status.json().supportsText, true);
        const response = await app.inject({
          method: "GET",
          url: `/api/integrations/telegram/suggestions/${s.id}/attachment`,
          cookies: { ng_session: token },
        });
        assert.equal(response.statusCode, 404);
      } finally {
        await app.close();
      }
    });
    await t.test(
      "despesa e transferência usam as contas revisadas sem duplicar receita",
      async () => {
        analysis = fixture();
        analysis.extraction.transactionType = "EXPENSE";
        analysis.extraction.description = "Serviço de teste";
        analysis.extraction.amount = "25.00";
        const expense = await suggest(
          "Paguei 25 pelo serviço com o cofrinho do PicPay",
        );
        await confirmSuggestion(sender, expense.id, expense.version);
        assert.equal(
          (
            await prisma.transaction.findFirstOrThrow({
              where: { suggestionId: expense.id },
            })
          ).type,
          "DESPESA",
        );
        analysis = fixture();
        analysis.extraction.transactionType = "TRANSFER";
        analysis.extraction.paymentMethod = "TRANSFERENCIA";
        analysis.extraction.amount = "100.00";
        analysis.text.accountHint = "Conta PicPay Fábio";
        analysis.text.destinationAccountHint = "cofrinho do PicPay";
        const transfer = await suggest(
          "Transferi 100 da Conta PicPay Fábio para o cofrinho do PicPay",
        );
        assert.equal(transfer.suggestedDestinationAccountId, savingId);
        assert.notEqual(transfer.suggestedAccountId, savingId);
        await confirmSuggestion(sender, transfer.id, transfer.version);
        const rows = await prisma.transaction.findMany({
          where: { suggestionId: transfer.id },
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "TRANSFERENCIA");
      },
    );
  } finally {
    await prisma.telegramUpdate.deleteMany({
      where: { senderId: { in: [sender, stranger] } },
    });
    await prisma.telegramCallback.deleteMany({
      where: { suggestion: { householdId: h } },
    });
    await prisma.transaction.deleteMany({ where: { householdId: h } });
    await prisma.transactionSuggestion.deleteMany({
      where: { householdId: h },
    });
    await prisma.account.deleteMany({ where: { householdId: h } });
    await prisma.category.deleteMany({ where: { householdId: h } });
    await prisma.user.deleteMany({ where: { householdId: h } });
    await prisma.household.deleteMany({ where: { id: h } });
    await prisma.$disconnect();
  }
});
