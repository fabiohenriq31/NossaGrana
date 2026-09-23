import "dotenv/config";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const prisma = new PrismaClient(),
  h = "tg-browser-" + randomUUID(),
  email = h + "@example.test",
  password = randomUUID();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "pt-BR",
});
const page = await context.newPage(),
  errors = [],
  failures = [],
  base = "http://127.0.0.1:5173";
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 500)
    failures.push({ status: r.status(), path: new URL(r.url()).pathname });
});
try {
  await prisma.household.create({
    data: { id: h, name: "Interface Telegram QA" },
  });
  const user = await prisma.user.create({
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
  await page.getByRole("button", { name: "Entrar na NossaGrana" }).click();
  await expect(page.locator(".desktop-dashboard h1")).toBeVisible();
  errors.length = 0;
  await page.goto(base + "/configuracoes");
  await expect(
    page.getByRole("heading", { name: "Configurações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conectar Telegram", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Conectar Telegram", exact: true })
    .click();
  const link = page.getByRole("link", { name: "Abrir Telegram e conectar" });
  await expect(link).toBeVisible();
  expect(
    (await link.getAttribute("href")).startsWith("https://t.me/"),
  ).toBeTruthy();
  expect(
    await prisma.telegramLinkToken.count({ where: { userId: user.id } }),
  ).toBe(1);
  expect(
    await prisma.telegramIdentity.count({ where: { userId: user.id } }),
  ).toBe(0);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/telegram-desktop-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("main")
    .getByRole("button", { name: "Claro", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass("light");
  await page.screenshot({
    path: "docs/screenshots/telegram-desktop-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/screenshots/telegram-mobile-light.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Escuro", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshots/telegram-mobile-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Atualizar conexão do Telegram" })
    .click();
  await expect(
    page.getByText("Seu Telegram ainda não está conectado.", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  const result = {
    passed: true,
    desktop: true,
    mobile: true,
    dark: true,
    light: true,
    linkGeneration: true,
    consoleErrors: errors,
    serverFailures: failures,
    realLinkConsumed: false,
  };
  await writeFile(
    "docs/telegram-browser-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await context.close();
  await browser.close();
  await prisma.user.deleteMany({ where: { householdId: h } });
  await prisma.household.deleteMany({ where: { id: h } });
  await prisma.$disconnect();
}
