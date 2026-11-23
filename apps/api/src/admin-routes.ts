import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, atomic } from "./db";
import { fail } from "./service";
import {
  getSettings,
  saveSettings,
  settingsSchema,
  defaultSettings,
  featureLabels,
} from "./settings";
import { adjustCredits, effectivePlan, setPlan, usageReasons } from "./billing";

/**
 * Painel administrativo. Toda rota confere no banco se quem chama é ADMIN ativo (o papel
 * não vai no cookie, então rebaixar alguém vale na hora) e toda alteração vai para a
 * auditoria.
 */
async function requireAdmin(req: FastifyRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || user.role !== "ADMIN" || !user.active)
    fail("Acesso restrito ao administrador.", 403);
  return user;
}

async function audit(
  db: Prisma.TransactionClient | typeof prisma,
  actorUserId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details?: unknown,
) {
  await db.adminAuditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId,
      details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin/")) await requireAdmin(req);
  });

  app.get("/api/admin/stats", async () => {
    const s = await getSettings();
    const [
      households,
      users,
      active7,
      signups7,
      signups30,
      usage,
      byPlan,
      recent,
      purchases,
    ] = await Promise.all([
      prisma.household.count(),
      prisma.user.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
      prisma.creditLedger.groupBy({
        by: ["reason"],
        where: {
          createdAt: { gte: monthStart() },
          reason: { in: Object.values(usageReasons) },
        },
        _count: { _all: true },
        _sum: { delta: true },
      }),
      prisma.household.groupBy({ by: ["plan"], _count: { _all: true } }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          household: { select: { id: true, name: true } },
        },
      }),
      prisma.creditLedger.aggregate({
        where: { createdAt: { gte: monthStart() }, reason: "COMPRA" },
        _sum: { delta: true },
      }),
    ]);
    const planName = (id: string) =>
      s.plans.find((p) => p.id === id)?.name || id;
    // Receita estimada: soma dos planos pagos ativos (o checkout real ainda não existe).
    const paying = await prisma.household.findMany({
      where: {
        plan: { not: "FREE" },
        OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: new Date() } }],
      },
      select: { plan: true, planExpiresAt: true },
    });
    const mrr = paying.reduce(
      (sum, h) => sum + (s.plans.find((p) => p.id === h.plan)?.priceCents || 0),
      0,
    );
    return {
      households,
      users,
      active7,
      signups7,
      signups30,
      payingHouseholds: paying.length,
      estimatedMonthlyRevenue: mrr,
      creditsSoldThisMonth: purchases._sum.delta || 0,
      usage: Object.entries(usageReasons).map(([kind, reason]) => {
        const row = usage.find((u) => u.reason === reason);
        return {
          kind,
          uses: row?._count._all || 0,
          credits: -(row?._sum.delta || 0),
        };
      }),
      byPlan: byPlan.map((p) => ({
        plan: p.plan,
        name: planName(p.plan),
        count: p._count._all,
      })),
      recent,
    };
  });

  app.get("/api/admin/households", async (req) => {
    const { q, page } = z
      .object({
        q: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const where: Prisma.HouseholdWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            {
              users: { some: { email: { contains: q, mode: "insensitive" } } },
            },
            { users: { some: { name: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {};
    const s = await getSettings();
    const [total, rows] = await Promise.all([
      prisma.household.count({ where }),
      prisma.household.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 25,
        take: 25,
        include: {
          users: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              active: true,
              lastLoginAt: true,
              createdAt: true,
            },
          },
          _count: { select: { transactions: true } },
        },
      }),
    ]);
    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / 25)),
      items: rows.map((h) => ({
        id: h.id,
        name: h.name,
        active: h.active,
        plan: h.plan,
        planName: effectivePlan(h, s).name,
        planExpired: !!h.planExpiresAt && h.planExpiresAt <= new Date(),
        planExpiresAt: h.planExpiresAt,
        planRenewsAt: h.planRenewsAt,
        credits: h.credits,
        createdAt: h.createdAt,
        transactions: h._count.transactions,
        users: h.users,
      })),
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/admin/households/:id/ledger",
    async (req) =>
      prisma.creditLedger.findMany({
        where: { householdId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/households/:id/credits",
    async (req) => {
      const admin = await requireAdmin(req);
      const v = z
        .object({
          delta: z
            .number()
            .int()
            .min(-100000)
            .max(100000)
            .refine((n) => n !== 0, "Informe um valor."),
          note: z.string().trim().max(200).default(""),
          purchase: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      return atomic(async (tx) => {
        const credits = await adjustCredits(
          req.params.id,
          v.delta,
          v.purchase && v.delta > 0 ? "COMPRA" : "AJUSTE_ADMIN",
          v.note || null,
          admin.id,
          tx,
        );
        await audit(
          tx,
          admin.id,
          "credits.adjust",
          "household",
          req.params.id,
          v,
        );
        return { credits };
      });
    },
  );

  app.put<{ Params: { id: string } }>(
    "/api/admin/households/:id/plan",
    async (req) => {
      const admin = await requireAdmin(req);
      const v = z
        .object({
          plan: z.string().min(1).max(20),
          expiresAt: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          grantCredits: z.boolean().default(true),
        })
        .strict()
        .parse(req.body);
      const expires = v.expiresAt
        ? new Date(v.expiresAt + "T23:59:59-03:00")
        : null;
      if (expires && expires <= new Date())
        fail("A validade precisa ser uma data futura.");
      await atomic(async (tx) => {
        await tx.household.findUniqueOrThrow({ where: { id: req.params.id } });
        await setPlan(
          req.params.id,
          v.plan,
          expires,
          v.grantCredits,
          admin.id,
          tx,
        );
        await audit(tx, admin.id, "plan.set", "household", req.params.id, v);
      });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/admin/households/:id",
    async (req) => {
      const admin = await requireAdmin(req);
      const v = z.object({ active: z.boolean() }).strict().parse(req.body);
      if (!v.active && admin.householdId === req.params.id)
        fail("Você não pode desativar o seu próprio núcleo.");
      await atomic(async (tx) => {
        await tx.household.update({
          where: { id: req.params.id },
          data: { active: v.active },
        });
        // Desativar derruba as sessões abertas dos membros.
        if (!v.active)
          await tx.user.updateMany({
            where: { householdId: req.params.id },
            data: { tokenVersion: { increment: 1 } },
          });
        await audit(
          tx,
          admin.id,
          v.active ? "household.activate" : "household.deactivate",
          "household",
          req.params.id,
        );
      });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string } }>("/api/admin/users/:id", async (req) => {
    const admin = await requireAdmin(req);
    const v = z
      .object({
        active: z.boolean().optional(),
        role: z.enum(["USER", "ADMIN"]).optional(),
        logout: z.literal(true).optional(),
      })
      .strict()
      .parse(req.body);
    if (req.params.id === admin.id && (v.active === false || v.role === "USER"))
      fail("Você não pode desativar nem rebaixar a sua própria conta.");
    await atomic(async (tx) => {
      await tx.user.update({
        where: { id: req.params.id },
        data: {
          ...(v.active !== undefined ? { active: v.active } : {}),
          ...(v.role ? { role: v.role } : {}),
          ...(v.logout || v.active === false
            ? { tokenVersion: { increment: 1 } }
            : {}),
        },
      });
      await audit(tx, admin.id, "user.update", "user", req.params.id, v);
    });
    return { ok: true };
  });

  app.get("/api/admin/settings", async () => ({
    settings: await getSettings(),
    defaults: defaultSettings,
    featureLabels,
  }));

  app.put("/api/admin/settings", async (req) => {
    const admin = await requireAdmin(req);
    const next = settingsSchema.parse(req.body);
    const before = await getSettings();
    return atomic(async (tx) => {
      const saved = await saveSettings(next, admin.id, tx);
      const changed = Object.keys(saved).filter(
        (k) =>
          JSON.stringify(saved[k as keyof typeof saved]) !==
          JSON.stringify(before[k as keyof typeof before]),
      );
      await audit(tx, admin.id, "settings.update", "settings", "app", {
        changed,
      });
      return saved;
    });
  });

  app.get("/api/admin/audit", async () => {
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const actors = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorUserId))] } },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({
      ...r,
      actor: actors.find((a) => a.id === r.actorUserId)?.name || "—",
    }));
  });
}
