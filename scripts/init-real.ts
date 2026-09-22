import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { prisma } from "../apps/api/src/db";
import { banks, categories } from "./reference-data";
if (process.env.APP_MODE === "DEMO")
  throw new Error("APP_MODE deve ser REAL para esta inicialização.");
if (await prisma.household.count({ where: { mode: "DEMO" } }))
  throw new Error(
    "Este banco contém um household demo. Use o Supabase real vazio; o inicializador não mistura bases.",
  );
const householdId = "nossagrana-family";
function value(key: string, fallback: () => string) {
  let v = process.env[key];
  if (!v || v === "configure-me") {
    v = fallback();
    appendFileSync(".env", "\n" + key + "=" + JSON.stringify(v) + "\n");
    process.env[key] = v;
  }
  return v;
}
const users = [
  {
    id: "nossagrana-fabio",
    name: "Fábio",
    email: value("FABIO_EMAIL", () => "fabio@nossagrana.local"),
    password: value("FABIO_PASSWORD", () =>
      randomBytes(18).toString("base64url"),
    ),
  },
  {
    id: "nossagrana-bianca",
    name: "Bianca",
    email: value("BIANCA_EMAIL", () => "bianca@nossagrana.local"),
    password: value("BIANCA_PASSWORD", () =>
      randomBytes(18).toString("base64url"),
    ),
  },
];
for (const u of users)
  if (u.password.length < 10)
    throw new Error("As senhas iniciais devem ter pelo menos 10 caracteres.");
await prisma.$transaction(
  async (tx) => {
    await tx.household.upsert({
      where: { id: householdId },
      create: { id: householdId, name: "Fábio & Bianca", mode: "REAL" },
      update: {},
    });
    for (const b of banks)
      await tx.bank.upsert({ where: { id: b.id }, create: b, update: {} });
    for (const c of categories)
      await tx.category.upsert({
        where: { householdId_name: { householdId, name: c.name } },
        create: { ...c, householdId },
        update: {},
      });
    for (const u of users) {
      const existing = await tx.user.findUnique({ where: { id: u.id } });
      if (!existing)
        await tx.user.create({
          data: {
            id: u.id,
            name: u.name,
            email: u.email.toLowerCase(),
            householdId,
            passwordHash: await bcrypt.hash(u.password, 12),
          },
        });
    }
  },
  { timeout: 30000 },
);
console.log(
  "Inicialização real concluída. Household, Fábio, Bianca, catálogo de bancos e categorias. Nenhuma conta, cartão, fatura ou transação fictícia inserida. E-mails e senhas iniciais estão somente no .env local.",
);
await prisma.$disconnect();
