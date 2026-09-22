import { nextOccurrence } from "./domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, atomic } from "./db";
import {
  accountInput,
  cardInput,
  categoryInput,
  transactionInput,
  recurrenceInput,
  settlementInput,
  cents,
  day,
} from "../../../packages/shared/src/validation";
import {
  owned,
  fail,
  createTransaction,
  validateReferences,
  cardUsed,
  protectInvoice,
  generateRecurrences,
} from "./service";
export async function financialRoutes(app: FastifyInstance) {
  for (const [path, model, schema] of [
    ["accounts", "account", accountInput],
    ["cards", "creditCard", cardInput],
    ["categories", "category", categoryInput],
  ] as const) {
    for (const method of ["POST", "PUT"] as const)
      app.route<{ Params: { id?: string } }>({
        method,
        url: "/api/" + path + (method === "PUT" ? "/:id" : ""),
        handler: async (req) => {
          const parsed = schema.parse(req.body),
            h = req.user.householdId,
            id = req.params.id;
          return atomic(async (tx) => {
            if (id) await owned(tx, model, id, h);
            if (
              "bankId" in parsed &&
              !(await tx.bank.findUnique({ where: { id: parsed.bankId } }))
            )
              fail("Banco inválido.");
            let data: Record<string, unknown> = { ...parsed, householdId: h };
            if (model === "account") {
              const v = accountInput.parse(parsed);
              data.openingDate = new Date(v.openingDate + "T12:00:00Z");
              if (id) {
                const old = await tx.account.findUniqueOrThrow({
                  where: { id },
                });
                const hasMovements = await tx.transaction.count({
                  where: {
                    OR: [{ accountId: id }, { destinationAccountId: id }],
                  },
                });
                if (
                  hasMovements &&
                  (v.initialBalance !== old.initialBalance ||
                    v.openingDate !==
                      old.openingDate.toISOString().slice(0, 10))
                )
                  fail(
                    "Saldo inicial e data de referência ficam preservados após o primeiro lançamento. Registre uma movimentação de ajuste.",
                  );
              }
            }
            if (model === "creditCard") {
              const v = cardInput.parse(parsed);
              if (v.paymentAccountId) {
                const a = await owned(tx, "account", v.paymentAccountId, h);
                if (!a.active) fail("Conta de pagamento arquivada.");
              }
              if (id) {
                const old = await tx.creditCard.findUniqueOrThrow({
                  where: { id },
                });
                if (
                  (old.closingDay !== v.closingDay ||
                    old.dueDay !== v.dueDay) &&
                  (await tx.invoice.count({ where: { cardId: id } }))
                )
                  fail(
                    "Dias de fechamento e vencimento ficam preservados quando já existem faturas.",
                  );
                if (v.limit < (await cardUsed(tx, id)))
                  fail("O limite não pode ser menor que o valor utilizado.");
              }
            }
            const repository = tx[model] as unknown as {
              create: (v: unknown) => Promise<unknown>;
              update: (v: unknown) => Promise<unknown>;
            };
            return id
              ? repository.update({ where: { id }, data })
              : repository.create({ data });
          });
        },
      });
    app.delete<{ Params: { id: string } }>(
      "/api/" + path + "/:id",
      async (req) =>
        atomic(async (tx) => {
          const h = req.user.householdId,
            id = req.params.id;
          await owned(tx, model, id, h);
          if (model === "category") {
            const recs = await tx.recurringTransaction.findMany({
              where: { householdId: h },
            });
            if (
              recs.some(
                (r) =>
                  (r.template as Record<string, unknown>).categoryId === id,
              )
            )
              fail("Categoria vinculada a uma recorrência.");
            return tx.category.delete({ where: { id } });
          }
          return (
            tx[model] as unknown as { update: (v: unknown) => Promise<unknown> }
          ).update({ where: { id }, data: { active: false } });
        }),
    );
  }
  app.post<{ Params: { id: string } }>(
    "/api/categories/:id/subcategories",
    async (req) => {
      const v = z
        .object({ name: z.string().trim().min(2).max(60) })
        .strict()
        .parse(req.body);
      return atomic(async (tx) => {
        await owned(tx, "category", req.params.id, req.user.householdId);
        return tx.subcategory.create({
          data: { categoryId: req.params.id, name: v.name },
        });
      });
    },
  );
  app.put<{ Params: { id: string } }>("/api/subcategories/:id", async (req) => {
    const v = z
      .object({ name: z.string().trim().min(2).max(60) })
      .strict()
      .parse(req.body);
    return atomic(async (tx) => {
      const sub = await tx.subcategory.findFirst({
        where: {
          id: req.params.id,
          category: { householdId: req.user.householdId },
        },
      });
      if (!sub) fail("Subcategoria não encontrada.", 404);
      return tx.subcategory.update({ where: { id: sub.id }, data: v });
    });
  });
  app.delete<{ Params: { id: string } }>(
    "/api/subcategories/:id",
    async (req) =>
      atomic(async (tx) => {
        const sub = await tx.subcategory.findFirst({
          where: {
            id: req.params.id,
            category: { householdId: req.user.householdId },
          },
        });
        if (!sub) fail("Subcategoria não encontrada.", 404);
        const recs = await tx.recurringTransaction.findMany({
          where: { householdId: req.user.householdId },
        });
        if (
          recs.some(
            (r) =>
              (r.template as Record<string, unknown>).subcategoryId === sub.id,
          )
        )
          fail("Subcategoria utilizada por uma recorrência.");
        return tx.subcategory.delete({ where: { id: sub.id } });
      }),
  );
  app.post("/api/transactions", async (req) =>
    atomic((tx) =>
      createTransaction(
        tx,
        req.user.householdId,
        transactionInput.parse(req.body),
      ),
    ),
  );
  app.put<{ Params: { id: string } }>("/api/transactions/:id", async (req) =>
    atomic((tx) =>
      createTransaction(
        tx,
        req.user.householdId,
        transactionInput.parse(req.body),
        {},
        req.params.id,
      ),
    ),
  );
  app.patch<{ Params: { id: string } }>(
    "/api/transactions/:id/confirm",
    async (req) => {
      const v = settlementInput.parse(req.body);
      return atomic(async (tx) => {
        await owned(tx, "transaction", req.params.id, req.user.householdId);
        const t = await tx.transaction.findUniqueOrThrow({
          where: { id: req.params.id },
        });
        if (t.status === "CONFIRMADA") return t;
        if (t.status === "CANCELADA") fail("Esta movimentação está cancelada.");
        const input = transactionInput.parse({
          description: t.description,
          amount: t.amount,
          date: t.cardId ? t.date.toISOString().slice(0, 10) : v.date,
          type: t.type,
          paymentMethod: t.paymentMethod,
          status: "CONFIRMADA",
          owner: t.owner,
          accountId: t.cardId ? null : v.accountId || t.accountId,
          cardId: t.cardId,
          destinationAccountId: t.destinationAccountId,
          categoryId: t.categoryId,
          subcategoryId: t.subcategoryId,
          notes: t.notes,
          tags: t.tags,
        });
        return createTransaction(tx, req.user.householdId, input, {}, t.id);
      });
    },
  );
  app.delete<{ Params: { id: string } }>("/api/transactions/:id", async (req) =>
    atomic(async (tx) => {
      await owned(tx, "transaction", req.params.id, req.user.householdId);
      const t = await tx.transaction.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      await protectInvoice(tx, t.invoiceId);
      return tx.transaction.update({
        where: { id: t.id },
        data: { status: "CANCELADA", cancelledAt: new Date() },
      });
    }),
  );
  app.delete<{ Params: { id: string } }>("/api/installments/:id", async (req) =>
    atomic(async (tx) => {
      const p = await tx.installmentPurchase.findFirst({
        where: {
          id: req.params.id,
          card: { householdId: req.user.householdId },
        },
        include: { transactions: true },
      });
      if (!p) fail("Parcelamento não encontrado.", 404);
      for (const t of p.transactions) await protectInvoice(tx, t.invoiceId);
      await tx.transaction.updateMany({
        where: { installmentPurchaseId: p.id },
        data: { status: "CANCELADA", cancelledAt: new Date() },
      });
      return { ok: true };
    }),
  );
  app.post<{ Params: { id: string } }>("/api/invoices/:id/pay", async (req) => {
    const v = z
      .object({ accountId: z.string(), amount: cents, date: day })
      .strict()
      .parse(req.body);
    return atomic(async (tx) => {
      await owned(tx, "account", v.accountId, req.user.householdId);
      const a = await tx.account.findUniqueOrThrow({
        where: { id: v.accountId },
      });
      if (!a.active) fail("Conta arquivada.");
      if (v.date < a.openingDate.toISOString().slice(0, 10))
        fail("Pagamento anterior ao saldo inicial.");
      const invoice = await tx.invoice.findFirst({
        where: {
          id: req.params.id,
          card: { householdId: req.user.householdId },
        },
        include: { transactions: true, payments: true, card: true },
      });
      if (!invoice) fail("Fatura não encontrada.", 404);
      const remaining =
        invoice.transactions
          .filter((t) => t.status === "CONFIRMADA")
          .reduce((s, t) => s + t.amount, 0) -
        invoice.payments
          .filter((t) => t.status === "CONFIRMADA")
          .reduce((s, t) => s + t.amount, 0);
      if (v.amount > remaining)
        fail("O pagamento excede o valor restante da fatura.");
      const t = await tx.transaction.create({
        data: {
          householdId: req.user.householdId,
          description: "Pagamento fatura " + invoice.card.name,
          amount: v.amount,
          date: new Date(v.date + "T12:00:00Z"),
          competence: v.date.slice(0, 7),
          type: "DESPESA",
          paymentMethod: "BOLETO",
          status: "CONFIRMADA",
          owner: invoice.card.owner,
          accountId: v.accountId,
          paymentInvoiceId: invoice.id,
          tags: [],
        },
      });
      await tx.invoicePayment.create({
        data: { invoiceId: invoice.id, transactionId: t.id },
      });
      return t;
    });
  });
  app.post("/api/recurrences", async (req) => {
    const v = recurrenceInput.parse(req.body);
    return atomic(async (tx) => {
      await validateReferences(tx, req.user.householdId, {
        ...v.transaction,
        date: v.nextDate,
      });
      const next = new Date(v.nextDate + "T12:00:00Z");
      const r = await tx.recurringTransaction.create({
        data: {
          householdId: req.user.householdId,
          description: v.transaction.description,
          amount: v.transaction.amount,
          frequency: v.frequency,
          interval: v.interval,
          nextDate: nextOccurrence(
            next,
            v.frequency,
            v.interval,
            next.getUTCDate(),
            next.getUTCMonth(),
          ),
          anchorDay: next.getUTCDate(),
          anchorMonth: next.getUTCMonth(),
          template: v.transaction,
        },
      });
      await createTransaction(
        tx,
        req.user.householdId,
        transactionInput.parse({
          ...v.transaction,
          date: v.nextDate,
          status: "PENDENTE",
        }),
        { recurringId: r.id, occurrenceDate: next, source: "AUTOMACAO" },
      );
      return r;
    });
  });
  app.patch<{ Params: { id: string } }>("/api/recurrences/:id", async (req) => {
    const v = z.object({ active: z.boolean() }).strict().parse(req.body);
    return atomic(async (tx) => {
      await owned(
        tx,
        "recurringTransaction",
        req.params.id,
        req.user.householdId,
      );
      return tx.recurringTransaction.update({
        where: { id: req.params.id },
        data: v,
      });
    });
  });
  app.post("/api/recurrences/generate", async (req) => {
    const v = z.object({ until: day }).strict().parse(req.body);
    const until = new Date(v.until + "T23:59:59Z");
    if (until > new Date(Date.now() + 366 * 86400000))
      fail("Gere no máximo um ano à frente.");
    return generateRecurrences(req.user.householdId, until);
  });
}
