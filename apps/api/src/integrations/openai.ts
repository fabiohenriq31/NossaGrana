import OpenAI from "openai";

// Cliente e modelo compartilhados pela extração e pela análise financeira opcional.
export const financeModel = () =>
  process.env.OPENAI_FINANCE_MODEL || "gpt-4.1-mini";
export const createFinanceClient = () =>
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000,
    maxRetries: 1,
  });
