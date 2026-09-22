import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma, atomic } from "../src/db";
import { createTransaction } from "../src/service";
import { transactionInput } from "../../../packages/shared/src/validation";
import { banks, categories } from "../../../scripts/reference-data";
try {
  if (process.env.APP_MODE !== "DEMO" || process.env.NODE_ENV === "production")
    throw new Error(
      "Seed exige APP_MODE=DEMO em um banco de desenvolvimento separado.",
    );
  if (await prisma.household.count({ where: { mode: "REAL" } }))
    throw new Error("Este banco contém um núcleo real. Seed recusado.");
  if (await prisma.household.findUnique({ where: { id: "household-demo" } })) {
    console.log("Demo já inicializado; nada alterado.");
  } else {
    const password = process.env.SEED_PASSWORD;
    if (!password || password === "configure-me" || password.length < 10)
      throw new Error("Defina SEED_PASSWORD no ambiente de desenvolvimento.");
    const hash = await bcrypt.hash(password, 12);
    await atomic(async (tx) => {
      const h = await tx.household.create({
        data: {
          id: "household-demo",
          name: "Fábio e Bianca · Demo",
          mode: "DEMO",
        },
      });
      for (const [name, email] of [
        ["Fábio", "fabio@demo.local"],
        ["Bianca", "bianca@demo.local"],
      ])
        await tx.user.create({
          data: { householdId: h.id, name, email, passwordHash: hash },
        });
      for (const b of banks)
        await tx.bank.upsert({ where: { id: b.id }, create: b, update: {} });
      for (const c of categories)
        await tx.category.create({ data: { ...c, householdId: h.id } });
      const a = await tx.account.create({
        data: {
          householdId: h.id,
          bankId: "nubank",
          name: "Conta demonstração",
          owner: "Fábio",
          type: "Corrente",
          initialBalance: 100000,
          openingDate: new Date("2026-01-01T12:00:00Z"),
        },
      });
      await createTransaction(
        tx,
        h.id,
        transactionInput.parse({
          description: "Receita demonstrativa",
          amount: 480000,
          date: "2026-09-01",
          type: "RECEITA",
          owner: "Fábio",
          accountId: a.id,
          paymentMethod: "PIX",
        }),
      );
    });
    console.log("Demo opcional criado em banco separado.");
  }
} finally {
  await prisma.$disconnect();
}
