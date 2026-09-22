import test from "node:test";
import assert from "node:assert/strict";
import {
  splitInstallments,
  invoiceDates,
  nextOccurrence,
  accountBalance,
  addMonths,
} from "../apps/api/src/domain";
import {
  transactionInput,
  cardInput,
  day,
} from "../packages/shared/src/validation";
test("centavos das parcelas conservam o total", () => {
  assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333]);
  assert.equal(
    splitInstallments(180000, 6).reduce((a, b) => a + b, 0),
    180000,
  );
});
test("fechamento inclui o próprio dia; compra posterior vai à próxima fatura", () => {
  assert.equal(
    invoiceDates(new Date("2026-09-15T12:00Z"), 15, 22).competence,
    "2026-09",
  );
  assert.equal(
    invoiceDates(new Date("2026-09-16T12:00Z"), 15, 22).competence,
    "2026-10",
  );
  assert.equal(
    invoiceDates(new Date("2026-12-31T12:00Z"), 20, 5)
      .dueDate.toISOString()
      .slice(0, 10),
    "2027-02-05",
  );
});
test("parcelas e recorrências preservam o dia âncora em fevereiro", () => {
  const jan = new Date("2026-01-31T12:00Z");
  assert.equal(addMonths(jan, 1).toISOString().slice(0, 10), "2026-02-28");
  const feb = nextOccurrence(jan, "MENSAL", 1, 31, 0);
  assert.equal(
    nextOccurrence(feb, "MENSAL", 1, 31, 0).toISOString().slice(0, 10),
    "2026-03-31",
  );
  const leap = new Date("2024-02-29T12:00Z");
  assert.equal(
    nextOccurrence(leap, "ANUAL", 1, 29, 1).toISOString().slice(0, 10),
    "2025-02-28",
  );
});
test("transferência conserva patrimônio e saldo ignora pendentes/cartão", () => {
  const t = {
    amount: 50000,
    status: "CONFIRMADA",
    type: "TRANSFERENCIA",
    cardId: null,
    accountId: "a",
    destinationAccountId: "b",
  };
  assert.equal(accountBalance(100000, "a", [t]), 50000);
  assert.equal(accountBalance(20000, "b", [t]), 70000);
  assert.equal(
    accountBalance(100000, "a", [{ ...t, status: "PENDENTE" }]),
    100000,
  );
  assert.equal(
    accountBalance(100000, "a", [{ ...t, type: "DESPESA", cardId: "card" }]),
    100000,
  );
});
test("validação rejeita dinheiro fracionado, data impossível, CVV e transferência para si", () => {
  assert.equal(day.safeParse("2026-02-30").success, false);
  const t = {
    description: "Teste",
    amount: 100,
    date: "2026-01-01",
    type: "TRANSFERENCIA",
    owner: "Fábio",
    accountId: "a",
    destinationAccountId: "a",
  };
  assert.equal(transactionInput.safeParse(t).success, false);
  assert.equal(
    transactionInput.safeParse({ ...t, amount: 1.1, destinationAccountId: "b" })
      .success,
    false,
  );
  assert.equal(
    cardInput.safeParse({
      bankId: "nu",
      name: "Nubank",
      owner: "Fábio",
      brand: "Visa",
      last4: "1234",
      limit: 10000,
      closingDay: 15,
      dueDay: 22,
      color: "#112233",
      cvv: "123",
    }).success,
    false,
  );
});
