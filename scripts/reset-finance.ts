import "dotenv/config";
import { prisma } from "../apps/api/src/db";

/**
 * Zera os lançamentos para recomeçar do zero.
 *
 *   pnpm db:zerar                         → só mostra o que seria apagado (nada muda)
 *   pnpm db:zerar --confirmar ZERAR       → apaga lançamentos, faturas, parcelas, sugestões,
 *                                           importações, recorrências, metas e análises
 *   pnpm db:zerar --confirmar ZERAR --tudo → também apaga contas e cartões
 *
 * Mantém sempre: usuários e senhas, Telegram conectado, categorias e limites do orçamento.
 * Arquivos de comprovante já enviados ao Storage não são removidos (expiram pela limpeza).
 */
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const confirmed = arg("--confirmar") === "ZERAR";
const everything = args.includes("--tudo");
const householdId =
  arg("--household") ||
  (await prisma.household.findMany({ where: { mode: "REAL" } })).map(
    (h) => h.id,
  )[0];
const realCount = await prisma.household.count({ where: { mode: "REAL" } });
if (!householdId) throw new Error("Nenhum núcleo REAL encontrado.");
if (!arg("--household") && realCount > 1)
  throw new Error("Há mais de um núcleo REAL. Informe --household <id>.");

const h = householdId;
const byTx = { transaction: { householdId: h } };
const counts = {
  lançamentos: await prisma.transaction.count({ where: { householdId: h } }),
  faturas: await prisma.invoice.count({ where: { card: { householdId: h } } }),
  parcelamentos: await prisma.installmentPurchase.count({
    where: { card: { householdId: h } },
  }),
  recorrências: await prisma.recurringTransaction.count({
    where: { householdId: h },
  }),
  "sugestões do Telegram": await prisma.transactionSuggestion.count({
    where: { householdId: h },
  }),
  "importações de fatura": await prisma.externalImport.count({
    where: { householdId: h },
  }),
  metas: await prisma.financialGoal.count({ where: { householdId: h } }),
  ...(everything
    ? {
        contas: await prisma.account.count({ where: { householdId: h } }),
        cartões: await prisma.creditCard.count({ where: { householdId: h } }),
      }
    : {}),
};
console.log("Núcleo: " + h);
for (const [k, v] of Object.entries(counts)) console.log("  " + k + ": " + v);
if (!confirmed) {
  console.log(
    "\nNada foi apagado. Para zerar, rode de novo com: --confirmar ZERAR" +
      (everything
        ? " --tudo"
        : "  (adicione --tudo para apagar contas e cartões)"),
  );
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(
  async (tx) => {
    await tx.attachment.updateMany({
      where: { householdId: h },
      data: { transactionId: null },
    });
    await tx.invoicePayment.deleteMany({ where: byTx });
    await tx.installment.deleteMany({ where: byTx });
    await tx.transfer.deleteMany({ where: byTx });
    await tx.transaction.deleteMany({ where: { householdId: h } });
    await tx.installmentPurchase.deleteMany({
      where: { card: { householdId: h } },
    });
    await tx.invoice.deleteMany({ where: { card: { householdId: h } } });
    await tx.recurringTransaction.deleteMany({ where: { householdId: h } });
    await tx.telegramCallback.deleteMany({
      where: { suggestion: { householdId: h } },
    });
    await tx.transactionSuggestion.deleteMany({ where: { householdId: h } });
    await tx.attachment.deleteMany({ where: { householdId: h } });
    await tx.externalImport.deleteMany({ where: { householdId: h } });
    await tx.tag.deleteMany({ where: { householdId: h } });
    await tx.goalContribution.deleteMany({ where: { householdId: h } });
    await tx.monthlyGoal.deleteMany({ where: { householdId: h } });
    await tx.cofluPlanItem.deleteMany({ where: { householdId: h } });
    await tx.financialGoal.deleteMany({ where: { householdId: h } });
    await tx.financialRecommendationDecision.deleteMany({
      where: { householdId: h },
    });
    await tx.monthlyFinancialReview.deleteMany({ where: { householdId: h } });
    await tx.financialCoachAnalysis.deleteMany({ where: { householdId: h } });
    if (everything) {
      await tx.creditCard.deleteMany({ where: { householdId: h } });
      await tx.account.deleteMany({ where: { householdId: h } });
    }
  },
  { timeout: 120000 },
);
console.log(
  "\nPronto. " +
    (everything
      ? "Cadastre contas e cartões de novo no app."
      : "Contas e cartões foram mantidos sem movimentações: ajuste o saldo inicial de cada conta para hoje no app.") +
    " Categorias e limites do orçamento continuam lá.",
);
await prisma.$disconnect();
