import { financialRoutes } from "./financial-routes";

import Fastify from "fastify";

import cookie from "@fastify/cookie";

import jwt from "@fastify/jwt";

import rateLimit from "@fastify/rate-limit";

import bcrypt from "bcrypt";

import { z, ZodError } from "zod";

import { Prisma } from "@prisma/client";

import { prisma, atomic } from "./db";

import {
  accountInput,
  cardInput,
  categoryInput,
  transactionInput,
  recurrenceInput,
  cents,
  day,
} from "../../../packages/shared/src/validation";

import {
  createTransaction,
  owned,
  overview,
  fail,
  generateRecurrences,
} from "./service";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; householdId: string; version: number };

    user: { id: string; householdId: string; version: number };
  }
}

export async function buildApp() {
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
        message:
          e.statusCode && e.statusCode < 500
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
      req.url.split("?")[0] === "/api/health" ||
      req.url.split("?")[0] === "/api/auth/login"
    )
      return;

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
        user.household.mode !== (process.env.APP_MODE || "REAL")
      )
        fail("Sessão expirada.", 401);
    } catch {
      fail("Entre na sua conta para continuar.", 401);
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

      const token = await reply.jwtSign(
        {
          id: user.id,

          householdId: user.householdId,

          version: user.tokenVersion,
        },

        { expiresIn: "8h" },
      );

      reply.setCookie("ng_session", token, {
        httpOnly: true,

        sameSite: "strict",

        secure: process.env.NODE_ENV === "production",

        path: "/",

        maxAge: 28800,
      });

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

      select: { id: true, name: true, email: true },
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

    return overview(req.user.householdId, u, query.month);
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

    if (
      v.password &&
      (!v.currentPassword ||
        !(await bcrypt.compare(v.currentPassword, user.passwordHash)))
    )
      fail("A senha atual está incorreta.");

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

  await financialRoutes(app);

  return app;
}
