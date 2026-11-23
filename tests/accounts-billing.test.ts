import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app";
import { prisma } from "../apps/api/src/db";
import {
  CreditError,
  effectivePlan,
  nextMonth,
  reserve,
  refund,
} from "../apps/api/src/billing";
import {
  clearSettingsCache,
  defaultSettings,
  settingsSchema,
} from "../apps/api/src/settings";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration";
import * as billing from "../apps/api/src/billing";
import type { Event } from "../apps/api/src/integrations/telegram/identity";
import type { TextAnalysis } from "../apps/api/src/integrations/telegram/analyzer";

test("planos: vencido volta ao grátis, renovação mensal e padrões válidos", () => {
  const s = defaultSettings;
  assert.equal(settingsSchema.parse(s).plans.length, 3);
  assert.equal(
    effectivePlan({ plan: "COMPLETO", planExpiresAt: null }, s).id,
    "COMPLETO",
  );
  assert.equal(
    effectivePlan(
      { plan: "COMPLETO", planExpiresAt: new Date(Date.now() - 1000) },
      s,
    ).id,
    "FREE",
  );
  assert.equal(
    effectivePlan({ plan: "REMOVIDO", planExpiresAt: null }, s).id,
    "FREE",
  );
  assert.equal(
    nextMonth(new Date("2026-01-31T12:00:00Z")).toISOString().slice(0, 10),
    "2026-02-28",
  );
  assert.equal(
    nextMonth(new Date("2026-11-23T12:00:00Z")).toISOString().slice(0, 10),
    "2026-12-23",
  );
  assert.throws(() =>
    settingsSchema.parse({
      ...s,
      plans: s.plans.filter((p) => p.id !== "FREE"),
    }),
  );
});

test("cadastro, convite, admin, créditos e Telegram em banco isolado", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.APP_MODE = "REAL";
  const run = randomUUID().slice(0, 8);
  const adminEmail = "admin-" + run + "@example.test";
  process.env.ADMIN_EMAILS = "outra@example.test, " + adminEmail.toUpperCase();
  await prisma.appSetting.deleteMany({ where: { key: "app" } });
  clearSettingsCache();
  const app = await buildApp();
  const households = new Set<string>();
  const password = "senha-forte-" + run;
  const call = async (
    method: string,
    url: string,
    payload?: unknown,
    cookie = "",
  ) => {
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
    return {
      code: r.statusCode,
      body: r.body ? r.json() : null,
      cookie: String(r.headers["set-cookie"] || "").split(";")[0],
    };
  };
  const signup = async (payload: Record<string, unknown>) => {
    const r = await call("POST", "/api/auth/signup", { password, ...payload });
    if (r.code === 201) {
      const me = await call("GET", "/api/overview", undefined, r.cookie);
      households.add(
        (
          await prisma.user.findUniqueOrThrow({
            where: { email: String(payload.email) },
          })
        ).householdId,
      );
      return { ...r, me: me.body };
    }
    return { ...r, me: null };
  };
  try {
    let ana: Awaited<ReturnType<typeof signup>>;
    let admin: Awaited<ReturnType<typeof signup>>;

    await t.test(
      "cadastro aberto cria núcleo, categorias e créditos de boas-vindas",
      async () => {
        const config = await call("GET", "/api/public/config");
        assert.equal(config.code, 200);
        assert.equal(config.body.signupEnabled, true);
        assert.equal(config.body.signupBonusCredits, 5);
        ana = await signup({
          name: "Ana",
          email: "ana-" + run + "@example.test",
          householdName: "Ana & Leo",
        });
        assert.equal(ana.code, 201, JSON.stringify(ana.body));
        assert.match(ana.cookie, /^ng_session=/);
        assert.equal(ana.me.household.name, "Ana & Leo");
        assert.equal(ana.me.household.credits, 5);
        assert.equal(ana.me.household.plan, "FREE");
        assert.equal(ana.me.user.role, "USER");
        assert.deepEqual(ana.me.people, ["Ana", "Casa"]);
        assert.ok(ana.me.categories.length >= 20);
        const ledger = await call("GET", "/api/billing", undefined, ana.cookie);
        assert.equal(ledger.body.credits, 5);
        assert.equal(ledger.body.ledger[0].reason, "BONUS_CADASTRO");
        assert.equal(
          (
            await signup({
              name: "Outra",
              email: "ANA-" + run + "@example.test",
            })
          ).code,
          409,
          "e-mail repetido, sem diferenciar maiúsculas",
        );
        assert.equal(
          (
            await signup({
              name: "Casa",
              email: "casa-" + run + "@example.test",
            })
          ).code,
          400,
        );
      },
    );

    await t.test(
      "convite: parceiro entra no mesmo núcleo, uma vez, até o limite",
      async () => {
        const invite = await call(
          "POST",
          "/api/household/invites",
          {},
          ana.cookie,
        );
        assert.equal(invite.code, 200, JSON.stringify(invite.body));
        const token = new URL(invite.body.url, "http://x").searchParams.get(
          "convite",
        )!;
        const info = await call("GET", "/api/auth/invite/" + token);
        assert.deepEqual(info.body, {
          householdName: "Ana & Leo",
          members: ["Ana"],
        });
        assert.equal(
          (
            await signup({
              name: "ana",
              email: "x-" + run + "@example.test",
              invite: token,
            })
          ).code,
          409,
          "mesmo nome no núcleo",
        );
        const leo = await signup({
          name: "Leo",
          email: "leo-" + run + "@example.test",
          invite: token,
        });
        assert.equal(leo.code, 201, JSON.stringify(leo.body));
        assert.deepEqual(leo.me.people, ["Ana", "Leo", "Casa"]);
        assert.equal(
          leo.me.household.credits,
          5,
          "convidado não ganha bônus extra",
        );
        assert.equal(
          (await call("GET", "/api/auth/invite/" + token)).code,
          404,
          "convite já usado",
        );
        assert.equal(
          (await call("POST", "/api/household/invites", {}, ana.cookie)).code,
          409,
          "núcleo completo",
        );
        // Responsável precisa ser membro do núcleo ou Casa.
        const bad = await call(
          "POST",
          "/api/accounts",
          {
            bankId: "nubank",
            name: "Conta",
            owner: "Estranho",
            type: "Corrente",
            initialBalance: 0,
            openingDate: "2026-11-01",
            color: "#000000",
            notes: "",
            active: true,
          },
          ana.cookie,
        );
        assert.equal(bad.code, 400, JSON.stringify(bad.body));
        assert.match(bad.body.message, /Responsável inválido/);
      },
    );

    await t.test(
      "admin: acesso restrito, ADMIN_EMAILS, créditos, plano e auditoria",
      async () => {
        assert.equal(
          (await call("GET", "/api/admin/stats", undefined, ana.cookie)).code,
          403,
        );
        admin = await signup({ name: "Admin", email: adminEmail });
        assert.equal(admin.me.user.role, "ADMIN");
        const stats = await call(
          "GET",
          "/api/admin/stats",
          undefined,
          admin.cookie,
        );
        assert.equal(stats.code, 200);
        assert.ok(stats.body.households >= 2);
        const list = await call(
          "GET",
          "/api/admin/households?q=" + encodeURIComponent("ana-" + run),
          undefined,
          admin.cookie,
        );
        assert.equal(list.body.items.length, 1);
        const hid = list.body.items[0].id;
        assert.equal(list.body.items[0].users.length, 2);

        const add = await call(
          "POST",
          "/api/admin/households/" + hid + "/credits",
          { delta: 10, note: "cortesia" },
          admin.cookie,
        );
        assert.deepEqual(add.body, { credits: 15 });
        const tooMuch = await call(
          "POST",
          "/api/admin/households/" + hid + "/credits",
          { delta: -100 },
          admin.cookie,
        );
        assert.equal(tooMuch.code, 400);
        const plan = await call(
          "PUT",
          "/api/admin/households/" + hid + "/plan",
          { plan: "COMPLETO", expiresAt: null, grantCredits: true },
          admin.cookie,
        );
        assert.equal(plan.code, 200, JSON.stringify(plan.body));
        const me = await call("GET", "/api/overview", undefined, ana.cookie);
        assert.equal(me.body.household.plan, "COMPLETO");
        assert.equal(me.body.household.credits, 315);
        assert.ok(me.body.household.features.includes("coach"));
        assert.equal(
          (
            await call(
              "PUT",
              "/api/admin/households/" + hid + "/plan",
              { plan: "NAO_EXISTE", expiresAt: null },
              admin.cookie,
            )
          ).code,
          400,
        );
        assert.equal(
          (
            await call(
              "PATCH",
              "/api/admin/users/" + admin.me.user.id,
              { role: "USER" },
              admin.cookie,
            )
          ).code,
          400,
          "admin não rebaixa a si mesmo",
        );
        const audit = await call(
          "GET",
          "/api/admin/audit",
          undefined,
          admin.cookie,
        );
        assert.ok(
          audit.body.some((a: { action: string }) => a.action === "plan.set"),
        );
      },
    );

    await t.test(
      "configurações: fechar cadastro, manutenção e desativar núcleo",
      async () => {
        const current = (
          await call("GET", "/api/admin/settings", undefined, admin.cookie)
        ).body.settings;
        const save = (next: unknown) =>
          call("PUT", "/api/admin/settings", next, admin.cookie);
        assert.equal(
          (await save({ ...current, signupBonusCredits: -1 })).code,
          400,
        );
        assert.equal(
          (await save({ ...current, signupEnabled: false })).code,
          200,
        );
        assert.equal(
          (await call("GET", "/api/public/config")).body.signupEnabled,
          false,
        );
        const closed = await signup({
          name: "Bia",
          email: "bia-" + run + "@example.test",
        });
        assert.equal(closed.code, 403);
        assert.match(closed.body.message, /cadastros estão fechados/);

        assert.equal(
          (
            await save({
              ...current,
              maintenance: { enabled: true, message: "Voltamos já." },
            })
          ).code,
          200,
        );
        const blocked = await call(
          "GET",
          "/api/overview",
          undefined,
          ana.cookie,
        );
        assert.equal(blocked.code, 503);
        assert.equal(blocked.body.message, "Voltamos já.");
        assert.equal(
          (await call("GET", "/api/overview", undefined, admin.cookie)).code,
          200,
          "admin continua entrando",
        );
        assert.equal((await save(current)).code, 200);

        const hid = (
          await prisma.user.findUniqueOrThrow({
            where: { email: "ana-" + run + "@example.test" },
          })
        ).householdId;
        assert.equal(
          (
            await call(
              "PATCH",
              "/api/admin/households/" + hid,
              { active: false },
              admin.cookie,
            )
          ).code,
          200,
        );
        assert.equal(
          (await call("GET", "/api/overview", undefined, ana.cookie)).code,
          401,
          "sessão derrubada",
        );
        const login = await call("POST", "/api/auth/login", {
          email: "ana-" + run + "@example.test",
          password,
        });
        assert.equal(login.code, 403);
        assert.equal(
          (
            await call(
              "PATCH",
              "/api/admin/households/" + hid,
              { active: true },
              admin.cookie,
            )
          ).code,
          200,
        );
        assert.equal(
          (
            await call("POST", "/api/auth/login", {
              email: "ana-" + run + "@example.test",
              password,
            })
          ).code,
          200,
        );
      },
    );

    await t.test(
      "créditos: débito atômico, saldo insuficiente, estorno e plano bloqueado",
      async () => {
        const h = (
          await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
        ).householdId;
        await prisma.household.update({
          where: { id: h },
          data: { credits: 3 },
        });
        const results = await Promise.allSettled(
          [1, 2, 3, 4].map(() => reserve(h, "text")),
        );
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          3,
          "3 créditos = 3 textos, nunca mais",
        );
        const rejected = results.find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult;
        assert.ok(rejected.reason instanceof CreditError);
        assert.match(rejected.reason.message, /créditos acabaram/);
        assert.equal(
          (await prisma.household.findUniqueOrThrow({ where: { id: h } }))
            .credits,
          0,
        );
        await refund(h, 1, "teste");
        assert.equal(
          (await prisma.household.findUniqueOrThrow({ where: { id: h } }))
            .credits,
          1,
        );
        await assert.rejects(
          () => reserve(h, "coach"),
          /faz parte de outro plano/,
          "FREE não tem análise por IA",
        );
        const coach = await call(
          "POST",
          "/api/financial-health/2026-11/analysis",
          {},
          admin.cookie,
        );
        assert.equal(coach.code, 402);
      },
    );

    await t.test(
      "Telegram cobra por texto, devolve conversa e avisa quando acaba",
      async () => {
        const h = (
          await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
        ).householdId;
        const user = await prisma.user.findUniqueOrThrow({
          where: { email: adminEmail },
        });
        const sender = String(Math.floor(1e12 + Math.random() * 1e12));
        await prisma.telegramIdentity.create({
          data: {
            userId: user.id,
            telegramUserId: sender,
            telegramChatId: sender,
            verified: true,
          },
        });
        await prisma.household.update({
          where: { id: h },
          data: { credits: 1 },
        });
        const sent: string[] = [];
        let analysis: TextAnalysis = {
          extraction: {
            documentType: "TEXT",
            transactionType: "EXPENSE",
            description: "Mercado",
            amount: "10.00",
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
          },
          text: {
            eventCount: "NONE",
            transactionStatus: "UNKNOWN",
            accountHint: null,
            destinationAccountHint: null,
          },
          model: "mock",
          totalTokens: 1,
          inputTokens: 1,
          outputTokens: 1,
        };
        const integration = new TelegramIntegration({
          telegram: {
            me: async () => ({ username: "test_bot" }),
            answer: async () => {},
            download: async () => Buffer.from([]),
            send: async (_chat, text) => {
              sent.push(text);
            },
          },
          storage: {
            upload: async () => {},
            remove: async () => {},
            signedDownloadUrl: async () => "unused",
          },
          analyzer: {
            analyze: async () => {
              throw new Error("unused");
            },
            analyzeText: async () => analysis,
          },
          billing: {
            check: billing.check,
            reserve: billing.reserve,
            refund: billing.refund,
          },
        });
        let seq = Date.now() * 100;
        const text = (message: string): Event => ({
          id: String(++seq),
          senderId: sender,
          chatId: sender,
          kind: "text",
          text: message,
          referenceDate: "2026-11-23",
        });
        await integration.process(text("oi, tudo bem?"));
        assert.equal(
          (await prisma.household.findUniqueOrThrow({ where: { id: h } }))
            .credits,
          1,
          "conversa não gasta",
        );
        analysis = {
          ...analysis,
          text: {
            ...analysis.text,
            eventCount: "SINGLE",
            transactionStatus: "CONFIRMADA",
          },
        };
        await integration.process(text("mercado 10"));
        assert.equal(
          (await prisma.household.findUniqueOrThrow({ where: { id: h } }))
            .credits,
          0,
        );
        assert.match(sent.at(-1)!, /Restam 0 créditos/);
        await assert.rejects(
          () => integration.process(text("mercado 10")),
          /créditos acabaram/,
        );
        const uses = await prisma.creditLedger.findMany({
          where: { householdId: h, reason: "USO_TEXTO" },
        });
        assert.ok(uses.length >= 2);
      },
    );
  } finally {
    await prisma.appSetting.deleteMany({ where: { key: "app" } });
    clearSettingsCache();
    delete process.env.ADMIN_EMAILS;
    const ids = [...households];
    const users = await prisma.user.findMany({
      where: { householdId: { in: ids } },
      select: { id: true },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { actorUserId: { in: users.map((u) => u.id) } },
    });
    await prisma.telegramCallback.deleteMany({
      where: { suggestion: { householdId: { in: ids } } },
    });
    await prisma.transactionSuggestion.deleteMany({
      where: { householdId: { in: ids } },
    });
    await prisma.installment.deleteMany({
      where: { transaction: { householdId: { in: ids } } },
    });
    await prisma.transaction.deleteMany({
      where: { householdId: { in: ids } },
    });
    await prisma.telegramIdentity.deleteMany({
      where: { user: { householdId: { in: ids } } },
    });
    await prisma.subcategory.deleteMany({
      where: { category: { householdId: { in: ids } } },
    });
    await prisma.category.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.user.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.household.deleteMany({ where: { id: { in: ids } } });
    await app.close();
    await prisma.$disconnect();
  }
});
