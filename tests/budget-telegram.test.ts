import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/src/db";
import { budgetStatus, budgetLines } from "../apps/api/src/budget";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration";
import type { Event } from "../apps/api/src/integrations/telegram/identity";
import type {
  Statement,
  TextAnalysis,
} from "../apps/api/src/integrations/telegram/analyzer";
import {
  defaultPayment,
  quickChanges,
} from "../apps/api/src/integrations/telegram/quick";
import {
  statementCycle,
  itemKey,
  plan,
} from "../apps/api/src/integrations/telegram/statement";
import type { Keyboard } from "../apps/api/src/integrations/telegram/providers";
import type { TransactionSuggestion } from "@prisma/client";

const expense = (
  over: Partial<TextAnalysis["extraction"]> = {},
): TextAnalysis => ({
  extraction: {
    documentType: "TEXT",
    transactionType: "EXPENSE",
    description: "Mercado",
    amount: "120.00",
    currency: "BRL",
    transactionDate: "2026-11-23",
    transactionTime: null,
    paymentMethod: "OUTRO",
    bankName: null,
    cardLast4: null,
    payerName: null,
    recipientName: null,
    merchantName: null,
    pixKey: null,
    transactionIdentifier: null,
    categorySuggestion: "Mercado",
    subcategorySuggestion: null,
    installments: 1,
    currentInstallment: null,
    totalInstallments: 1,
    amountMeaning: "TOTAL",
    confidence: 0.9,
    needsReview: true,
    uncertainFields: [],
    notes: null,
    ...over,
  },
  text: {
    eventCount: "SINGLE",
    transactionStatus: "UNKNOWN",
    accountHint: null,
    destinationAccountHint: null,
  },
  model: "mock",
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
});

test("lançamento rápido: escolhe cartão padrão e resolve parcelas sem multiplicar à toa", () => {
  const cards = [
    { id: "c1", owner: "Fábio" },
    { id: "c2", owner: "Bianca" },
  ];
  const accounts = [
    { id: "a1", owner: "Fábio", type: "Corrente" },
    { id: "w1", owner: "Casa", type: "Carteira" },
  ];
  const choices = { cards, accounts } as never;
  assert.equal(defaultPayment(choices, "Bianca", "OUTRO")?.cardId, "c2");
  assert.equal(defaultPayment(choices, "Fábio", "PIX")?.accountId, "a1");
  assert.equal(defaultPayment(choices, "Fábio", "DINHEIRO")?.accountId, "w1");
  assert.equal(
    defaultPayment(
      { cards: [...cards, { id: "c3", owner: "Fábio" }], accounts } as never,
      "Fábio",
      null,
    ),
    null,
    "dois cartões do mesmo dono: pergunta",
  );
  const base = {
    suggestedType: "DESPESA",
    suggestedAmount: 5000,
    suggestedDate: new Date("2026-11-23T12:00:00Z"),
    possibleDuplicate: false,
    confidence: 0.9,
    suggestedStatus: null,
    reviewReasons: ["installments"],
    suggestedAccountId: null,
    suggestedCreditCardId: null,
    suggestedPaymentMethod: "OUTRO",
    suggestedOwner: null,
    installments: 3,
  } as unknown as TransactionSuggestion;
  const e = expense().extraction;
  const perInstallment = quickChanges(
    base,
    { ...e, amountMeaning: "INSTALLMENT" },
    choices,
    "Fábio",
  );
  assert.equal(perInstallment?.suggestedAmount, 15000);
  assert.equal(perInstallment?.suggestedCreditCardId, "c1");
  assert.deepEqual(perInstallment?.reviewReasons, []);
  assert.equal(
    quickChanges(base, { ...e, amountMeaning: "TOTAL" }, choices, "Fábio")
      ?.suggestedAmount,
    undefined,
  );
  assert.equal(
    quickChanges(base, { ...e, amountMeaning: "UNKNOWN" }, choices, "Fábio"),
    null,
  );
  assert.equal(
    quickChanges({ ...base, possibleDuplicate: true }, e, choices, "Fábio"),
    null,
  );
  assert.equal(
    quickChanges(
      { ...base, suggestedType: "RECEITA" } as never,
      e,
      choices,
      "Fábio",
    ),
    null,
  );
  assert.equal(
    quickChanges(
      base,
      { ...e, amountMeaning: "INSTALLMENT", currentInstallment: 3 },
      choices,
      "Fábio",
    ),
    null,
  );
});

test("fatura de referência: fechamento, vencimento ou compra mais recente", () => {
  const card = { closingDay: 5, dueDay: 12 };
  const items = [
    {
      date: "2026-11-20",
      description: "x",
      amount: 1,
      current: null,
      total: null,
      categoryId: "c",
    },
  ];
  assert.deepEqual(
    [
      statementCycle(
        card,
        { closingDate: "2026-12-05", dueDate: null, items },
        "2026-11-23",
      ).competence,
      statementCycle(
        card,
        { closingDate: "2026-12-05", dueDate: null, items },
        "2026-11-23",
      ).start,
    ],
    ["2026-12", "2026-11-06"],
  );
  assert.equal(
    statementCycle(
      card,
      { closingDate: null, dueDate: "2026-12-12", items },
      "2026-11-23",
    ).competence,
    "2026-12",
  );
  assert.equal(
    statementCycle(
      card,
      { closingDate: null, dueDate: null, items },
      "2026-11-23",
    ).competence,
    "2026-12",
  );
  const parcel = {
    date: "2026-08-15",
    description: "LOJA 03/10",
    amount: 5000,
    current: 3,
    total: 10,
    categoryId: "c",
  };
  assert.equal(
    itemKey("card", parcel),
    itemKey("card", {
      ...parcel,
      date: "2026-09-15",
      description: "LOJA 04/10",
      current: 4,
    }),
    "a parcela seguinte da mesma compra tem a mesma chave",
  );
});

test("importação de fatura: ignora o que já foi lançado e mantém compras iguais no mesmo dia", async () => {
  const item = (description: string, amount: number, date: string) => ({
    date,
    description,
    amount,
    current: null,
    total: null,
    categoryId: "c",
  });
  const payload = {
    userId: "u",
    cardId: "card",
    bankName: null,
    cardLast4: null,
    closingDate: "2026-12-05",
    dueDate: null,
    ignored: { payments: 0, refunds: 0, unreadable: 0 },
    attachmentId: null,
    items: [
      item("MERCADO", 12000, "2026-11-20"),
      item("CAFE", 800, "2026-11-21"),
      item("CAFE", 800, "2026-11-21"),
      item("POSTO", 20000, "2026-11-22"),
    ],
  };
  const fake = (imported: string[]) =>
    ({
      creditCard: {
        findFirst: async () => ({ id: "card", closingDay: 5, dueDay: 12 }),
      },
      externalImport: {
        findMany: async () =>
          imported.length ? [{ payload: { keys: imported } }] : [],
      },
      transaction: {
        // "mercado 120" lançado pelo Telegram um dia antes da data do print.
        findMany: async () => [
          { id: "t1", amount: 12000, date: new Date("2026-11-19T00:00:00Z") },
        ],
      },
    }) as unknown as Parameters<typeof plan>[3];
  const first = await plan("h", payload, "2026-11-23", fake([]));
  assert.deepEqual(
    first!.items.map((i) => i.duplicate),
    [true, false, false, false],
    "a compra lançada pelo Telegram não entra de novo; os dois cafés entram",
  );
  assert.notEqual(first!.items[1].key, first!.items[2].key);
  const again = await plan(
    "h",
    payload,
    "2026-11-23",
    fake(first!.items.filter((i) => !i.duplicate).map((i) => i.key)),
  );
  assert.ok(
    again!.items.every((i) => i.duplicate),
    "reenviar o mesmo print não duplica nada",
  );
});

test("banco isolado: orçamento, lançamento rápido, desfazer e importação de fatura", async (t) => {
  process.env.NODE_ENV = "test";
  const h = "budget-" + randomUUID();
  const sender = String(Math.floor(1e12 + Math.random() * 1e12));
  let sequence = Date.now() * 100;
  let analysis = expense();
  let statement: Statement;
  const sent: { text: string; keyboard?: Keyboard }[] = [];
  const integration = new TelegramIntegration({
    quickLaunch: true,
    telegram: {
      me: async () => ({ username: "test_bot" }),
      answer: async () => {},
      download: async () =>
        Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          Buffer.from(randomUUID()),
        ]),
      send: async (_chat, text, keyboard) => {
        sent.push({ text, keyboard });
      },
    },
    storage: {
      upload: async () => {},
      remove: async () => {},
      signedDownloadUrl: async () => "unused",
    },
    analyzer: {
      analyze: async () => {
        throw new Error("fatura não usa o leitor de comprovante único");
      },
      analyzeText: async () => analysis,
      analyzeStatement: async () => ({
        statement,
        model: "mock",
        totalTokens: 1,
      }),
    },
  });
  const base = () => ({
    id: String(++sequence),
    senderId: sender,
    chatId: sender,
    referenceDate: "2026-11-23",
  });
  const text = (message: string): Event => ({
    ...base(),
    kind: "text",
    text: message,
  });
  const photo = (): Event => ({
    ...base(),
    kind: "document",
    fileId: "f",
    mime: "image/png",
    fileSize: 100,
  });
  const tap = (token: string): Event => ({
    ...base(),
    kind: "callback",
    token,
  });
  const button = (prefix: string) =>
    sent
      .at(-1)!
      .keyboard!.flat()
      .find((b) => b.callback_data.startsWith(prefix))!.callback_data;
  try {
    await prisma.bank.upsert({
      where: { id: "nubank" },
      create: { id: "nubank", name: "Nubank" },
      update: {},
    });
    await prisma.household.create({
      data: { id: h, name: "Coflu orçamento QA" },
    });
    const user = await prisma.user.create({
      data: {
        householdId: h,
        name: "Fábio",
        email: h + "@example.test",
        passwordHash: "unused",
      },
    });
    await prisma.telegramIdentity.create({
      data: {
        userId: user.id,
        telegramUserId: sender,
        telegramChatId: sender,
        verified: true,
      },
    });
    const card = await prisma.creditCard.create({
      data: {
        householdId: h,
        bankId: "nubank",
        name: "Nubank",
        owner: "Fábio",
        brand: "Mastercard",
        last4: "1234",
        limit: 2000000,
        closingDay: 5,
        dueDay: 12,
        color: "#8a05be",
      },
    });
    const mercado = await prisma.category.create({
      data: {
        householdId: h,
        name: "Mercado",
        color: "#00aa00",
        icon: "food",
        monthlyBudget: 130000,
      },
    });
    const lazer = await prisma.category.create({
      data: {
        householdId: h,
        name: "Lazer",
        color: "#0000aa",
        icon: "music",
        monthlyBudget: 100000,
      },
    });
    await prisma.category.create({
      data: {
        householdId: h,
        name: "Outros",
        color: "#aaaaaa",
        icon: "wallet",
      },
    });

    let quickSuggestion = "";
    await t.test(
      "'mercado 120' lança direto no cartão e mostra quanto resta",
      async () => {
        await integration.process(text("mercado 120"));
        const rows = await prisma.transaction.findMany({
          where: { householdId: h },
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].cardId, card.id);
        assert.equal(rows[0].amount, 12000);
        assert.equal(
          rows[0].competence,
          "2026-12",
          "depois do fechamento vai para a próxima fatura",
        );
        assert.match(
          sent.at(-1)!.text,
          /Mercado: restam R\$\s?1\.180,00 de R\$\s?1\.300,00/,
        );
        assert.match(
          sent.at(-1)!.text,
          /Total de novembro\/2026: restam R\$\s?2\.180,00/,
        );
        quickSuggestion = rows[0].suggestionId!;
      },
    );

    await t.test("'3x de 50' vira compra de 150 em 3 parcelas", async () => {
      analysis = expense({
        description: "Farmácia",
        amount: "50.00",
        categorySuggestion: "Outros",
        installments: 3,
        totalInstallments: 3,
        amountMeaning: "INSTALLMENT",
      });
      await integration.process(text("farmácia 3x de 50"));
      const rows = await prisma.transaction.findMany({
        where: { householdId: h, description: { startsWith: "Farmácia" } },
        orderBy: { date: "asc" },
      });
      assert.deepEqual(
        rows.map((r) => r.amount),
        [5000, 5000, 5000],
      );
      assert.match(sent.at(-1)!.text, /em 3x de/);
    });

    await t.test("receita ou dúvida continuam pedindo revisão", async () => {
      analysis = expense({
        transactionType: "INCOME",
        categorySuggestion: null,
      });
      const before = await prisma.transaction.count({
        where: { householdId: h },
      });
      await integration.process(text("recebi 120"));
      assert.equal(
        await prisma.transaction.count({ where: { householdId: h } }),
        before,
      );
      assert.match(sent.at(-1)!.text, /Confira antes de salvar/);
    });

    await t.test("trocar categoria e desfazer pelo botão", async () => {
      await integration.process(tap("q:s:" + quickSuggestion + ":" + lazer.id));
      assert.match(sent.at(-1)!.text, /Categoria trocada para Lazer/);
      await integration.process(
        tap("q:s:" + quickSuggestion + ":" + mercado.id),
      );
      await integration.process(tap("q:u:" + quickSuggestion));
      assert.match(sent.at(-1)!.text, /Desfeito/);
      const row = await prisma.transaction.findFirstOrThrow({
        where: { suggestionId: quickSuggestion },
      });
      assert.equal(row.status, "CANCELADA");
      const status = await budgetStatus(h, "2026-11");
      assert.equal(
        status.categories.find((c) => c.id === mercado.id)!.spent,
        0,
      );
    });

    await t.test(
      "print da fatura: lança compras e só as parcelas que faltam",
      async () => {
        statement = {
          kind: "CARD_STATEMENT",
          bankName: "Nubank",
          cardLast4: "1234",
          closingDate: "2026-12-05",
          dueDate: null,
          confidence: 0.9,
          items: [
            {
              date: "2026-11-20",
              description: "SUPERMERCADO BH",
              amount: "250.00",
              kind: "PURCHASE",
              currentInstallment: null,
              totalInstallments: null,
              categorySuggestion: "Mercado",
            },
            {
              date: "2026-08-15",
              description: "MAGAZINE LOJA",
              amount: "50.00",
              kind: "PURCHASE",
              currentInstallment: 3,
              totalInstallments: 10,
              categorySuggestion: "Inexistente",
            },
            {
              date: "2026-11-10",
              description: "Pagamento recebido",
              amount: "1000.00",
              kind: "PAYMENT",
              currentInstallment: null,
              totalInstallments: null,
              categorySuggestion: null,
            },
            {
              date: "2026-11-21",
              description: "IFOOD",
              amount: "45.90",
              kind: "PURCHASE",
              currentInstallment: null,
              totalInstallments: null,
              categorySuggestion: "Lazer",
            },
          ],
        };
        await integration.process(photo());
        const preview = sent.at(-1)!;
        assert.match(preview.text, /Fatura Nubank final 1234 · dezembro\/2026/);
        assert.match(preview.text, /3 compras nesta fatura · R\$\s?345,90/);
        assert.match(
          preview.text,
          /lanço só as parcelas que faltam \(R\$\s?350,00/,
        );
        assert.match(preview.text, /1 pagamento/);
        assert.equal(
          await prisma.transaction.count({
            where: { householdId: h, source: "IMPORTACAO" },
          }),
          0,
          "nada antes de confirmar",
        );
        const ok = button("imp:ok:");
        await integration.process(tap(ok));
        assert.match(
          sent.at(-1)!.text,
          /3 compra\(s\) lançada\(s\) na fatura de dezembro\/2026 · R\$\s?345,90/,
        );
        assert.match(sent.at(-1)!.text, /Mercado: restam R\$\s?1\.050,00/);
        const parcels = await prisma.transaction.findMany({
          where: { householdId: h, description: { startsWith: "MAGAZINE" } },
          orderBy: { date: "asc" },
        });
        assert.equal(parcels.length, 8);
        assert.equal(parcels[0].description, "MAGAZINE LOJA 3/10");
        assert.equal(parcels.at(-1)!.description, "MAGAZINE LOJA 10/10");
        assert.equal(parcels[0].competence, "2026-12");
        assert.equal(parcels.at(-1)!.competence, "2027-07");
        await integration.process(tap(ok));
        assert.match(sent.at(-1)!.text, /já foi lançada/);
        assert.equal(
          await prisma.transaction.count({
            where: { householdId: h, source: "IMPORTACAO" },
          }),
          10,
        );
      },
    );

    await t.test(
      "novo print com as mesmas compras e a parcela 4/10 não duplica",
      async () => {
        statement = {
          ...statement,
          closingDate: "2027-01-05",
          items: [
            statement.items[0],
            { ...statement.items[1], currentInstallment: 4 },
            {
              date: "2026-12-20",
              description: "POSTO SHELL",
              amount: "200.00",
              kind: "PURCHASE",
              currentInstallment: null,
              totalInstallments: null,
              categorySuggestion: "Outros",
            },
          ],
        };
        await integration.process(photo());
        assert.match(sent.at(-1)!.text, /1 compra nesta fatura/);
        assert.match(sent.at(-1)!.text, /2 já lançadas no app/);
        await integration.process(tap(button("imp:ok:")));
        assert.equal(
          await prisma.transaction.count({
            where: { householdId: h, source: "IMPORTACAO" },
          }),
          11,
        );
      },
    );

    await t.test("orçamento do mês e linhas de alerta", async () => {
      const status = await budgetStatus(h, "2026-11");
      const m = status.categories.find((c) => c.id === mercado.id)!;
      assert.equal(m.spent, 25000);
      assert.equal(m.remaining, 105000);
      assert.equal(status.totals.budget, 230000);
      assert.ok(
        status.totals.unbudgetedSpent > 0,
        "Outros sem limite aparece à parte",
      );
      await prisma.category.update({
        where: { id: lazer.id },
        data: { monthlyBudget: 4000 },
      });
      const lines = budgetLines(await budgetStatus(h, "2026-11"), [lazer.id]);
      assert.match(lines[0], /🚨 Lazer: passou R\$\s?5,90 do limite/);
    });
  } finally {
    await prisma.telegramUpdate.deleteMany({ where: { senderId: sender } });
    await prisma.installment.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.transaction.deleteMany({ where: { householdId: h } });
    await prisma.installmentPurchase.deleteMany({
      where: { card: { householdId: h } },
    });
    await prisma.invoice.deleteMany({ where: { card: { householdId: h } } });
    await prisma.telegramCallback.deleteMany({
      where: { suggestion: { householdId: h } },
    });
    await prisma.transactionSuggestion.deleteMany({
      where: { householdId: h },
    });
    await prisma.attachment.deleteMany({ where: { householdId: h } });
    await prisma.externalImport.deleteMany({ where: { householdId: h } });
    await prisma.creditCard.deleteMany({ where: { householdId: h } });
    await prisma.category.deleteMany({ where: { householdId: h } });
    await prisma.telegramIdentity.deleteMany({
      where: { user: { householdId: h } },
    });
    await prisma.user.deleteMany({ where: { householdId: h } });
    await prisma.household.deleteMany({ where: { id: h } });
    await prisma.$disconnect();
  }
});
