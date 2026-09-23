import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/src/db";
import { buildApp } from "../apps/api/src/app";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration";
import {
  createLink,
  consumeLink,
  normalizeUpdate,
  unlink,
  type Event,
} from "../apps/api/src/integrations/telegram/identity";
import {
  moneyToCents,
  civilDate,
  sanitizeExtraction,
  type Extraction,
} from "../apps/api/src/integrations/telegram/analyzer";
import {
  config,
  hash,
  MAX_FILE_BYTES,
  secretMatches,
  validateFile,
  IntegrationError,
} from "../apps/api/src/integrations/telegram/config";
import {
  confirmSuggestion,
  editSuggestion,
  matchExtraction,
  householdChoices,
  rejectSuggestion,
} from "../apps/api/src/integrations/telegram/suggestions";
import { accountBalance } from "../apps/api/src/domain";
import type { Keyboard } from "../apps/api/src/integrations/telegram/providers";
const fixture: Extraction = {
  documentType: "PIX",
  transactionType: "EXPENSE",
  description: "Posto teste",
  amount: "187.42",
  currency: "BRL",
  transactionDate: "2026-09-23",
  transactionTime: null,
  paymentMethod: "PIX",
  bankName: "Nubank",
  cardLast4: null,
  payerName: "Fábio",
  recipientName: "Posto teste",
  merchantName: "Posto teste",
  pixKey: null,
  transactionIdentifier: null,
  categorySuggestion: "Combustível",
  subcategorySuggestion: null,
  installments: 1,
  currentInstallment: null,
  totalInstallments: 1,
  amountMeaning: "TOTAL",
  confidence: 0.95,
  needsReview: false,
  uncertainFields: [],
  notes: null,
};
test("matching: transferência entre contas do mesmo titular exige revisão", () => {
  const choices = {
    accounts: [],
    cards: [],
    categories: [],
    users: [{ name: "Fábio" }],
  };
  const result = matchExtraction(
    { ...fixture, payerName: "Fábio", recipientName: "Fábio" },
    choices,
  );
  assert.equal(result.suggestedType, "TRANSFERENCIA");
  assert.equal(result.suggestedDestinationAccountId, null);
});
test("extração: centavos inteiros e rejeição de valores ambíguos", () => {
  assert.equal(moneyToCents("187,42"), 18742);
  assert.equal(moneyToCents("0.01"), 1);
  for (const v of [
    "1.234,56",
    "12",
    "-1.00",
    "1e4",
    "0.00",
    "99999999.99",
    null,
  ])
    assert.equal(moneyToCents(v), null);
});
test("data civil brasileira preservada e datas inexistentes rejeitadas", () => {
  assert.equal(
    civilDate("2026-09-23")?.toISOString(),
    "2026-09-23T12:00:00.000Z",
  );
  assert.equal(civilDate("2026-02-30"), null);
});
test("PAN e chave PIX não persistem na extração", () => {
  const e = sanitizeExtraction({
    ...fixture,
    notes: "cartão 4111 1111 1111 1111",
    cardLast4: "4111111111111111",
    pixKey: "private",
    transactionIdentifier: "123",
  });
  assert.equal(e.cardLast4, null);
  assert.equal(e.pixKey, null);
  assert.equal(e.transactionIdentifier, null);
  assert.ok(!JSON.stringify(e).includes("4111"));
});
test("segredo obrigatório e comparação estrita", () => {
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches("a".repeat(32), "b".repeat(32)), false);
  assert.equal(secretMatches("a".repeat(32), "a".repeat(32)), true);
});
test("MIME, assinatura e tamanho precisam concordar", () => {
  assert.equal(
    validateFile(Buffer.from("%PDF-1.7\n"), "application/pdf"),
    "application/pdf",
  );
  assert.throws(() => validateFile(Buffer.from("<script>"), "application/pdf"));
  assert.throws(() =>
    validateFile(Buffer.alloc(MAX_FILE_BYTES + 1), "image/png"),
  );
});
test("grupos, IDs não seguros e bots não entram no fluxo privado", () => {
  assert.equal(
    normalizeUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 12 },
        chat: { id: -12, type: "group" },
        text: "hi",
      },
    }),
    null,
  );
  assert.equal(
    normalizeUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: Number.MAX_SAFE_INTEGER + 1 },
        chat: { id: 12, type: "private" },
      },
    }),
    null,
  );
});
test("Telegram: fluxo real no banco isolado, provedores externos simulados", async (t) => {
  process.env.NODE_ENV = "test";
  const h = "tg-test-" + randomUUID(),
    foreign = h + "-other";
  const sender = String(Math.floor(1e12 + Math.random() * 1e12)),
    stranger = String(Number(sender) + 1);
  let sequence = Date.now() * 100 + Math.floor(Math.random() * 100);
  let extraction: Extraction = { ...fixture },
    bytes: Uint8Array = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  let downloads = 0,
    analyses = 0,
    uploads = 0,
    failStorage = false,
    failAnalysis = false;
  const sent: { chat: string; text: string; keyboard?: Keyboard }[] = [];
  const integration = new TelegramIntegration({
    telegram: {
      me: async () => ({ username: "test_bot" }),
      send: async (chat, text, keyboard) => {
        sent.push({ chat, text, keyboard });
      },
      answer: async () => {},
      download: async () => {
        downloads++;
        return bytes;
      },
    },
    storage: {
      upload: async () => {
        uploads++;
        if (failStorage)
          throw new IntegrationError("STORAGE_UPLOAD", "Falha simulada.", true);
      },
      signedDownloadUrl: async () => "https://example.test/private",
      remove: async () => {},
    },
    analyzer: {
      analyze: async () => {
        analyses++;
        if (failAnalysis)
          throw new IntegrationError(
            "ANALYSIS_FAILED",
            "Falha simulada.",
            true,
          );
        return {
          extraction: { ...extraction },
          model: "mock-test",
          inputTokens: 100,
          outputTokens: 80,
          totalTokens: 180,
        };
      },
    },
  });
  const app = await buildApp(integration);
  let userId = "",
    foreignUser = "",
    accountId = "",
    destinationId = "",
    cardId = "",
    categoryId = "";
  const event = (overrides: Partial<Event> = {}): Event => ({
    id: String(++sequence),
    senderId: sender,
    chatId: sender,
    kind: "document",
    fileId: "test-file",
    mime: "image/png",
    fileSize: 50,
    ...overrides,
  });
  const update = (id = ++sequence, text?: string, who = sender) => ({
    update_id: id,
    message: {
      message_id: 1,
      from: { id: Number(who) },
      chat: { id: Number(who), type: "private" },
      ...(text
        ? { text }
        : {
            document: {
              file_id: "test-file",
              file_size: 50,
              mime_type: "image/png",
            },
          }),
    },
  });
  const newDocument = async (patch: Partial<Extraction> = {}) => {
    extraction = { ...fixture, ...patch };
    bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from(randomUUID()),
    ]);
    const e = event();
    await integration.process(e);
    return prisma.transactionSuggestion.findUniqueOrThrow({
      where: { updateId: e.id },
    });
  };
  const balance = async (id: string) =>
    accountBalance(
      100000,
      id,
      await prisma.transaction.findMany({ where: { householdId: h } }),
    );
  try {
    await prisma.household.createMany({
      data: [
        { id: h, name: "Telegram QA" },
        { id: foreign, name: "Outra família QA" },
      ],
    });
    const u = await prisma.user.create({
      data: {
        householdId: h,
        name: "Fábio",
        email: h + "@example.test",
        passwordHash: "unused",
      },
    });
    userId = u.id;
    foreignUser = (
      await prisma.user.create({
        data: {
          householdId: foreign,
          name: "Bianca",
          email: foreign + "@example.test",
          passwordHash: "unused",
        },
      })
    ).id;
    for (const [name, owner] of [
      ["Nubank Fábio", "Fábio"],
      ["Nubank Bianca", "Bianca"],
    ]) {
      const a = await prisma.account.create({
        data: {
          householdId: h,
          bankId: "nubank",
          name,
          owner,
          type: "Corrente",
          initialBalance: 100000,
        },
      });
      if (owner === "Fábio") accountId = a.id;
      else destinationId = a.id;
    }
    categoryId = (
      await prisma.category.create({
        data: {
          householdId: h,
          name: "Combustível",
          color: "#ff0000",
          icon: "car",
        },
      })
    ).id;
    cardId = (
      await prisma.creditCard.create({
        data: {
          householdId: h,
          bankId: "nubank",
          name: "Nubank QA",
          owner: "Fábio",
          brand: "Mastercard",
          last4: "4582",
          limit: 1000000,
          closingDay: 15,
          dueDay: 22,
          color: "#8000ff",
        },
      })
    ).id;
    await t.test(
      "não vinculado não baixa documento nem aciona OpenAI",
      async () => {
        const u = update();
        await integration.accept(u);
        await integration.runOne(String(u.update_id));
        assert.equal(downloads, 0);
        assert.equal(analyses, 0);
        assert.match(sent.at(-1)!.text, /Configurações/);
      },
    );
    await t.test(
      "token temporário contém apenas aleatoriedade e hash é persistido",
      async () => {
        const link = await createLink(userId);
        assert.equal(link.token.length, 32);
        assert.ok(!link.token.includes(userId));
        const parsed = normalizeUpdate(
          update(++sequence, "/start " + link.token),
        )!;
        assert.equal(parsed.linkHash, hash(link.token));
        assert.ok(!JSON.stringify(parsed).includes(link.token));
        await integration.process(parsed);
        assert.match(sent.at(-1)!.text, /Olá, Fábio/);
        await assert.rejects(() => consumeLink(parsed), /expirou|usado/);
      },
    );
    await t.test("token expirado não vincula outro usuário", async () => {
      const link = await createLink(foreignUser);
      await prisma.telegramLinkToken.update({
        where: { tokenHash: hash(link.token) },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(() =>
        consumeLink(
          event({
            kind: "start",
            senderId: stranger,
            chatId: stranger,
            linkHash: hash(link.token),
          }),
        ),
      );
    });
    await t.test("/start usa o nome real do cadastro", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { name: "Nome de teste" },
      });
      await integration.process(event({ kind: "start" }));
      assert.match(sent.at(-1)!.text, /Nome de teste/);
      await prisma.user.update({
        where: { id: userId },
        data: { name: "Fábio" },
      });
    });
    await t.test(
      "foto cria apenas sugestão com metadados e sem alterar saldos",
      async () => {
        const s = await newDocument();
        assert.equal(s.suggestedAmount, 18742);
        assert.equal(s.suggestedAccountId, accountId);
        assert.equal(s.suggestedCategoryId, categoryId);
        assert.equal(s.totalTokens, 180);
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          0,
        );
        assert.equal(await balance(accountId), 100000);
        assert.equal(s.suggestedDate?.toISOString().slice(0, 10), "2026-09-23");
      },
    );
    await t.test(
      "confirmação PIX atômica, concorrente e sem duplicata",
      async () => {
        const s = await newDocument();
        const results = await Promise.all([
          confirmSuggestion(sender, s.id, s.version),
          confirmSuggestion(sender, s.id, s.version),
        ]);
        assert.equal(results.filter((r) => !r.already).length, 1);
        assert.equal(
          await prisma.transaction.count({ where: { suggestionId: s.id } }),
          1,
        );
        assert.equal(await balance(accountId), 81258);
      },
    );
    await t.test(
      "descarte não cria transação e bloqueia confirmação posterior",
      async () => {
        const s = await newDocument();
        assert.ok(await rejectSuggestion(sender, s.id, s.version));
        await assert.rejects(() => confirmSuggestion(sender, s.id, s.version));
        assert.equal(
          await prisma.transaction.count({ where: { suggestionId: s.id } }),
          0,
        );
      },
    );
    await t.test(
      "receita aumenta saldo sem ser convertida em despesa",
      async () => {
        const before = await balance(accountId),
          s = await newDocument({
            transactionType: "INCOME",
            amount: "750.00",
            payerName: "Empresa",
            recipientName: "Fábio",
          });
        await confirmSuggestion(sender, s.id, s.version);
        assert.equal(await balance(accountId), before + 75000);
      },
    );
    await t.test(
      "transferência usa Transfer e movimenta as duas contas",
      async () => {
        const a = await balance(accountId),
          b = await balance(destinationId);
        let s = await newDocument({
          transactionType: "TRANSFER",
          payerName: "Fábio",
          recipientName: "Bianca",
          amount: "50.00",
          paymentMethod: "TRANSFERENCIA",
        });
        assert.equal(s.suggestedType, "TRANSFERENCIA");
        s = await editSuggestion(
          sender,
          s.id,
          s.version,
          "destination",
          destinationId,
        );
        await confirmSuggestion(sender, s.id, s.version);
        assert.equal(await balance(accountId), a - 5000);
        assert.equal(await balance(destinationId), b + 5000);
        assert.equal(
          await prisma.transfer.count({
            where: { transaction: { suggestionId: s.id } },
          }),
          1,
        );
      },
    );
    await t.test(
      "crédito usa cartão e fatura sem reduzir saldo bancário",
      async () => {
        const before = await balance(accountId),
          s = await newDocument({
            paymentMethod: "CREDITO",
            cardLast4: "4582",
            amount: "90.00",
          });
        assert.equal(s.suggestedCreditCardId, cardId);
        assert.equal(s.suggestedAccountId, null);
        await confirmSuggestion(sender, s.id, s.version);
        const row = await prisma.transaction.findFirstOrThrow({
          where: { suggestionId: s.id },
        });
        assert.ok(row.invoiceId);
        assert.equal(row.source, "TELEGRAM");
        assert.equal(await balance(accountId), before);
      },
    );
    await t.test(
      "parcelas exigem revisão de total e quantidade e mantêm soma exata",
      async () => {
        let s = await newDocument({
          paymentMethod: "CREDITO",
          cardLast4: "4582",
          amount: "100.01",
          installments: 3,
          totalInstallments: 3,
          amountMeaning: "INSTALLMENT",
        });
        await assert.rejects(
          () => confirmSuggestion(sender, s.id, s.version),
          /TOTAL/,
        );
        s = await editSuggestion(sender, s.id, s.version, "amount", "100,01");
        s = await editSuggestion(sender, s.id, s.version, "installments", "3");
        await confirmSuggestion(sender, s.id, s.version);
        const rows = await prisma.transaction.findMany({
          where: { suggestionId: s.id },
        });
        assert.equal(rows.length, 3);
        assert.equal(
          rows.reduce((n, r) => n + r.amount, 0),
          10001,
        );
        assert.ok(rows.every((r) => r.installmentPurchaseId));
      },
    );
    await t.test(
      "tipo desconhecido e valor ausente impedem confirmação",
      async () => {
        const s = await newDocument({
          transactionType: "UNKNOWN",
          amount: null,
        });
        await assert.rejects(() => confirmSuggestion(sender, s.id, s.version));
        assert.equal(s.suggestedAmount, null);
      },
    );
    await t.test(
      "mesmo banco com dois titulares exige escolha, sem seleção arbitrária",
      async () => {
        const s = await newDocument({ payerName: null });
        assert.equal(s.suggestedAccountId, null);
        await assert.rejects(() => confirmSuggestion(sender, s.id, s.version));
      },
    );
    await t.test(
      "últimos quatro dígitos desconhecidos não escolhem cartão",
      async () => {
        const s = await newDocument({
          paymentMethod: "CREDITO",
          cardLast4: "9999",
        });
        assert.equal(s.suggestedCreditCardId, null);
      },
    );
    await t.test(
      "categoria desconhecida usa Outros sem criar a categoria inventada",
      async () => {
        const s = await newDocument({
          categorySuggestion: "Categoria inventada",
        });
        const fallback = await prisma.category.findUniqueOrThrow({
          where: { id: s.suggestedCategoryId! },
        });
        assert.equal(fallback.name, "Outros");
        const second = await newDocument({ categorySuggestion: null });
        assert.equal(second.suggestedCategoryId, fallback.id);
        assert.equal(
          await prisma.category.count({ where: { householdId: h } }),
          2,
        );
        await confirmSuggestion(sender, second.id, second.version);
        assert.equal(
          (
            await prisma.transaction.findFirstOrThrow({
              where: { suggestionId: second.id },
            })
          ).categoryId,
          fallback.id,
        );
      },
    );
    await t.test(
      "categoria com acento diferente corresponde à categoria real",
      async () => {
        const c = await householdChoices(h);
        assert.equal(
          matchExtraction({ ...fixture, categorySuggestion: "combustivel" }, c)
            .suggestedCategoryId,
          categoryId,
        );
      },
    );
    await t.test(
      "duplicata exata é detectada antes de outra análise",
      async () => {
        const s = await newDocument(),
          before = analyses;
        await integration.process(event());
        assert.equal(analyses, before);
        assert.equal(
          await prisma.transactionSuggestion.count({
            where: { attachmentId: s.attachmentId },
          }),
          1,
        );
        assert.ok(sent.some((x) => x.text.includes("DUPLICATA EXATA")));
      },
    );
    await t.test(
      "possível duplicata financeira é sinalizada sem bloquear novo evento",
      async () => {
        const s = await newDocument();
        assert.equal(s.possibleDuplicate, true);
      },
    );
    await t.test(
      "update_id repetido persiste uma única tarefa e sugestão",
      async () => {
        extraction = { ...fixture };
        bytes = Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          Buffer.from(randomUUID()),
        ]);
        const u = update();
        await integration.accept(u);
        await integration.accept(u);
        await integration.runOne(String(u.update_id));
        await integration.runOne(String(u.update_id));
        assert.equal(
          await prisma.transactionSuggestion.count({
            where: { updateId: String(u.update_id) },
          }),
          1,
        );
        const row = await prisma.telegramUpdate.findUniqueOrThrow({
          where: { id: String(u.update_id) },
        });
        assert.equal(row.status, "DONE");
        assert.deepEqual(row.payload, {});
      },
    );
    await t.test(
      "outro household não confirma nem edita sugestão",
      async () => {
        const link = await createLink(foreignUser);
        await consumeLink(
          event({
            kind: "start",
            senderId: stranger,
            chatId: stranger,
            linkHash: hash(link.token),
          }),
        );
        const s = await newDocument();
        await assert.rejects(() =>
          confirmSuggestion(stranger, s.id, s.version),
        );
        await assert.rejects(() =>
          editSuggestion(stranger, s.id, s.version, "amount", "1.00"),
        );
      },
    );
    await t.test("seleção de conta estrangeira é rejeitada", async () => {
      const a = await prisma.account.create({
        data: {
          householdId: foreign,
          bankId: "nubank",
          name: "Estrangeira",
          owner: "Casa",
          type: "Corrente",
          initialBalance: 0,
        },
      });
      const s = await newDocument();
      await assert.rejects(() =>
        editSuggestion(sender, s.id, s.version, "account", a.id),
      );
    });
    await t.test(
      "arquivo com extensão permitida e conteúdo falso é rejeitado",
      async () => {
        bytes = Buffer.from("<html>");
        const before = analyses;
        await assert.rejects(() => integration.process(event()));
        assert.equal(analyses, before);
      },
    );
    await t.test(
      "arquivo acima do limite é recusado antes do download",
      async () => {
        const before = downloads;
        await assert.rejects(() =>
          integration.process(event({ fileSize: MAX_FILE_BYTES + 1 })),
        );
        assert.equal(downloads, before);
      },
    );
    await t.test("PDF é aceito sem criar lançamento definitivo", async () => {
      extraction = { ...fixture };
      bytes = Buffer.from("%PDF-1.7 synthetic " + randomUUID());
      const e = event({ mime: "application/pdf" });
      await integration.process(e);
      const s = await prisma.transactionSuggestion.findUniqueOrThrow({
        where: { updateId: e.id },
      });
      assert.equal(
        await prisma.transaction.count({ where: { suggestionId: s.id } }),
        0,
      );
    });
    await t.test("falha OpenAI não cria sugestão ou transação", async () => {
      failAnalysis = true;
      const before = await prisma.transaction.count({
        where: { householdId: h },
      });
      const count = await prisma.transactionSuggestion.count({
        where: { householdId: h },
      });
      await assert.rejects(() => newDocument());
      assert.equal(
        await prisma.transactionSuggestion.count({ where: { householdId: h } }),
        count,
      );
      assert.equal(
        await prisma.transaction.count({ where: { householdId: h } }),
        before,
      );
      failAnalysis = false;
    });
    await t.test(
      "falha Storage não chama OpenAI e mantém checkpoint para retry",
      async () => {
        failStorage = true;
        const before = analyses;
        await assert.rejects(() => newDocument());
        assert.equal(analyses, before);
        failStorage = false;
      },
    );
    await t.test(
      "callback adulterado e botão de outro usuário são rejeitados",
      async () => {
        await assert.rejects(() =>
          integration.callback(event({ kind: "callback", token: "fake" })),
        );
        const s = await newDocument(),
          button = await integration.button(s, "Confirmar", "confirm");
        assert.equal(button.callback_data.length, 32);
        assert.ok(!button.callback_data.includes(accountId));
        await assert.rejects(() =>
          integration.callback(
            event({
              kind: "callback",
              senderId: stranger,
              chatId: stranger,
              token: button.callback_data,
            }),
          ),
        );
      },
    );
    await t.test(
      "edição invalida botão antigo e permite confirmar versão atual",
      async () => {
        let s = await newDocument();
        const old = await integration.button(s, "Confirmar", "confirm");
        s = await editSuggestion(sender, s.id, s.version, "amount", "1,23");
        await assert.rejects(
          () =>
            integration.callback(
              event({ kind: "callback", token: old.callback_data }),
            ),
          /mudou/,
        );
        await confirmSuggestion(sender, s.id, s.version);
        assert.equal(
          (
            await prisma.transaction.findFirstOrThrow({
              where: { suggestionId: s.id },
            })
          ).amount,
          123,
        );
      },
    );
    await t.test(
      "webhook exige segredo, não cookie; configuração exige login",
      async () => {
        const unauthorized = await app.inject({
          method: "POST",
          url: "/api/integrations/telegram/webhook",
          payload: {},
        });
        assert.equal(unauthorized.statusCode, 403);
        const valid = await app.inject({
          method: "POST",
          url: "/api/integrations/telegram/webhook",
          headers: {
            "x-telegram-bot-api-secret-token": config().webhookSecret,
          },
          payload: {},
        });
        assert.equal(valid.statusCode, 200);
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/integrations/telegram/link",
            })
          ).statusCode,
          401,
        );
      },
    );
    await t.test("retentativa persistida após falha externa", async () => {
      bytes = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from(randomUUID()),
      ]);
      extraction = { ...fixture };
      const u = update();
      await integration.accept(u);
      failStorage = true;
      await integration.runOne(String(u.update_id));
      assert.equal(
        (
          await prisma.telegramUpdate.findUniqueOrThrow({
            where: { id: String(u.update_id) },
          })
        ).status,
        "QUEUED",
      );
      failStorage = false;
      await prisma.telegramUpdate.update({
        where: { id: String(u.update_id) },
        data: { availableAt: new Date(0) },
      });
      await integration.runOne(String(u.update_id));
      assert.equal(
        await prisma.transactionSuggestion.count({
          where: { updateId: String(u.update_id) },
        }),
        1,
      );
    });
    await t.test("sugestão expirada não pode ser confirmada", async () => {
      const s = await newDocument();
      await prisma.transactionSuggestion.update({
        where: { id: s.id },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(
        () => confirmSuggestion(sender, s.id, s.version),
        /encerrada/,
      );
    });
    await t.test("desvinculação revoga confirmação imediatamente", async () => {
      const s = await newDocument();
      await unlink(userId);
      await assert.rejects(() => confirmSuggestion(sender, s.id, s.version));
    });
    assert.ok(downloads > 0 && analyses > 0 && uploads > 0);
  } finally {
    await app.close();
    await prisma.telegramUpdate.deleteMany({
      where: { senderId: { in: [sender, stranger] } },
    });
    await prisma.telegramCallback.deleteMany({
      where: { suggestion: { householdId: h } },
    });
    await prisma.attachment.updateMany({
      where: { householdId: h },
      data: { transactionId: null },
    });
    await prisma.installment.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.transfer.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.transaction.deleteMany({ where: { householdId: h } });
    await prisma.transactionSuggestion.deleteMany({
      where: { householdId: h },
    });
    await prisma.attachment.deleteMany({ where: { householdId: h } });
    await prisma.installmentPurchase.deleteMany({
      where: { card: { householdId: h } },
    });
    await prisma.invoice.deleteMany({ where: { card: { householdId: h } } });
    await prisma.creditCard.deleteMany({ where: { householdId: h } });
    await prisma.account.deleteMany({
      where: { householdId: { in: [h, foreign] } },
    });
    await prisma.category.deleteMany({ where: { householdId: h } });
    await prisma.user.deleteMany({
      where: { householdId: { in: [h, foreign] } },
    });
    await prisma.household.deleteMany({ where: { id: { in: [h, foreign] } } });
    await prisma.$disconnect();
  }
});
