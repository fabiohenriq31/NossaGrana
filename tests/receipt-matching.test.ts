import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  matchExtraction,
  saveSuggestion,
} from "../apps/api/src/integrations/telegram/suggestions";
import {
  extractionSchema,
  type Extraction,
} from "../apps/api/src/integrations/telegram/analyzer";
import { prisma } from "../apps/api/src/db";

const extraction = extractionSchema.parse({
  documentType: "PIX",
  transactionType: "EXPENSE",
  description: "Compra teste",
  amount: "10.00",
  currency: "BRL",
  transactionDate: "2026-09-23",
  transactionTime: null,
  paymentMethod: "PIX",
  bankName: "BANCO SANTANDER S.A.",
  cardLast4: null,
  payerName: "FABIO HENRIQUE SILVA",
  recipientName: "Loja teste",
  merchantName: "Loja teste",
  pixKey: null,
  transactionIdentifier: null,
  categorySuggestion: "Pagamento",
  subcategorySuggestion: null,
  installments: 1,
  currentInstallment: null,
  totalInstallments: 1,
  amountMeaning: "TOTAL",
  confidence: 0.95,
  needsReview: false,
  uncertainFields: [],
  notes: null,
});
const choices = () => ({
  accounts: [
    { id: "fabio", owner: "Fábio", bank: { name: "Santander" } },
    { id: "bianca", owner: "Bianca", bank: { name: "Santander" } },
  ],
  cards: [
    { id: "card", owner: "Fábio", last4: "4582", bank: { name: "Santander" } },
  ],
  categories: [
    {
      id: "outros",
      name: "Outros",
      subcategories: [{ id: "generic-sub", name: "Diversos" }],
    },
    { id: "mercado", name: "Mercado", subcategories: [] },
  ],
  users: [{ name: "Fábio" }, { name: "Bianca" }],
});
const match = (patch: Partial<Extraction> = {}) =>
  matchExtraction({ ...extraction, ...patch }, choices());
test("comprovante De: nome completo e razão social identificam Santander Fábio", () => {
  assert.equal(match().suggestedAccountId, "fabio");
  assert.equal(match().suggestedOwner, "Fábio");
});
test("PIX recebido usa titular destinatário, não o pagador", () => {
  assert.equal(
    match({
      transactionType: "INCOME",
      payerName: "Cliente",
      recipientName: "BIANCA SILVA",
    }).suggestedAccountId,
    "bianca",
  );
});
test("titular diferente não usa a conta da pessoa que enviou a foto", () => {
  assert.equal(
    match({ payerName: "BIANCA SILVA" }).suggestedAccountId,
    "bianca",
  );
  assert.equal(match({ payerName: "Roberto Silva" }).suggestedAccountId, null);
});
test("nome ausente e duas contas no banco continuam exigindo escolha", () => {
  assert.equal(match({ payerName: null }).suggestedAccountId, null);
});
test("duas contas do mesmo banco e mesmo titular continuam ambíguas", () => {
  const c = choices();
  c.accounts.push({ ...c.accounts[0], id: "segunda" });
  assert.equal(matchExtraction(extraction, c).suggestedAccountId, null);
});
test("nome não corresponde por substring dentro de outra palavra", () => {
  assert.equal(match({ payerName: "Fabiano Silva" }).suggestedAccountId, null);
});
test("nomes completos divergentes não correspondem somente pelo primeiro nome", () => {
  const c = choices();
  c.accounts[0].owner = "Fábio Souza";
  assert.equal(matchExtraction(extraction, c).suggestedAccountId, null);
});
test("acentos, pontuação e espaços no banco são normalizados", () => {
  assert.equal(
    match({
      bankName: "  Banco   Santander S/A  ",
      payerName: " Fábio  Henrique Silva ",
    }).suggestedAccountId,
    "fabio",
  );
  assert.equal(match({ bankName: "Outro Banco" }).suggestedAccountId, null);
});
test("variação Nu Pagamentos identifica o Nubank sem banco arbitrário", () => {
  const c = choices();
  c.accounts[0].bank.name = "Nubank";
  assert.equal(
    matchExtraction(
      {
        ...extraction,
        bankName: "NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO",
      },
      c,
    ).suggestedAccountId,
    "fabio",
  );
});
test("cartão utiliza nome completo, banco normalizado e últimos quatro dígitos", () => {
  assert.equal(
    match({ paymentMethod: "CREDITO", cardLast4: "4582" })
      .suggestedCreditCardId,
    "card",
  );
  assert.equal(
    match({ paymentMethod: "CREDITO", cardLast4: "9999" })
      .suggestedCreditCardId,
    null,
  );
});
test("categoria desconhecida, vazia ou ausente utiliza Outros existente", () => {
  for (const categorySuggestion of ["Pagamento", "", null])
    assert.equal(match({ categorySuggestion }).suggestedCategoryId, "outros");
});
test("categoria reconhecida preservada e fallback não inventa subcategoria", () => {
  assert.equal(
    match({ categorySuggestion: "Mercado" }).suggestedCategoryId,
    "mercado",
  );
  assert.equal(
    match({ subcategorySuggestion: "Diversos" }).suggestedSubcategoryId,
    null,
  );
});
test("banco isolado: fallback Outros é criado uma vez e sem lançamento automático", async () => {
  const h = "matching-test-" + randomUUID();
  try {
    await prisma.household.create({ data: { id: h, name: "Matching QA" } });
    const user = await prisma.user.create({
      data: {
        householdId: h,
        name: "Fábio",
        email: h + "@example.test",
        passwordHash: "unused",
      },
    });
    const run = async (categorySuggestion: string | null) => {
      const id = randomUUID();
      const attachment = await prisma.attachment.create({
        data: {
          householdId: h,
          fileName: "test.png",
          mimeType: "image/png",
          storagePath: "test/" + id,
          source: "TELEGRAM",
        },
      });
      return saveSuggestion(user.id, h, attachment.id, id, {
        extraction: { ...extraction, categorySuggestion },
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    };
    const [a, b] = await Promise.all([
      run(null),
      run("Categoria não cadastrada"),
    ]);
    assert.equal(a.suggestedCategoryId, b.suggestedCategoryId);
    assert.equal(
      (
        await prisma.category.findUniqueOrThrow({
          where: { id: a.suggestedCategoryId! },
        })
      ).name,
      "Outros",
    );
    assert.equal(await prisma.category.count({ where: { householdId: h } }), 1);
    assert.equal(
      await prisma.transaction.count({ where: { householdId: h } }),
      0,
    );
    const c = await run("Outra inexistente");
    assert.equal(c.suggestedCategoryId, a.suggestedCategoryId);
  } finally {
    await prisma.transactionSuggestion.deleteMany({
      where: { householdId: h },
    });
    await prisma.attachment.deleteMany({ where: { householdId: h } });
    await prisma.category.deleteMany({ where: { householdId: h } });
    await prisma.user.deleteMany({ where: { householdId: h } });
    await prisma.household.deleteMany({ where: { id: h } });
    await prisma.$disconnect();
  }
});
