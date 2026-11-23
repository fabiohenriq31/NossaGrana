import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma, User } from "@prisma/client";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma, atomic } from "./db";
import { fail } from "./service";
import { getSettings } from "./settings";
import { adjustCredits, billingSummary } from "./billing";
import { banks, categories } from "./reference-data";
import { RESERVED_PERSON } from "./people";

/** Cadastro aberto, convite do parceiro e dados do núcleo (casal). */
export const PUBLIC_PATHS = ["/api/auth/signup", "/api/public/config"];
export const isPublicInvitePath = (path: string) =>
  path.startsWith("/api/auth/invite/");

const SESSION_SECONDS = 28800;
const INVITE_DAYS = 7;
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** E-mails em ADMIN_EMAILS viram administradores ao entrar (nunca remove o papel). */
export function bootstrapRole(email: string) {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase()) ? "ADMIN" : null;
}

export async function startSession(
  reply: FastifyReply,
  user: Pick<User, "id" | "householdId" | "tokenVersion">,
) {
  const token = await reply.jwtSign(
    { id: user.id, householdId: user.householdId, version: user.tokenVersion },
    { expiresIn: "8h" },
  );
  reply.setCookie("ng_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

async function validInvite(
  token: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const invite = await db.householdInvite.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      household: {
        include: {
          users: { select: { name: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (
    !invite ||
    invite.usedAt ||
    invite.expiresAt <= new Date() ||
    !invite.household.active
  )
    fail("Convite inválido ou expirado. Peça um novo link.", 404);
  return invite;
}

const signupInput = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome.").max(40),
    email: z.string().trim().toLowerCase().email("E-mail inválido.").max(120),
    password: z
      .string()
      .min(10, "A senha precisa de pelo menos 10 caracteres.")
      .max(128),
    householdName: z.string().trim().min(2).max(60).optional(),
    invite: z.string().min(20).max(100).optional(),
  })
  .strict();

export async function accountRoutes(app: FastifyInstance) {
  app.get("/api/public/config", async () => {
    const s = await getSettings();
    return {
      signupEnabled: s.signupEnabled && !s.maintenance.enabled,
      invitesEnabled: s.invitesEnabled,
      maintenance: s.maintenance.enabled ? s.maintenance.message : null,
      banner: s.banner.enabled && s.banner.message ? s.banner : null,
      signupBonusCredits: s.signupBonusCredits,
      creditCosts: s.creditCosts,
      plans: s.plans
        .filter((p) => p.active)
        .map(
          ({
            id,
            name,
            description,
            priceCents,
            monthlyCredits,
            unlimited,
            features,
            highlight,
          }) => ({
            id,
            name,
            description,
            priceCents,
            monthlyCredits,
            unlimited,
            features,
            highlight,
          }),
        ),
    };
  });

  app.get<{ Params: { token: string } }>(
    "/api/auth/invite/:token",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const s = await getSettings();
      if (!s.invitesEnabled)
        fail("Convites estão desativados no momento.", 403);
      const invite = await validInvite(req.params.token);
      return {
        householdName: invite.household.name,
        members: invite.household.users.map((u) => u.name),
      };
    },
  );

  app.post(
    "/api/auth/signup",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const v = signupInput.parse(req.body);
      const s = await getSettings();
      if (s.maintenance.enabled) fail(s.maintenance.message, 503);
      if (v.invite ? !s.invitesEnabled : !s.signupEnabled)
        fail(
          v.invite
            ? "Convites estão desativados no momento."
            : "Os cadastros estão fechados no momento.",
          403,
        );
      if (v.name.toLowerCase() === RESERVED_PERSON.toLowerCase())
        fail('"Casa" é reservado para gastos da casa. Use seu nome.');
      const passwordHash = await bcrypt.hash(v.password, 12);
      const user = await atomic(async (tx) => {
        if (await tx.user.findUnique({ where: { email: v.email } }))
          fail("Este e-mail já tem conta. Entre com sua senha.", 409);
        let householdId: string;
        if (v.invite) {
          const invite = await validInvite(v.invite, tx);
          if (invite.household.users.length >= s.maxMembers)
            fail("Este núcleo já está completo.", 409);
          if (
            invite.household.users.some(
              (u) => u.name.toLowerCase() === v.name.toLowerCase(),
            )
          )
            fail(
              "Já existe alguém com esse nome no núcleo. Use um apelido.",
              409,
            );
          householdId = invite.householdId;
        } else {
          for (const b of banks)
            await tx.bank.upsert({
              where: { id: b.id },
              create: b,
              update: {},
            });
          const household = await tx.household.create({
            data: {
              name: v.householdName || "Casa de " + v.name,
              mode: "REAL",
            },
          });
          householdId = household.id;
          await tx.category.createMany({
            data: categories.map((c) => ({ ...c, householdId })),
          });
          if (s.signupBonusCredits)
            await adjustCredits(
              householdId,
              s.signupBonusCredits,
              "BONUS_CADASTRO",
              null,
              null,
              tx,
            );
        }
        const created = await tx.user.create({
          data: {
            name: v.name,
            email: v.email,
            passwordHash,
            householdId,
            role: bootstrapRole(v.email) || "USER",
            lastLoginAt: new Date(),
          },
        });
        if (v.invite)
          await tx.householdInvite.update({
            where: { tokenHash: tokenHash(v.invite) },
            data: { usedAt: new Date(), usedById: created.id },
          });
        return created;
      });
      await startSession(reply, user);
      return reply.code(201).send({ name: user.name });
    },
  );

  app.get("/api/household", async (req) => {
    const h = await prisma.household.findUniqueOrThrow({
      where: { id: req.user.householdId },
      include: {
        users: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, email: true },
        },
        invites: {
          where: { usedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, expiresAt: true, createdAt: true },
        },
      },
    });
    const s = await getSettings();
    return {
      name: h.name,
      members: h.users.map((u) => ({ ...u, me: u.id === req.user.id })),
      invites: h.invites,
      maxMembers: s.maxMembers,
      invitesEnabled: s.invitesEnabled,
    };
  });

  app.patch("/api/household", async (req) => {
    const { name } = z
      .object({ name: z.string().trim().min(2).max(60) })
      .strict()
      .parse(req.body);
    await prisma.household.update({
      where: { id: req.user.householdId },
      data: { name },
    });
    return { name };
  });

  app.post(
    "/api/household/invites",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const s = await getSettings();
      if (!s.invitesEnabled)
        fail("Convites estão desativados no momento.", 403);
      const members = await prisma.user.count({
        where: { householdId: req.user.householdId },
      });
      if (members >= s.maxMembers) fail("O núcleo já está completo.", 409);
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000);
      // Um convite aberto por vez: gerar outro invalida o anterior.
      await prisma.householdInvite.deleteMany({
        where: { householdId: req.user.householdId, usedAt: null },
      });
      await prisma.householdInvite.create({
        data: {
          householdId: req.user.householdId,
          tokenHash: tokenHash(token),
          createdById: req.user.id,
          expiresAt,
        },
      });
      return {
        url: (process.env.APP_ORIGIN || "") + "/?convite=" + token,
        expiresAt,
      };
    },
  );

  app.delete("/api/household/invites", async (req) => {
    await prisma.householdInvite.deleteMany({
      where: { householdId: req.user.householdId, usedAt: null },
    });
    return { ok: true };
  });

  app.get("/api/billing", async (req) => billingSummary(req.user.householdId));
}
