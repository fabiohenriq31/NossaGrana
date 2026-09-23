import "dotenv/config";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { mkdir, writeFile } from "node:fs/promises";
const database = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(database.hostname))
  throw new Error("QA exige banco local isolado.");
const prisma = new PrismaClient(),
  h = "coflu-opening-qa-" + randomUUID(),
  password = randomUUID(),
  email = h + "@example.test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const base = "http://127.0.0.1:5173",
  errors = [],
  captures = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 500)
    errors.push("HTTP " + r.status() + " " + new URL(r.url()).pathname);
});
const api = async (path, body) => {
  const r =
    body === undefined
      ? await context.request.get(base + "/api" + path)
      : await context.request.post(base + "/api" + path, { data: body });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
};
async function capture(name) {
  await expect(page).toHaveTitle("Coflu • Nossas finanças");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (await page.getByRole("dialog").count())
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/coflu-opening-" + name + ".png",
    fullPage: true,
  });
  captures.push(name);
}
try {
  await mkdir("docs/screenshots", { recursive: true });
  await prisma.household.create({
    data: { id: h, name: "QA saldos iniciais" },
  });
  await prisma.user.create({
    data: {
      householdId: h,
      name: "Fábio",
      email,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  await page.goto(base);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar no Coflu", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const account = await api("/accounts", {
    name: "Principal QA",
    bankId: "nubank",
    owner: "Fábio",
    type: "Corrente",
    initialBalance: 2000000,
    openingDate: "2026-01-01",
  });
  const category = await api("/categories", {
    name: "Compras reais QA",
    color: "#ffffff",
    icon: "wallet",
  });
  await page.goto(base + "/cartoes");
  await page.getByRole("button", { name: "Novo cartão", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Nubank QA");
  await page.getByRole("combobox", { name: "Banco", exact: true }).click();
  await page.getByRole("option", { name: "Nubank", exact: true }).click();
  await page.getByLabel("Limite (R$)", { exact: true }).fill("10.000,00");
  await page.getByLabel("Últimos 4 dígitos", { exact: true }).fill("4821");
  await page
    .getByLabel("Conta para pagamento da fatura", { exact: true })
    .selectOption(account.id);
  await page
    .getByRole("radio", {
      name: "Sim, adicionar valores existentes",
      exact: true,
    })
    .check();
  const months = [
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ],
    amounts = ["2.500,00", "1.100,00", "800,00", "600,00", "500,00", "500,00"];
  for (let i = 0; i < months.length; i++) {
    if (i)
      await page
        .getByRole("button", { name: "Adicionar outro mês", exact: true })
        .click();
    await page
      .getByLabel("Mês da fatura " + (i + 1), { exact: true })
      .selectOption(months[i].slice(5));
    await page
      .getByLabel("Ano da fatura " + (i + 1), { exact: true })
      .fill(months[i].slice(0, 4));
    await page
      .getByLabel("Valor existente " + (i + 1), { exact: true })
      .fill(amounts[i]);
  }
  await expect(page.locator(".opening-total")).toContainText("6.000,00");
  await page.locator(".opening-total").scrollIntoViewIfNeeded();
  await capture("onboarding-desktop");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let d = await api("/overview?month=2026-10"),
    card = d.cards[0];
  expect(card.used).toBe(600000);
  expect(card.available).toBe(400000);
  expect(d.transactions).toHaveLength(0);
  await page
    .getByRole("link", { name: "outubro de 2026", exact: true })
    .click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Cartões", exact: true })
    .click();
  await expect(page.locator(".credit-details")).toContainText("2.500,00");
  await capture("card-desktop");
  await page
    .getByRole("button", { name: "Valores iniciais", exact: true })
    .click();
  await page.getByLabel("Valor existente 1", { exact: true }).fill("-1");
  await page
    .getByRole("button", { name: "Salvar valores", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Valor existente 1", { exact: true }).fill("2.500,00");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog").evaluate((el) => {
    el.scrollTop = 0;
  });
  await capture("editor-mobile-dark");
  await page
    .getByRole("button", { name: "Remover mês 6", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adicionar outro mês", exact: true })
    .click();
  await page.getByLabel("Mês da fatura 6", { exact: true }).selectOption("03");
  await page.getByLabel("Ano da fatura 6", { exact: true }).fill("2027");
  await page.getByLabel("Valor existente 6", { exact: true }).fill("500,00");
  await page
    .getByRole("button", { name: "Adicionar outro mês", exact: true })
    .click();
  await page.getByLabel("Mês da fatura 7", { exact: true }).selectOption("07");
  await page.getByLabel("Ano da fatura 7", { exact: true }).fill("2027");
  await page.getByLabel("Valor existente 7", { exact: true }).fill("100,00");
  await page
    .getByRole("button", { name: "Salvar valores", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await api("/overview?month=2026-10")).cards[0].used).toBe(610000);
  await page
    .getByRole("button", { name: "Valores iniciais", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remover mês 7", exact: true })
    .click();
  await page.getByLabel("Valor existente 1", { exact: true }).fill("2.600,00");
  await page
    .getByRole("button", { name: "Salvar valores", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await api("/overview?month=2026-10")).invoices.find(
      (i) => i.competence === "2026-10",
    ).openingBalance,
  ).toBe(260000);
  await page
    .getByRole("button", { name: "Valores iniciais", exact: true })
    .click();
  await page.getByLabel("Valor existente 1", { exact: true }).fill("2.500,00");
  await page
    .getByRole("button", { name: "Salvar valores", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await capture("card-mobile");
  for (const [description, amount] of [
    ["Mercado", 18000],
    ["Combustível", 22000],
    ["Restaurante", 10000],
  ])
    await api("/transactions", {
      description,
      amount,
      date: "2026-10-10",
      type: "DESPESA",
      paymentMethod: "CREDITO",
      owner: "Fábio",
      categoryId: category.id,
      cardId: card.id,
    });
  await page
    .getByRole("link", { name: "outubro de 2026", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Ver lançamentos", exact: true })
    .click();
  await expect(
    page.getByText("Saldo inicial/importado", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".invoice-total")).toContainText("3.000,00");
  await capture("invoice-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("invoice-desktop");
  await page.getByRole("button", { name: "Pagar fatura", exact: true }).click();
  await page
    .getByLabel("Data do pagamento", { exact: true })
    .fill("2026-10-22");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".status-pill")).toHaveText("Paga");
  d = await api("/overview?month=2026-10");
  expect(d.cards[0].used).toBe(350000);
  expect(d.cards[0].available).toBe(650000);
  expect(d.accounts[0].balance).toBe(1700000);
  expect(d.analytics.summary.expenses).toBe(50000);
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await capture("dashboard-desktop");
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Cartões", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Valores iniciais", exact: true })
    .click();
  await expect(
    page.getByLabel("Valor existente 1", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await capture("editor-desktop-paid");
  await page
    .getByRole("button", { name: "Fechar", exact: true })
    .last()
    .click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Claro", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Valores iniciais", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("editor-mobile-light");
  await page
    .getByRole("button", { name: "Fechar", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Novo cartão", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Cartão do zero");
  await page.getByRole("combobox", { name: "Banco", exact: true }).click();
  await page.getByRole("option", { name: "Nubank", exact: true }).click();
  await page.getByLabel("Limite (R$)", { exact: true }).fill("1.000,00");
  await expect(
    page.getByRole("radio", { name: "Não, começar do zero", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await api("/overview")).cards.find((c) => c.name === "Cartão do zero")
      .used,
  ).toBe(0);
  expect(errors).toEqual([]);
  const result = {
    passed: true,
    captures,
    consoleErrors: errors,
    acceptance: {
      initialCommitted: 600000,
      initialAvailable: 400000,
      octoberTotal: 300000,
      afterPaymentCommitted: 350000,
      afterPaymentAvailable: 650000,
      accountBalance: 1700000,
      reportedExpenses: 50000,
    },
  };
  await writeFile(
    "docs/opening-balances-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await context.close();
  await browser.close();
  await prisma.invoicePayment.deleteMany({
    where: { transaction: { householdId: h } },
  });
  await prisma.transaction.deleteMany({ where: { householdId: h } });
  await prisma.invoice.deleteMany({ where: { card: { householdId: h } } });
  await prisma.creditCard.deleteMany({ where: { householdId: h } });
  await prisma.account.deleteMany({ where: { householdId: h } });
  await prisma.category.deleteMany({ where: { householdId: h } });
  await prisma.user.deleteMany({ where: { householdId: h } });
  await prisma.household.deleteMany({ where: { id: h } });
  await prisma.$disconnect();
}
