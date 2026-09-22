import "dotenv/config";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const db = new PrismaClient(),
  h = "browser-qa-" + randomUUID(),
  email = h + "@example.test",
  password = randomUUID();
const base = "http://127.0.0.1:5173",
  errors = [],
  requests = [],
  steps = [];
await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
let context = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1440, height: 900 },
  }),
  page = await context.newPage();
const listen = () => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
};
listen();
const login = async (e, p) => {
  await page.goto(base);
  await page.getByLabel("E-mail", { exact: true }).fill(e);
  await page.getByLabel("Senha", { exact: true }).fill(p);
  await page.getByRole("button", { name: "Entrar na NossaGrana" }).click();
  await expect(page.locator(".desktop-dashboard h1")).toBeVisible({
    timeout: 20000,
  });
};
const goto = async (path, title) => {
  await page.goto(base + path);
  if (title)
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
};
const read = async () => {
  const r = await context.request.get(base + "/api/overview?month=2026-09");
  expect(r.ok()).toBeTruthy();
  return r.json();
};
const save = async (path, button = "Salvar") => {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/" + path) &&
      ["POST", "PUT", "PATCH"].includes(r.request().method()),
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  const r = await response;
  expect(r.ok(), await r.text()).toBeTruthy();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};
const fill = async (name, value) =>
  page.getByLabel(name, { exact: true }).fill(value);
const select = async (name, value) =>
  page.getByLabel(name, { exact: true }).selectOption(value);
const chooseBank = async (name) => {
  await page.getByRole("combobox", { name: "Banco", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
};
const tx = async ({
  name,
  type = "DESPESA",
  method = "PIX",
  amount = "10,00",
  account,
  card,
  category,
  date = "2026-09-10",
  status = "CONFIRMADA",
  destination,
  installments,
  repeat,
}) => {
  await goto("/transacoes", "Transações");
  await page
    .getByRole("button", { name: "Nova transação", exact: true })
    .click();
  await select("Tipo", type);
  await fill("Descrição", name);
  await fill("Valor (R$)", amount);
  await fill("Data", date);
  if (type === "DESPESA") {
    await select("Forma de pagamento", method);
    await select("Categoria", category);
  }
  if (card) await select("Cartão", card);
  else
    await select(
      type === "RECEITA"
        ? "Conta de destino"
        : type === "TRANSFERENCIA"
          ? "Conta de origem"
          : "Conta",
      account,
    );
  if (destination) await select("Conta de destino", destination);
  if (installments) await fill("Número de parcelas", String(installments));
  await select("Situação", status);
  if (repeat) await select("Repetir", repeat);
  await save(repeat ? "recurrences" : "transactions");
};
try {
  await login(
    process.env.FABIO_EMAIL || "fabio@nossagrana.local",
    process.env.FABIO_PASSWORD,
  );
  const real = await read();
  expect(real.accounts.length).toBe(0);
  expect(real.transactions.length).toBe(0);
  await expect(
    page.getByRole("button", { name: "Cadastrar primeira conta", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/real-empty-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/screenshots/real-empty-mobile.png",
    fullPage: true,
  });
  console.log("Etapa concluída");
  steps.push("Primeiro acesso real sem valores fictícios");
  await context.clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(
    process.env.BIANCA_EMAIL || "bianca@nossagrana.local",
    process.env.BIANCA_PASSWORD,
  );
  await expect(page.locator(".desktop-dashboard h1")).toContainText("Bianca");
  steps.push("Login dos dois usuários iniciais");
  await context.close();
  await db.household.create({
    data: { id: h, name: "QA temporário", mode: "REAL" },
  });
  await db.user.create({
    data: {
      householdId: h,
      email,
      name: "Fábio",
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  const category = await db.category.create({
    data: {
      householdId: h,
      name: "Alimentação QA",
      color: "#f5675d",
      icon: "food",
    },
  });
  context = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  listen();
  await login(email, password);
  const account = async (name, bank, owner, amount) => {
    await goto("/contas", "Contas");
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    await fill("Nome", name);
    await chooseBank(bank);
    await select("Titular", owner);
    await fill("Saldo inicial (R$)", amount);
    await fill("Data de referência do saldo inicial", "2026-01-01");
    await save("accounts");
    return (await read()).accounts.find((a) => a.name === name).id;
  };
  const a = await account("Nubank Fábio QA", "Nubank", "Fábio", "2750,43"),
    b = await account("Itaú Fábio QA", "Itaú", "Fábio", "0,00");
  await account("Nubank Bianca QA", "Nubank", "Bianca", "100,00");
  console.log("Etapa concluída");
  steps.push("Três contas, incluindo mesmo banco, saldo e data de referência");
  await goto("/cartoes", "Cartões");
  await page.getByRole("button", { name: "Novo cartão", exact: true }).click();
  await fill("Nome", "Nubank QA");
  await chooseBank("Nubank");
  await fill("Limite (R$)", "5000,00");
  await fill("Últimos 4 dígitos", "4582");
  await select("Conta para pagamento da fatura", b);
  await save("cards");
  const card = (await read()).cards[0].id;
  await tx({
    name: "Salário QA",
    type: "RECEITA",
    amount: "4800,00",
    account: b,
  });
  await tx({
    name: "Mercado PIX QA",
    amount: "150,00",
    account: a,
    category: category.id,
  });
  await tx({
    name: "Débito QA",
    method: "DEBITO",
    amount: "89,90",
    account: a,
    category: category.id,
  });
  await tx({
    name: "Compra cartão QA",
    method: "CREDITO",
    amount: "100,00",
    card,
    category: category.id,
  });
  await tx({
    name: "Notebook QA",
    method: "CREDITO",
    amount: "3600,01",
    card,
    category: category.id,
    date: "2026-09-16",
    installments: 12,
  });
  await tx({
    name: "Transferência QA",
    type: "TRANSFERENCIA",
    amount: "500,00",
    account: b,
    destination: a,
  });
  let data = await read();
  expect(data.accounts.find((x) => x.id === a).balance).toBe(301053);
  expect(data.accounts.find((x) => x.id === b).balance).toBe(430000);
  expect(data.cards[0].used).toBe(370001);
  console.log("Etapa concluída");
  steps.push(
    "Receita, PIX, débito, crédito, 12 parcelas e transferência pelo formulário",
  );
  await goto("/transacoes", "Transações");
  await page.getByRole("button").filter({ hasText: "Mercado PIX QA" }).click();
  await fill("Valor (R$)", "130,00");
  await save("transactions");
  await page.getByRole("button").filter({ hasText: "Mercado PIX QA" }).click();
  await page
    .getByRole("button", { name: "Cancelar lançamento", exact: true })
    .click();
  const deletion = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" && r.url().includes("/transactions/"),
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  const dr = await deletion;
  expect(dr.ok(), await dr.text()).toBeTruthy();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await read()).transactions.find((x) => x.description === "Mercado PIX QA")
      .status,
  ).toBe("CANCELADA");
  await page.getByRole("button", { name: "Mais filtros" }).click();
  await page.getByLabel("Situação", { exact: true }).selectOption("CANCELADA");
  await expect(
    page.getByRole("button").filter({ hasText: "Mercado PIX QA" }),
  ).toBeVisible();
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption("PIX");
  console.log("Etapa concluída");
  steps.push("Edição, cancelamento e filtros");
  await tx({
    name: "Internet QA",
    amount: "119,90",
    account: a,
    category: category.id,
    status: "PENDENTE",
  });
  await tx({
    name: "Freelance QA",
    type: "RECEITA",
    amount: "1000,00",
    account: b,
    status: "PENDENTE",
  });
  for (const name of ["Internet QA", "Freelance QA"]) {
    await goto("/transacoes", "Transações");
    await page.getByRole("button").filter({ hasText: name }).click();
    await page
      .getByRole("button", { name: "Confirmar lançamento", exact: true })
      .click();
    await select("Conta utilizada", b);
    await fill("Data da confirmação", "2026-09-22");
    await save("transactions", "Confirmar");
  }
  await tx({
    name: "Assinatura QA",
    amount: "39,90",
    account: a,
    category: category.id,
    date: "2026-09-25",
    repeat: "MENSAL",
  });
  console.log("Etapa concluída");
  steps.push(
    "Contas a pagar/receber liquidadas com conta/data e recorrência inicial",
  );
  await goto("/faturas", "Faturas");
  await page.getByRole("button", { name: "Pagar fatura", exact: true }).click();
  await fill("Valor do pagamento (R$)", "50,00");
  await save("invoices");
  data = await read();
  expect(data.invoices.find((x) => x.competence === "2026-09").remaining).toBe(
    5000,
  );
  expect(data.analytics.summary.expenses).toBe(30980);
  await page
    .getByRole("button", { name: "Ver lançamentos", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Pagamento fatura Nubank QA",
      exact: true,
    }),
  ).toBeVisible();
  const nextMonth = page.waitForResponse((r) =>
    r.url().includes("/overview?month=2026-10"),
  );
  await page.getByRole("button", { name: "Próximo mês", exact: true }).click();
  expect((await nextMonth).ok()).toBeTruthy();
  await expect(page.getByText("Fatura de 10/2026")).toBeVisible();
  await page
    .getByRole("button", { name: "Ver lançamentos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Notebook QA 1/12", exact: true }),
  ).toBeVisible();
  console.log("Etapa concluída");
  steps.push(
    "Pagamento parcial sem duplicação e seletor de competência com parcelas futuras",
  );
  const before = (await read()).transactions.length;
  await page.reload();
  expect((await read()).transactions.length).toBe(before);
  const state = await context.storageState();
  await context.close();
  context = await browser.newContext({
    storageState: state,
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  listen();
  await goto("/", "");
  expect((await read()).transactions.length).toBe(before);
  console.log("Etapa concluída");
  steps.push("Persistência após recarregar e reabrir contexto de navegador");
  for (const [path, title] of [
    ["/transacoes", "Transações"],
    ["/contas", "Contas"],
    ["/cartoes", "Cartões"],
    ["/faturas", "Faturas"],
    ["/planejamento", "Planejamento"],
    ["/calendario", "Calendário"],
    ["/relatorios", "Relatórios"],
    ["/categorias", "Categorias"],
    ["/configuracoes", "Configurações"],
  ]) {
    await goto(path, title);
    await page.screenshot({
      path: "docs/screenshots/qa-" + path.slice(1) + ".png",
      fullPage: true,
    });
  }
  await goto("/", "");
  await expect(page.locator(".desktop-dashboard h1")).toBeVisible();
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.screenshot({
      path: "docs/screenshots/qa-dashboard-" + width + ".png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "Transação", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/qa-mobile-form.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Fechar", exact: true })
    .last()
    .click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Claro", exact: true }).click();
  await page.screenshot({
    path: "docs/screenshots/qa-dashboard-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(requests.filter((u) => /supabase\.(co|com)/.test(u))).toEqual([]);
  console.log("Etapa concluída");
  steps.push(
    "Nove páginas, sete larguras, temas claro/escuro, formulário mobile e console sem erros",
  );
  await writeFile(
    "docs/browser-qa.json",
    JSON.stringify(
      {
        passed: true,
        at: new Date().toISOString(),
        steps,
        errors,
        financialSource: "Fastify/Prisma/Supabase",
        testHouseholdRemoved: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, steps, errors }));
} catch (e) {
  await page
    .screenshot({ path: "docs/screenshots/qa-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
  for (const [model, where] of [
    ["invoicePayment", { transaction: { householdId: h } }],
    ["installment", { transaction: { householdId: h } }],
    ["transfer", { transaction: { householdId: h } }],
    ["transaction", { householdId: h }],
    ["installmentPurchase", { card: { householdId: h } }],
    ["invoice", { card: { householdId: h } }],
    ["creditCard", { householdId: h }],
    ["recurringTransaction", { householdId: h }],
    ["account", { householdId: h }],
    ["subcategory", { category: { householdId: h } }],
    ["category", { householdId: h }],
    ["tag", { householdId: h }],
    ["user", { householdId: h }],
    ["household", { id: h }],
  ])
    await db[model].deleteMany({ where });
  await db.$disconnect();
}
