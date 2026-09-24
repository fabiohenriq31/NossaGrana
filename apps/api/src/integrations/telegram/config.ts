import { timingSafeEqual, createHash, randomBytes } from "node:crypto";
import { financeModel } from "../openai";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
export const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
export const opaqueToken = () => randomBytes(24).toString("base64url");
export function config() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    model: financeModel(),
    apiKey: process.env.OPENAI_API_KEY || "",
    storageUrl: process.env.SUPABASE_URL || "",
    storageKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "financial-attachments",
  };
}
export function configured() {
  const c = config();
  return Boolean(
    c.botToken &&
    c.webhookSecret.length >= 32 &&
    c.apiKey &&
    /^https:\/\/[^.]+\.supabase\.co$/.test(c.storageUrl) &&
    c.storageKey.length > 30,
  );
}
export function secretMatches(candidate: unknown, expected: string) {
  if (typeof candidate !== "string" || expected.length < 32) return false;
  const a = Buffer.from(candidate),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class IntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function validateFile(bytes: Uint8Array, declaredMime: string) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new IntegrationError("FILE_SIZE", "Envie um arquivo de até 10 MB.");
  const b = Buffer.from(bytes);
  const detected = b
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : b[0] === 255 && b[1] === 216 && b[2] === 255
      ? "image/jpeg"
      : b.subarray(0, 4).toString() === "RIFF" &&
          b.subarray(8, 12).toString() === "WEBP"
        ? "image/webp"
        : b.subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : null;
  if (!detected || detected !== declaredMime)
    throw new IntegrationError(
      "FILE_TYPE",
      "Formato inválido. Envie JPEG, PNG, WebP ou PDF.",
    );
  return detected;
}
export function safeText(value: string | null, max = 500): string | null {
  return (
    value
      ?.replace(/(?:\d[ -]?){13,19}/g, "[número protegido]")
      // eslint-disable-next-line no-control-regex -- remove controles do texto recebido
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
      .slice(0, max) || null
  );
}
