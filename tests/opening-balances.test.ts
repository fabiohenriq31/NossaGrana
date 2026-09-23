import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { buildApp } from "../apps/api/src/app";
import { prisma } from "../apps/api/src/db";
import { openingBalancesInput } from "../packages/shared/src/validation";
import { upcoming } from "../apps/web/src/lib/finance";

test("Coflu: saldos iniciais, API, isolamento e aceitação financeira", async (t) => {
  // Never run these scenarios on a shared database.
  assert.ok(
    ["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
    "Use um banco PostgreSQL local isolado.",
  );
  process.env.NODE_ENV = "test";
  const app = await buildApp();
  const h = "opening-test-" + randomUUID(),
    foreign = h + "-other",
    password = randomUUID(),
    email = h + "@example.test";
  let cookie = "";
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        cookie,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
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
  const read = (month = "2026-10") => ok("GET", "/api/overview?month=" + month);
  const cardBody = {
    name: "Cartão Coflu QA",
    bankId: "nubank",
    owner: "Fábio",
    limit: 1000000,
    closingDay: 15,
    dueDay: 22,
    color: "#8000cc",
  };
  const create = (openingBalances?: unknown) =>
    ok("POST", "/api/cards", {
      ...cardBody,
      ...(openingBalances ? { openingBalances } : {}),
    });
  const save = (id: string, balances: any[]) =>
    ok("PUT", "/api/cards/" + id + "/opening-balances", { balances });
  const initial = [250000, 110000, 80000, 60000, 50000, 50000].map(
    (amount, index) => ({
      competence: [
        "2026-10",
        "2026-11",
        "2026-12",
        "2027-01",
        "2027-02",
        "2027-03",
      ][index],
      amount,
    }),
  );
  let card: any,
    invoice: any,
    account: any,
    category: any,
    legacy: any,
    partial: any;
  try {
    await prisma.bank.upsert({
      where: { id: "nubank" },
      create: { id: "nubank", name: "Nubank" },
      update: {},
    });
    await prisma.household.createMany({
      data: [
        { id: h, name: "QA saldos" },
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
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);
    cookie = String(login.headers["set-cookie"]).split(";")[0];
    account = await ok("POST", "/api/accounts", {
      name: "Conta QA",
      bankId: "nubank",
      owner: "Fábio",
      type: "Corrente",
      initialBalance: 2000000,
      openingDate: "2026-01-01",
    });
    category = await ok("POST", "/api/categories", {
      name: "Gastos reais QA",
      color: "#ffffff",
      icon: "wallet",
    });
    const buy = (id: string, amount: number, extra = {}) =>
      ok("POST", "/api/transactions", {
        description: "Compra real QA",
        amount,
        date: "2026-10-10",
        type: "DESPESA",
        paymentMethod: "CREDITO",
        owner: "Fábio",
        categoryId: category.id,
        cardId: id,
        ...extra,
      });
    await t.test(
      "01 cartão sem saldo inicial continua funcionando",
      async () => {
        legacy = await create();
        const rows = await buy(legacy.id, 100);
        await ok("DELETE", "/api/transactions/" + rows[0].id);
        const d = await read();
        assert.equal(d.cards.find((c: any) => c.id === legacy.id).used, 0);
        assert.equal(
          d.invoices.find((i: any) => i.cardId === legacy.id).openingBalance,
          0,
        );
      },
    );
    await t.test(
      "02 cadastrar seis ciclos com valores independentes",
      async () => {
        card = await create(initial);
        const rows = (await read()).invoices.filter(
          (i: any) => i.cardId === card.id,
        );
        assert.deepEqual(
          rows.map((i: any) => i.total),
          initial.map((i) => i.amount),
        );
        invoice = rows[0];
        assert.equal(
          await prisma.transaction.count({ where: { cardId: card.id } }),
          0,
        );
      },
    );
    await t.test(
      "03 comprometimento inclui todos os ciclos futuros",
      async () =>
        assert.equal(
          (await read()).cards.find((c: any) => c.id === card.id).used,
          600000,
        ),
    );
    await t.test("04 disponível é limite menos comprometido", async () =>
      assert.equal(
        (await read()).cards.find((c: any) => c.id === card.id).available,
        400000,
      ),
    );
    await t.test(
      "05 saldo 2500 mais compras 500 gera fatura 3000",
      async () => {
        for (const [description, amount] of [
          ["Mercado", 18000],
          ["Combustível", 22000],
          ["Restaurante", 10000],
        ] as const)
          await buy(card.id, amount, { description });
        const d = await read();
        invoice = d.invoices.find((i: any) => i.id === invoice.id);
        assert.equal(invoice.total, 300000);
        assert.equal(invoice.openingBalance, 250000);
        assert.equal(d.cards.find((c: any) => c.id === card.id).used, 650000);
        assert.equal(
          d.cards.find((c: any) => c.id === card.id).available,
          350000,
        );
      },
    );
    await t.test("06 saldo inicial não cria Transaction", async () =>
      assert.equal(
        await prisma.transaction.count({ where: { cardId: card.id } }),
        3,
      ),
    );
    await t.test(
      "07 categorias consideram somente os 500 reais novos",
      async () =>
        assert.equal(
          (await read()).analytics.categorySpending.reduce(
            (s: number, c: any) => s + c.value,
            0,
          ),
          50000,
        ),
    );
    await t.test("08 pessoas consideram somente os 500 reais novos", async () =>
      assert.equal(
        (await read()).analytics.personSpending.reduce(
          (s: number, c: any) => s + c.value,
          0,
        ),
        50000,
      ),
    );
    await t.test(
      "09 previsão, próximas faturas e patrimônio incluem valores iniciais",
      async () => {
        const d = await read();
        assert.equal(d.analytics.summary.invoices, 300000);
        assert.equal(
          upcoming(d, "2026-10").find((i) => i.id === invoice.id)?.amount,
          300000,
        );
        const date = new Date()
          .toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
          .slice(0, 7);
        const now = await read(date);
        assert.equal(now.analytics.wealth.at(-1).value, 1400000);
      },
    );
    await t.test("10 editar saldo atualiza fatura e limite", async () => {
      const c = await create([{ competence: "2028-04", amount: 10000 }]);
      await save(c.id, [{ competence: "2028-04", amount: 20000 }]);
      assert.equal(
        (await read()).invoices.find((i: any) => i.cardId === c.id).total,
        20000,
      );
      await save(c.id, []);
    });
    await t.test("11 excluir saldo preserva compras e invoice", async () => {
      const c = await create([{ competence: "2028-04", amount: 10000 }]);
      const rows = await buy(c.id, 1000, { date: "2028-04-01" });
      await save(c.id, []);
      assert.equal(
        (await read()).invoices.find((i: any) => i.cardId === c.id).total,
        1000,
      );
      await ok("DELETE", "/api/transactions/" + rows[0].id);
    });
    await t.test(
      "12 rejeita ciclos duplicados sem criar cartão parcial",
      async () => {
        const before = await prisma.creditCard.count({
          where: { householdId: h },
        });
        assert.equal(
          (
            await call("POST", "/api/cards", {
              ...cardBody,
              openingBalances: [initial[0], initial[0]],
            })
          ).code,
          400,
        );
        assert.equal(
          await prisma.creditCard.count({ where: { householdId: h } }),
          before,
        );
      },
    );
    await t.test(
      "13 rejeita negativos, NaN, frações de centavo e mês inválido",
      async () => {
        for (const row of [
          { competence: "2026-13", amount: 100 },
          { competence: "2026-00", amount: 100 },
          { competence: "2026-01", amount: -1 },
          { competence: "2026-01", amount: 1.2 },
          { competence: "2026-01", amount: NaN },
        ]) {
          assert.equal(
            openingBalancesInput.safeParse({ balances: [row] }).success,
            false,
          );
          assert.equal(
            (
              await call("PUT", "/api/cards/" + card.id + "/opening-balances", {
                balances: [row],
              })
            ).code,
            400,
          );
        }
      },
    );
    await t.test(
      "14 outro household e invoiceId manipulados são rejeitados",
      async () => {
        const c = await prisma.creditCard.create({
          data: {
            ...cardBody,
            householdId: foreign,
            brand: "Visa",
            last4: "1234",
          },
        });
        for (const method of ["GET", "PUT"])
          assert.equal(
            (
              await call(
                method,
                "/api/cards/" + c.id + "/opening-balances",
                method === "PUT" ? { balances: initial } : undefined,
              )
            ).code,
            404,
          );
        assert.equal(
          (
            await call("PUT", "/api/cards/" + card.id + "/opening-balances", {
              balances: [{ ...initial[0], invoiceId: "foreign" }],
            })
          ).code,
          400,
        );
        const f = await prisma.invoice.create({
          data: {
            cardId: c.id,
            competence: "2026-10",
            openingBalance: 100,
            closingDate: new Date("2026-10-15"),
            dueDate: new Date("2026-10-22"),
          },
        });
        assert.equal(
          (
            await call("POST", "/api/invoices/" + f.id + "/pay", {
              accountId: account.id,
              amount: 100,
              date: "2026-10-20",
            })
          ).code,
          404,
        );
      },
    );
    await t.test(
      "15 aceitação: pagar 3000 debita conta, quita outubro e libera limite",
      async () => {
        await ok("POST", "/api/invoices/" + invoice.id + "/pay", {
          accountId: account.id,
          amount: 300000,
          date: "2026-10-22",
        });
        const d = await read(),
          c = d.cards.find((c: any) => c.id === card.id),
          i = d.invoices.find((i: any) => i.id === invoice.id);
        assert.equal(
          d.accounts.find((a: any) => a.id === account.id).balance,
          1700000,
        );
        assert.equal(i.status, "Paga");
        assert.equal(i.remaining, 0);
        assert.equal(i.total, 300000);
        assert.equal(c.used, 350000);
        assert.equal(c.available, 650000);
        assert.equal(d.analytics.summary.expenses, 50000);
        assert.equal(d.analytics.categorySpending[0].value, 50000);
        assert.equal(d.analytics.personSpending[0].value, 50000);
      },
    );
    await t.test("16 pagamento parcial deixa 2000 e libera 1000", async () => {
      partial = await create([{ competence: "2026-10", amount: 300000 }]);
      const i = (await read()).invoices.find(
        (i: any) => i.cardId === partial.id,
      );
      await ok("POST", "/api/invoices/" + i.id + "/pay", {
        accountId: account.id,
        amount: 100000,
        date: "2026-10-22",
      });
      const d = await read();
      assert.equal(
        d.invoices.find((x: any) => x.id === i.id).remaining,
        200000,
      );
      assert.equal(d.cards.find((c: any) => c.id === partial.id).used, 200000);
    });
    await t.test(
      "17 pagamentos não duplicam despesas nem compras",
      async () => {
        assert.equal((await read()).analytics.summary.expenses, 50000);
        assert.equal(
          await prisma.transaction.count({
            where: { householdId: h, paymentInvoiceId: { not: null } },
          }),
          2,
        );
        assert.equal(
          await prisma.transaction.count({ where: { cardId: partial.id } }),
          0,
        );
      },
    );
    await t.test(
      "18 saldo inicial e 10 parcelas comprometem uma única vez",
      async () => {
        const c = await create([{ competence: "2026-10", amount: 100000 }]);
        const rows = await buy(c.id, 300000, { installments: 10 });
        let d = await read();
        assert.equal(d.cards.find((x: any) => x.id === c.id).used, 400000);
        assert.equal(rows.length, 10);
        await ok(
          "DELETE",
          "/api/installments/" + rows[0].installmentPurchaseId,
        );
        d = await read();
        assert.equal(d.cards.find((x: any) => x.id === c.id).used, 100000);
      },
    );
    await t.test("19 retry e concorrência não acumulam saldo", async () => {
      const c = await create();
      await save(c.id, initial);
      await save(c.id, initial);
      await Promise.all([save(c.id, initial), save(c.id, initial)]);
      assert.equal(await prisma.invoice.count({ where: { cardId: c.id } }), 6);
      assert.equal(
        (await read()).cards.find((x: any) => x.id === c.id).used,
        600000,
      );
    });
    await t.test("20 meses não consecutivos são independentes", async () => {
      const c = await create([initial[0], initial[2], initial[5]]);
      assert.deepEqual(
        (
          await ok("GET", "/api/cards/" + c.id + "/opening-balances")
        ).balances.map((i: any) => i.competence),
        ["2026-10", "2026-12", "2027-03"],
      );
    });
    await t.test(
      "21 passagem de ano e vencimento no mês seguinte",
      async () => {
        const c = await ok("POST", "/api/cards", {
          ...cardBody,
          dueDay: 5,
          openingBalances: initial.slice(2, 5),
        });
        const rows = (await read()).invoices.filter(
          (i: any) => i.cardId === c.id,
        );
        assert.deepEqual(
          rows.map((i: any) => i.competence),
          ["2026-12", "2027-01", "2027-02"],
        );
        assert.equal(rows[0].dueDate.slice(0, 10), "2027-01-05");
      },
    );
    await t.test("22 faturas antigas assumem zero sem recadastro", async () => {
      const i = await prisma.invoice.findFirstOrThrow({
        where: { cardId: legacy.id },
      });
      assert.equal(i.openingBalance, 0);
      assert.equal(i.openingBalanceDate, null);
    });
    await t.test(
      "23 lote inválido é atômico e não ultrapassa o limite",
      async () => {
        const c = await create(initial);
        assert.equal(
          (
            await call("PUT", "/api/cards/" + c.id + "/opening-balances", {
              balances: [
                { competence: "2026-10", amount: 100 },
                { competence: "2028-01", amount: 1000000 },
              ],
            })
          ).code,
          400,
        );
        assert.deepEqual(
          (
            await ok("GET", "/api/cards/" + c.id + "/opening-balances")
          ).balances.map((i: any) => i.amount),
          initial.map((i) => i.amount),
        );
        assert.equal(
          (
            await call("POST", "/api/transactions", {
              description: "Excede limite",
              amount: 500000,
              date: "2026-10-01",
              type: "DESPESA",
              paymentMethod: "CREDITO",
              owner: "Fábio",
              categoryId: category.id,
              cardId: c.id,
            })
          ).code,
          400,
        );
      },
    );
    await t.test(
      "24 saldos pagos ficam protegidos; retry idêntico é permitido",
      async () => {
        await save(card.id, initial);
        assert.equal(
          (
            await call("PUT", "/api/cards/" + card.id + "/opening-balances", {
              balances: [],
            })
          ).code,
          400,
        );
        assert.equal(
          (await ok("GET", "/api/cards/" + card.id + "/opening-balances"))
            .balances[0].locked,
          true,
        );
      },
    );
    await t.test(
      "25 estorno de pagamento recompõe conta, fatura e limite",
      async () => {
        const payment = await prisma.transaction.findFirstOrThrow({
          where: { paymentInvoiceId: invoice.id },
        });
        const before = (await read()).accounts.find(
          (a: any) => a.id === account.id,
        ).balance;
        await ok("DELETE", "/api/transactions/" + payment.id);
        const d = await read();
        assert.equal(
          d.accounts.find((a: any) => a.id === account.id).balance,
          before + 300000,
        );
        assert.equal(d.cards.find((c: any) => c.id === card.id).used, 650000);
        assert.equal(
          d.invoices.find((i: any) => i.id === invoice.id).remaining,
          300000,
        );
      },
    );
  } finally {
    const scope = { householdId: { in: [h, foreign] } };
    await prisma.invoicePayment.deleteMany({ where: { transaction: scope } });
    await prisma.installment.deleteMany({ where: { transaction: scope } });
    await prisma.transaction.deleteMany({ where: scope });
    await prisma.installmentPurchase.deleteMany({ where: { card: scope } });
    await prisma.invoice.deleteMany({ where: { card: scope } });
    await prisma.creditCard.deleteMany({ where: scope });
    await prisma.account.deleteMany({ where: scope });
    await prisma.category.deleteMany({ where: scope });
    await prisma.user.deleteMany({ where: scope });
    await prisma.household.deleteMany({ where: { id: { in: [h, foreign] } } });
    await app.close();
    await prisma.$disconnect();
  }
});
