import { z } from "zod";
export const person = z.enum(["Fábio", "Bianca", "Casa"]);
export const cents = z.number().int().min(1).max(1000000000);
export const paymentMethod = z.enum([
  "PIX",
  "DEBITO",
  "CREDITO",
  "DINHEIRO",
  "BOLETO",
  "TRANSFERENCIA",
  "OUTRO",
]);
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida");
const optId = z.string().min(1).nullable().default(null);
export const transactionInput = z
  .object({
    description: z.string().trim().min(2).max(160),
    amount: cents,
    date: day,
    type: z.enum(["RECEITA", "DESPESA", "TRANSFERENCIA"]),
    paymentMethod: paymentMethod.default("OUTRO"),
    status: z.enum(["CONFIRMADA", "PENDENTE"]).default("CONFIRMADA"),
    owner: person,
    accountId: optId,
    destinationAccountId: optId,
    cardId: optId,
    categoryId: optId,
    subcategoryId: optId,
    notes: z.string().max(3000).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    installments: z.number().int().min(1).max(120).default(1),
  })
  .strict()
  .superRefine((v, c) => {
    const issue = (message: string) => c.addIssue({ code: "custom", message });
    if (v.type === "TRANSFERENCIA") {
      if (
        !v.accountId ||
        !v.destinationAccountId ||
        v.accountId === v.destinationAccountId ||
        v.cardId
      )
        issue("Selecione duas contas diferentes para a transferência.");
    } else {
      if (Number(!!v.accountId) + Number(!!v.cardId) !== 1)
        issue("Escolha uma conta ou um cartão.");
      if (v.destinationAccountId)
        issue("Conta de destino só é permitida em transferências.");
    }
    if (v.type === "DESPESA" && !v.categoryId)
      issue("Selecione a categoria da despesa.");
    if (v.cardId && (v.type !== "DESPESA" || v.paymentMethod !== "CREDITO"))
      issue("Selecione Crédito para utilizar um cartão.");
    if (v.paymentMethod === "CREDITO" && (!v.cardId || v.type !== "DESPESA"))
      issue("Compra no crédito exige um cartão.");
    if (v.installments > 1 && (!v.cardId || v.amount < v.installments))
      issue("Parcelamentos exigem cartão e pelo menos um centavo por parcela.");
    if (v.subcategoryId && !v.categoryId)
      issue("Informe a categoria da subcategoria.");
  });
export type TransactionInput = z.infer<typeof transactionInput>;
export const accountInput = z
  .object({
    bankId: z.string().min(1),
    name: z.string().trim().min(2).max(80),
    owner: person,
    type: z.enum([
      "Corrente",
      "Poupança",
      "Carteira",
      "Dinheiro",
      "Digital",
      "Investimento",
    ]),
    initialBalance: z.number().int().min(-1000000000).max(1000000000),
    openingDate: day,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#4389ff"),
    notes: z.string().max(1500).default(""),
    active: z.boolean().default(true),
  })
  .strict();
export const cardInput = z
  .object({
    bankId: z.string().min(1),
    name: z.string().trim().min(2).max(80),
    owner: person,
    brand: z
      .enum(["Mastercard", "Visa", "Elo", "American Express"])
      .default("Mastercard"),
    last4: z
      .string()
      .regex(/^(\d{4})?$/, "Informe somente os últimos quatro dígitos.")
      .default(""),
    limit: cents,
    closingDay: z.number().int().min(1).max(31),
    dueDay: z.number().int().min(1).max(31),
    paymentAccountId: optId,
    color: z
      .string()
      .regex(/^(#[0-9a-fA-F]{6}|linear-gradient\([a-zA-Z0-9#%,. ()-]+\))$/),
    active: z.boolean().default(true),
  })
  .strict();
export const categoryInput = z
  .object({
    name: z.string().trim().min(2).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z.enum(["home", "food", "car", "receipt", "music", "wallet"]),
  })
  .strict();
export const recurrenceInput = z
  .object({
    transaction: transactionInput,
    frequency: z.enum(["MENSAL", "SEMANAL", "ANUAL", "PERSONALIZADA"]),
    interval: z.number().int().min(1).max(365).default(1),
    nextDate: day,
  })
  .strict()
  .refine(
    (v) => v.transaction.installments === 1,
    "Recorrências não podem gerar parcelamentos.",
  );
export const settlementInput = z
  .object({ date: day, accountId: z.string().min(1).optional() })
  .strict();
