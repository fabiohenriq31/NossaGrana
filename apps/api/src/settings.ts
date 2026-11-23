import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Configurações do sistema editáveis no painel administrativo, sem mexer no código.
 * Ficam numa única linha de AppSetting ("app"); o que não estiver salvo usa o padrão abaixo.
 */
export const featureKeys = [
  "telegramText",
  "telegramReceipt",
  "statementImport",
  "financialHealth",
  "coach",
  "reports",
  "planning",
] as const;
export type FeatureKey = (typeof featureKeys)[number];
export const featureLabels: Record<FeatureKey, string> = {
  telegramText: "Lançar gastos por texto no Telegram",
  telegramReceipt: "Ler comprovantes (PIX, boleto, recibo)",
  statementImport: "Importar fatura do cartão por print ou PDF",
  financialHealth: "Saúde financeira, metas e plano",
  coach: "Análise do mês com IA",
  reports: "Relatórios",
  planning: "Planejamento e calendário",
};
/** Usos de IA que gastam crédito. */
export const usageKinds = ["text", "receipt", "statement", "coach"] as const;
export type UsageKind = (typeof usageKinds)[number];

const planSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,19}$/, "Código do plano: letras maiúsculas."),
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(200).default(""),
    priceCents: z.number().int().min(0).max(1000000),
    monthlyCredits: z.number().int().min(0).max(100000),
    unlimited: z.boolean().default(false),
    features: z.array(z.enum(featureKeys)),
    active: z.boolean().default(true),
    highlight: z.boolean().default(false),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
const packSchema = z
  .object({
    id: z.string().trim().min(1).max(20),
    credits: z.number().int().min(1).max(100000),
    priceCents: z.number().int().min(0).max(1000000),
    active: z.boolean().default(true),
  })
  .strict();
const message = z.string().trim().max(300);

export const settingsSchema = z
  .object({
    signupEnabled: z.boolean(),
    invitesEnabled: z.boolean(),
    maintenance: z.object({ enabled: z.boolean(), message }).strict(),
    banner: z
      .object({
        enabled: z.boolean(),
        message,
        tone: z.enum(["info", "warning", "success"]),
      })
      .strict(),
    aiEnabled: z.boolean(),
    telegramQuickLaunch: z.boolean(),
    signupBonusCredits: z.number().int().min(0).max(1000),
    lowCreditWarning: z.number().int().min(0).max(1000),
    maxMembers: z.number().int().min(1).max(10),
    creditCosts: z
      .object({
        text: z.number().int().min(0).max(100),
        receipt: z.number().int().min(0).max(100),
        statement: z.number().int().min(0).max(100),
        coach: z.number().int().min(0).max(100),
      })
      .strict(),
    plans: z
      .array(planSchema)
      .min(1)
      .max(8)
      .refine((p) => p.some((x) => x.id === "FREE"), {
        message: "O plano FREE (gratuito) é obrigatório.",
      })
      .refine((p) => new Set(p.map((x) => x.id)).size === p.length, {
        message: "Códigos de plano repetidos.",
      }),
    creditPacks: z.array(packSchema).max(8),
    upgrade: z
      .object({
        contactUrl: z.union([z.literal(""), z.string().url().max(300)]),
        message,
      })
      .strict(),
  })
  .strict();
export type AppSettings = z.infer<typeof settingsSchema>;

export const defaultSettings: AppSettings = {
  signupEnabled: true,
  invitesEnabled: true,
  maintenance: {
    enabled: false,
    message: "O Coflu está em manutenção. Volte em alguns minutos.",
  },
  banner: { enabled: false, message: "", tone: "info" },
  aiEnabled: true,
  telegramQuickLaunch: true,
  signupBonusCredits: 5,
  lowCreditWarning: 3,
  maxMembers: 2,
  creditCosts: { text: 1, receipt: 2, statement: 5, coach: 3 },
  plans: [
    {
      id: "FREE",
      name: "Grátis",
      description:
        "Orçamento do casal e créditos de boas-vindas para testar a IA.",
      priceCents: 0,
      monthlyCredits: 0,
      unlimited: false,
      features: ["telegramText", "telegramReceipt", "statementImport"],
      active: true,
      highlight: false,
    },
    {
      id: "ESSENCIAL",
      name: "Essencial",
      description: "Para lançar tudo pelo Telegram no dia a dia.",
      priceCents: 1490,
      monthlyCredits: 100,
      unlimited: false,
      features: [
        "telegramText",
        "telegramReceipt",
        "statementImport",
        "reports",
        "planning",
      ],
      active: true,
      highlight: false,
    },
    {
      id: "COMPLETO",
      name: "Completo",
      description: "Tudo do Essencial, saúde financeira e análise com IA.",
      priceCents: 2490,
      monthlyCredits: 300,
      unlimited: false,
      features: [...featureKeys],
      active: true,
      highlight: true,
    },
  ],
  creditPacks: [
    { id: "P20", credits: 20, priceCents: 490, active: true },
    { id: "P60", credits: 60, priceCents: 1290, active: true },
    { id: "P150", credits: 150, priceCents: 2490, active: true },
  ],
  upgrade: {
    contactUrl: "",
    message:
      "O pagamento online chega em breve. Por enquanto, fale com a gente para assinar ou comprar créditos.",
  },
};

const KEY = "app";
let cache: { value: AppSettings; at: number } | null = null;

/** Mescla o que está salvo com os padrões (campos novos aparecem sem migração). */
function merge(saved: unknown): AppSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<
    string,
    unknown
  >;
  const nested = (k: keyof AppSettings) => ({
    ...(defaultSettings[k] as object),
    ...((s[k] as object) || {}),
  });
  const result = settingsSchema.safeParse({
    ...defaultSettings,
    ...s,
    maintenance: nested("maintenance"),
    banner: nested("banner"),
    creditCosts: nested("creditCosts"),
    upgrade: nested("upgrade"),
  });
  return result.success ? result.data : defaultSettings;
}

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 10000) return cache.value;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = merge(row?.value);
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(
  next: AppSettings,
  updatedById: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const value = settingsSchema.parse(next);
  await db.appSetting.upsert({
    where: { key: KEY },
    create: {
      key: KEY,
      value: value as Prisma.InputJsonValue,
      updatedById,
    },
    update: { value: value as Prisma.InputJsonValue, updatedById },
  });
  cache = null;
  return value;
}

export function clearSettingsCache() {
  cache = null;
}
