import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app";
import { prisma } from "../apps/api/src/db";
import { banks } from "../scripts/reference-data";

test("PostgreSQL: regras financeiras e persistência em núcleo de teste isolado", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.APP_MODE = "REAL";

  let app = await buildApp(),
    cookie = "";
  const h = "test-" + randomUUID(),
    foreign = h + "-other",
    email = h + "@example.test",
    password = randomUUID();
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(payload !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { code: r.statusCode, body: r.json() };
  };
  const ok = async (method: string, url: string, payload?: unknown) => {
    const r = await call(method, url, payload);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    return r.body;
  };
  const read = (month = "2026-09") => ok("GET", "/api/overview?month=" + month);
  const balance = (d: any, id: string) =>
    d.accounts.find((a: any) => a.id === id).balance;
  const login = async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200);
    cookie = String(r.headers["set-cookie"]).split(";")[0];
    assert.match(String(r.headers["set-cookie"]), /HttpOnly/);
  };
  let a: any,
    b: any,
    card: any,
    category: any,
    txBase: any,
    purchase: any,
    invoice: any,
    payment: any;
  try {
    await prisma.bank.createMany({data: banks, skipDuplicates: true});
    await prisma.household.createMany({
      data: [
        { id: h, name: "QA isolado" },
        { id: foreign, name: "QA isolamento" },
      ],
    });
    await prisma.user.create({
      data: {
        householdId: h,
        name: "Fábio",
        email,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    await t.test("autenticação, CORS e isolamento por household", async () => {
      assert.equal((await call("GET", "/api/overview")).code, 401);
      assert.equal(
        (await call("POST", "/api/auth/login", { email, password: "errada" }))
          .code,
        401,
      );
      await login();
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie, origin: "https://evil.example" },
      });
      assert.equal(r.statusCode, 403);
      const other = await prisma.account.create({
        data: {
          householdId: foreign,
          bankId: "nubank",
          name: "Privada",
          owner: "Casa",
          type: "Corrente",
          initialBalance: 0,
        },
      });
      assert.equal(
        (await call("DELETE", "/api/accounts/" + other.id)).code,
        404,
      );
    });
    await t.test(
      "saldo inicial, data de referência e várias contas do mesmo banco",
      async () => {
        a = await ok("POST", "/api/accounts", {
          bankId: "nubank",
          name: "Principal QA",
          owner: "Fábio",
          type: "Corrente",
          initialBalance: 100000,
          openingDate: "2026-01-01",
        });
        b = await ok("POST", "/api/accounts", {
          bankId: "nubank",
          name: "Reserva QA",
          owner: "Bianca",
          type: "Corrente",
          initialBalance: 20000,
          openingDate: "2026-01-01",
        });
        assert.equal(balance(await read(), a.id), 100000);
        assert.equal(balance(await read(), b.id), 20000);
        assert.equal((await read("2025-12")).analytics.summary.balance, 0);
        category = await ok("POST", "/api/categories", {
          name: "Categoria QA",
          color: "#f5675d",
          icon: "food",
        });
        txBase = {
          description: "Lançamento QA",
          amount: 10000,
          date: "2026-09-10",
          type: "DESPESA",
          owner: "Fábio",
          accountId: a.id,
          categoryId: category.id,
          paymentMethod: "PIX",
        };
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              ...txBase,
              date: "2025-12-31",
            })
          ).code,
          400,
        );
        assert.equal(
          (await call("POST", "/api/transactions", { ...txBase, amount: 1.1 }))
            .code,
          400,
        );
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              ...txBase,
              categoryId: null,
            })
          ).code,
          400,
        );
      },
    );
    await t.test(
      "receita, PIX, débito, edição e cancelamento recalculam saldos",
      async () => {
        await ok("POST", "/api/transactions", {
          ...txBase,
          type: "RECEITA",
          amount: 480000,
          description: "Salário QA",
        });
        assert.equal(balance(await read(), a.id), 580000);
        const pix = (await ok("POST", "/api/transactions", txBase))[0];
        await ok("POST", "/api/transactions", {
          ...txBase,
          amount: 5000,
          paymentMethod: "DEBITO",
          description: "Débito QA",
        });
        assert.equal(balance(await read(), a.id), 565000);
        const edited = await ok("PUT", "/api/transactions/" + pix.id, {
          ...txBase,
          amount: 8000,
        });
        assert.equal(edited[0].id, pix.id);
        assert.equal(balance(await read(), a.id), 567000);
        await ok("DELETE", "/api/transactions/" + pix.id);
        const d = await read();
        assert.equal(balance(d, a.id), 575000);
        assert.equal(
          d.transactions.find((x: any) => x.id === pix.id).status,
          "CANCELADA",
        );
        assert.equal(d.analytics.summary.expenses, 5000);
        assert.equal(
          (
            await call("PUT", "/api/accounts/" + a.id, {
              bankId: "nubank",
              name: "Principal QA",
              owner: "Fábio",
              type: "Corrente",
              initialBalance: 999,
              openingDate: "2026-01-01",
            })
          ).code,
          400,
        );
        assert.equal(
          (await call("DELETE", "/api/categories/" + category.id)).code,
          409,
        );
      },
    );
    await t.test(
      "transferência atômica conserva patrimônio e não cria receita/despesa",
      async () => {
        const before = await read();
        const transfer = {
          ...txBase,
          type: "TRANSFERENCIA",
          amount: 50000,
          accountId: a.id,
          destinationAccountId: b.id,
          paymentMethod: "TRANSFERENCIA",
        };
        await ok("POST", "/api/transactions", transfer);
        const after = await read();
        assert.equal(balance(after, a.id), 525000);
        assert.equal(balance(after, b.id), 70000);
        assert.equal(
          after.analytics.summary.balance,
          before.analytics.summary.balance,
        );
        assert.equal(
          after.analytics.summary.income,
          before.analytics.summary.income,
        );
        assert.equal(
          after.analytics.summary.expenses,
          before.analytics.summary.expenses,
        );
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              ...transfer,
              destinationAccountId: a.id,
            })
          ).code,
          400,
        );
        assert.equal(
          await prisma.transfer.count({
            where: { transaction: { householdId: h } },
          }),
          1,
        );
      },
    );
    await t.test(
      "dinheiro exige carteira e rollback preserva os dados",
      async () => {
        const before = await prisma.transaction.count({
          where: { householdId: h },
        });
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              ...txBase,
              paymentMethod: "DINHEIRO",
            })
          ).code,
          400,
        );
        assert.equal(
          await prisma.transaction.count({ where: { householdId: h } }),
          before,
        );
        const cash = await ok("POST", "/api/accounts", {
          bankId: "outro",
          name: "Carteira QA",
          owner: "Casa",
          type: "Dinheiro",
          initialBalance: 1000,
          openingDate: "2026-01-01",
        });
        await ok("POST", "/api/transactions", {
          ...txBase,
          accountId: cash.id,
          amount: 100,
          paymentMethod: "DINHEIRO",
        });
        assert.equal(balance(await read(), cash.id), 900);
      },
    );
    await t.test(
      "crédito respeita fechamento e não debita conta; parcelas somam centavos exatos",
      async () => {
        card = await ok("POST", "/api/cards", {
          bankId: "nubank",
          name: "Cartão QA",
          owner: "Fábio",
          last4: "9999",
          limit: 200000,
          closingDay: 15,
          dueDay: 22,
          color: "#8000cc",
          paymentAccountId: a.id,
        });
        const before = balance(await read(), a.id);
        await ok("POST", "/api/transactions", {
          ...txBase,
          accountId: null,
          cardId: card.id,
          paymentMethod: "CREDITO",
          amount: 3000,
          date: "2026-09-15",
        });
        purchase = await ok("POST", "/api/transactions", {
          ...txBase,
          accountId: null,
          cardId: card.id,
          paymentMethod: "CREDITO",
          amount: 10000,
          date: "2026-09-16",
          installments: 3,
        });
        assert.equal(purchase.length, 3);
        assert.deepEqual(
          purchase.map((x: any) => x.amount),
          [3334, 3333, 3333],
        );
        assert.deepEqual(
          purchase.map((x: any) => x.competence),
          ["2026-10", "2026-11", "2026-12"],
        );
        assert.equal(
          await prisma.installment.count({
            where: { purchaseId: purchase[0].installmentPurchaseId },
          }),
          3,
        );
        const d = await read();
        assert.equal(balance(d, a.id), before);
        assert.equal(d.cards[0].used, 13000);
        invoice = d.invoices.find((i: any) => i.competence === "2026-10");
        assert.equal(invoice.total, 3334);
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              ...txBase,
              accountId: null,
              cardId: card.id,
              paymentMethod: "CREDITO",
              amount: 200000,
            })
          ).code,
          400,
        );
      },
    );
    await t.test(
      "pagamento parcial, concorrência, pagamento integral e estorno sem despesa duplicada",
      async () => {
        payment = await ok("POST", "/api/invoices/" + invoice.id + "/pay", {
          accountId: a.id,
          amount: 1000,
          date: "2026-10-20",
        });
        let d = await read("2026-10");
        assert.equal(
          d.invoices.find((i: any) => i.id === invoice.id).remaining,
          2334,
        );
        assert.equal(balance(d, a.id), 524000);
        assert.equal(d.analytics.summary.expenses, 3334);
        assert.equal(
          await prisma.invoicePayment.count({
            where: { transaction: { householdId: h } },
          }),
          1,
        );
        assert.equal(
          (await call("DELETE", "/api/transactions/" + purchase[0].id)).code,
          400,
        );
        const responses = await Promise.all(
          [1, 2].map(() =>
            call("POST", "/api/invoices/" + invoice.id + "/pay", {
              accountId: a.id,
              amount: 2000,
              date: "2026-10-20",
            }),
          ),
        );
        assert.equal(responses.filter((r) => r.code === 200).length, 1);
        await ok("POST", "/api/invoices/" + invoice.id + "/pay", {
          accountId: a.id,
          amount: 334,
          date: "2026-10-20",
        });
        d = await read("2026-10");
        assert.equal(
          d.invoices.find((i: any) => i.id === invoice.id).status,
          "Paga",
        );
        assert.equal(d.analytics.summary.expenses, 3334);
        await ok("DELETE", "/api/transactions/" + payment.id);
        d = await read();
        assert.equal(
          d.invoices.find((i: any) => i.id === invoice.id).remaining,
          1000,
        );
        assert.equal(balance(d, a.id), 522666);
      },
    );
    await t.test(
      "contas a pagar/receber aguardam liquidação na conta e data escolhidas",
      async () => {
        const before = await read(),
          oldA = balance(before, a.id),
          oldB = balance(before, b.id);
        const payable = (
          await ok("POST", "/api/transactions", {
            ...txBase,
            status: "PENDENTE",
            date: "2026-09-20",
            amount: 11990,
          })
        )[0];
        const receivable = (
          await ok("POST", "/api/transactions", {
            ...txBase,
            type: "RECEITA",
            status: "PENDENTE",
            amount: 100000,
          })
        )[0];
        let d = await read();
        assert.equal(balance(d, a.id), oldA);
        assert.equal(d.analytics.summary.payable, 11990);
        assert.equal(d.analytics.summary.receivable, 100000);
        await ok("PATCH", "/api/transactions/" + payable.id + "/confirm", {
          accountId: b.id,
          date: "2026-10-02",
        });
        await ok("PATCH", "/api/transactions/" + receivable.id + "/confirm", {
          accountId: a.id,
          date: "2026-09-22",
        });
        d = await read();
        assert.equal(balance(d, a.id), oldA + 100000);
        assert.equal(balance(d, b.id), oldB - 11990);
        const settled = d.transactions.find((x: any) => x.id === payable.id);
        assert.equal(settled.competence, "2026-10");
        assert.equal(settled.dueDate.slice(0, 10), "2026-09-20");
        assert.equal(d.analytics.summary.payable, 0);
        assert.equal(d.analytics.summary.receivable, 0);
      },
    );
    await t.test(
      "recorrência idempotente, fim de mês e edição preservam ocorrência",
      async () => {
        const r = await ok("POST", "/api/recurrences", {
          transaction: { ...txBase, description: "Internet QA", amount: 9990 },
          frequency: "MENSAL",
          interval: 1,
          nextDate: "2026-01-31",
        });
        const generated = await ok("POST", "/api/recurrences/generate", {
          until: "2026-03-31",
        });
        assert.equal(generated.count, 2);
        assert.equal(
          (
            await ok("POST", "/api/recurrences/generate", {
              until: "2026-03-31",
            })
          ).count,
          0,
        );
        const rows = await prisma.transaction.findMany({
          where: { recurringId: r.id },
          orderBy: { date: "asc" },
        });
        assert.deepEqual(
          rows.map((x) => x.date.toISOString().slice(0, 10)),
          ["2026-01-31", "2026-02-28", "2026-03-31"],
        );
        assert.ok(rows.every((x) => x.status === "PENDENTE"));
        await ok("PUT", "/api/transactions/" + rows[0].id, {
          ...txBase,
          description: "Internet corrigida QA",
          amount: 8880,
          date: "2026-01-31",
          status: "PENDENTE",
        });
        await ok("DELETE", "/api/transactions/" + rows[1].id);
        assert.equal(
          (
            await ok("POST", "/api/recurrences/generate", {
              until: "2026-03-31",
            })
          ).count,
          0,
        );
        assert.equal(
          await prisma.transaction.count({ where: { recurringId: r.id } }),
          3,
        );
      },
    );
    await t.test(
      "edição e cancelamento de parcelas mantém vínculo e recalcula fatura",
      async () => {
        const p = purchase[1];
        await ok("PUT", "/api/transactions/" + p.id, {
          ...txBase,
          accountId: null,
          cardId: card.id,
          paymentMethod: "CREDITO",
          date: p.date.slice(0, 10),
          amount: 3000,
        });
        assert.equal(
          (await read()).invoices.find((i: any) => i.competence === "2026-11")
            .total,
          3000,
        );
        await ok("DELETE", "/api/transactions/" + p.id);
        assert.equal(
          (await read()).invoices.find((i: any) => i.competence === "2026-11")
            .total,
          0,
        );
      },
    );
    await t.test(
      "persistência após reiniciar Fastify e reconectar Prisma; dados reais permanecem separados",
      async () => {
        const before = await read();
        const foreignBefore = await prisma.household.findUniqueOrThrow({
          where: { id: foreign },
          include: {
            _count: {
              select: { accounts: true, cards: true, transactions: true },
            },
          },
        });
        await app.close();
        await prisma.$disconnect();
        app = await buildApp();
        const after = await read();
        assert.deepEqual(after.analytics, before.analytics);
        assert.equal(after.transactions.length, before.transactions.length);
        assert.ok(after.accounts.every((x: any) => x.householdId === h));
        const real = await prisma.household.findUnique({
          where: { id: foreign },
          include: {
            _count: {
              select: { accounts: true, cards: true, transactions: true },
            },
          },
        });
        assert.ok(real);
        assert.deepEqual(real._count, foreignBefore._count);
      },
    );
  } finally {
    await app.close();
    await prisma.invoicePayment.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.installment.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.transfer.deleteMany({
      where: { transaction: { householdId: h } },
    });
    await prisma.transaction.deleteMany({ where: { householdId: h } });
    await prisma.installmentPurchase.deleteMany({
      where: { card: { householdId: h } },
    });
    await prisma.invoice.deleteMany({ where: { card: { householdId: h } } });
    await prisma.creditCard.deleteMany({ where: { householdId: h } });
    await prisma.recurringTransaction.deleteMany({ where: { householdId: h } });
    await prisma.account.deleteMany({
      where: { householdId: { in: [h, foreign] } },
    });
    await prisma.subcategory.deleteMany({
      where: { category: { householdId: h } },
    });
    await prisma.category.deleteMany({ where: { householdId: h } });
    await prisma.tag.deleteMany({ where: { householdId: h } });
    await prisma.user.deleteMany({ where: { householdId: h } });
    await prisma.household.deleteMany({ where: { id: { in: [h, foreign] } } });
    await prisma.$disconnect();
  }
});
