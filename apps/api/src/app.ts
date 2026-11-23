import { TelegramIntegration } from "./integrations/telegram/integration";
import { telegramRoutes, WEBHOOK_PATH } from "./integrations/telegram/routes";
import { financialRoutes } from "./financial-routes";
import { financialHealthRoutes } from "./financial-health/routes";
import { FinancialCoachAI } from "./financial-health/coach";

import Fastify from "fastify";

import cookie from "@fastify/cookie";

import jwt from "@fastify/jwt";

import rateLimit from "@fastify/rate-limit";

import bcrypt from "bcrypt";

import { z, ZodError } from "zod";

import { Prisma } from "@prisma/client";

import { prisma } from "./db";

import { overview, fail } from "./service";
import {
  accountRoutes,
  PUBLIC_PATHS,
  isPublicInvitePath,
  startSession,
  bootstrapRole,
} from "./account-routes";
import { householdPeople, RESERVED_PERSON } from "./people";
import { adminRoutes } from "./admin-routes";
import { getSettings } from "./settings";
import { effectivePlan } from "./billing";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; householdId: string; version: number };

    user: { id: string; householdId: string; version: number };
  }
}

export async function buildApp(
  integration = new TelegramIntegration(),
  coach = new FinancialCoachAI(),
) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }),
    secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32)
    throw new Error("Defina JWT_SECRET com no mínimo 32 caracteres.");

  await app.register(cookie);

  await app.register(jwt, {
    secret,

    cookie: { cookieName: "ng_session", signed: false },
  });

  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply

        .code(400)

        .send({ message: error.issues.map((i) => i.message).join(" ") });

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        return reply.code(409).send({ message: "Este registro já existe." });

      if (error.code === "P2003")
        return reply

          .code(409)

          .send({ message: "Este registro possui movimentações vinculadas." });

      if (error.code === "P2025")
        return reply.code(404).send({ message: "Registro não encontrado." });
    }

    const e = error as { statusCode?: number; message: string };

    if (!e.statusCode || e.statusCode >= 500)
      req.log.error(
        {
          requestId: req.id,
          code: (error as { code?: string }).code || "INTERNAL_ERROR",
        },
        "Falha na API",
      );

    reply

      .code(e.statusCode || 500)

      .send({
        // 503 é sempre intencional (manutenção ou IA desligada no painel admin).
        message:
          e.statusCode && (e.statusCode < 500 || e.statusCode === 503)
            ? e.message
            : "Não foi possível concluir a operação.",
      });
  });

  app.addHook("onRequest", async (req, reply) => {
    reply

      .header("X-Content-Type-Options", "nosniff")

      .header("Cache-Control", "no-store");

    if (req.headers.origin === process.env.APP_ORIGIN) {
      reply
        .header("Access-Control-Allow-Origin", req.headers.origin)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      if (req.headers.origin !== process.env.APP_ORIGIN)
        fail("Origem não autorizada.", 403);
      reply
        .header(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        )
        .header("Access-Control-Allow-Headers", "Content-Type");
      return reply.code(204).send();
    }

    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== process.env.APP_ORIGIN
    )
      fail("Origem não autorizada.", 403);

    if (
      (req.method === "POST" && req.url.split("?")[0] === WEBHOOK_PATH) ||
      req.url.split("?")[0] === "/api/health" ||
      req.url.split("?")[0] === "/api/auth/login" ||
      PUBLIC_PATHS.includes(req.url.split("?")[0]) ||
      isPublicInvitePath(req.url.split("?")[0])
    )
      return;

    let role = "USER";
    try {
      await req.jwtVerify({ onlyCookie: true });

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { household: true },
      });

      if (
        !user ||
        user.tokenVersion !== req.user.version ||
        user.householdId !== req.user.householdId ||
        user.household.mode !== (process.env.APP_MODE || "REAL") ||
        !user.active ||
        !user.household.active
      )
        fail("Sessão expirada.", 401);
      role = user.role;
    } catch {
      fail("Entre na sua conta para continuar.", 401);
    }
    // Modo manutenção (painel admin): só o administrador continua usando.
    if (role !== "ADMIN" && req.url.split("?")[0] !== "/api/auth/logout") {
      const s = await getSettings();
      if (s.maintenance.enabled) fail(s.maintenance.message, 503);
    }
  });

  app.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;

    return { ok: true };
  });

  app.post(
    "/api/auth/login",

    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },

    async (req, reply) => {
      const v = z

        .object({
          email: z.string().email(),

          password: z.string().min(1).max(128),
        })

        .parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email: v.email.toLowerCase() },
        include: { household: true },
      });

      const valid = await bcrypt.compare(
        v.password,

        user?.passwordHash ||
          "$2b$12$9ttHQFXm6.MqeO9eTG1JUObQxgbZB66HtRxRas8QrpIVxtFRmv/Gy",
      );

      if (
        !user ||
        !valid ||
        user.household.mode !== (process.env.APP_MODE || "REAL")
      )
        fail("E-mail ou senha incorretos.", 401);

      if (!user.active || !user.household.active)
        fail("Esta conta está desativada. Fale com o suporte do Coflu.", 403);

      const role = bootstrapRole(user.email) || user.role;
      const s = await getSettings();
      if (s.maintenance.enabled && role !== "ADMIN")
        fail(s.maintenance.message, 503);

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), role },
      });

      await startSession(reply, user);

      return { name: user.name };
    },
  );

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("ng_session", { path: "/" });

    return { ok: true };
  });

  app.get("/api/overview", async (req) => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.id },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        household: {
          select: {
            name: true,
            plan: true,
            planExpiresAt: true,
            credits: true,
          },
        },
      },
    });

    const query = z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .default(
            new Date()
              .toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
              .slice(0, 7),
          ),
      })
      .parse(req.query);

    const [s, people] = await Promise.all([
      getSettings(),
      householdPeople(req.user.householdId),
    ]);
    const plan = effectivePlan(u.household, s);
    const result = await overview(
      req.user.householdId,
      { id: u.id, name: u.name, email: u.email },
      query.month,
    );
    return {
      ...result,
      user: { ...result.user, role: u.role },
      household: {
        name: u.household.name,
        plan: plan.id,
        planName: plan.name,
        credits: u.household.credits,
        unlimited: plan.unlimited,
        features: plan.features,
      },
      people,
      banner: s.banner.enabled && s.banner.message ? s.banner : null,
    };
  });

  app.patch("/api/profile", async (req) => {
    const v = z

      .object({
        name: z.string().trim().min(2).max(60),

        currentPassword: z.string().optional(),

        password: z.string().min(10).max(128).optional(),
      })

      .strict()

      .parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.id },
    });

    if (v.name !== user.name) {
      if (v.name.toLowerCase() === RESERVED_PERSON.toLowerCase())
        fail('"Casa" é reservado para gastos da casa.');
      if (
        await prisma.user.count({
          where: {
            householdId: user.householdId,
            id: { not: user.id },
            name: { equals: v.name, mode: "insensitive" },
          },
        })
      )
        fail("Já existe alguém com esse nome no núcleo.");
    }

    if (
      v.password &&
      (!v.currentPassword ||
        !(await bcrypt.compare(v.currentPassword, user.passwordHash)))
    )
      fail("A senha atual está incorreta.");

    if (v.name !== user.name)
      await prisma.$transaction([
        prisma.account.updateMany({
          where: { householdId: user.householdId, owner: user.name },
          data: { owner: v.name },
        }),
        prisma.creditCard.updateMany({
          where: { householdId: user.householdId, owner: user.name },
          data: { owner: v.name },
        }),
        prisma.transaction.updateMany({
          where: { householdId: user.householdId, owner: user.name },
          data: { owner: v.name },
        }),
      ]);

    await prisma.user.update({
      where: { id: user.id },

      data: {
        name: v.name,

        ...(v.password
          ? {
              passwordHash: await bcrypt.hash(v.password, 12),

              tokenVersion: { increment: 1 },
            }
          : {}),
      },
    });

    return { reauthenticate: !!v.password };
  });

  await accountRoutes(app);
  await adminRoutes(app);
  await financialRoutes(app);
  await financialHealthRoutes(app, coach);
  await telegramRoutes(app, integration);

  return app;
}
