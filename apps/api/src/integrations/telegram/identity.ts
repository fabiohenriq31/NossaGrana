import { z } from "zod";
import { prisma, atomic } from "../../db";
import { hash, opaqueToken, safeText, IntegrationError } from "./config";
const numericId = z.number().int().safe().positive();
const sender = z.object({
  id: numericId,
  username: z.string().max(100).optional(),
  is_bot: z.boolean().optional(),
});
const file = z.object({
  file_id: z.string().max(300),
  file_size: z.number().int().nonnegative().optional(),
});
const message = z.object({
  message_id: numericId,
  date: z.number().int().nonnegative().max(253402300799).optional(),
  from: sender.optional(),
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  text: z.string().max(4096).optional(),
  caption: z.string().max(1024).optional(),
  photo: z.array(file).max(10).optional(),
  document: file.extend({ mime_type: z.string().optional() }).optional(),
});
const update = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: message.optional(),
  callback_query: z
    .object({
      id: z.string().max(200),
      from: sender,
      data: z.string().max(64).optional(),
      message: message.optional(),
    })
    .optional(),
});
export interface Event {
  id: string;
  senderId: string;
  chatId: string;
  username?: string;
  kind: "start" | "document" | "callback" | "text";
  linkHash?: string;
  fileId?: string;
  fileSize?: number;
  mime?: string;
  caption?: string;
  callbackId?: string;
  token?: string;
  text?: string;
  referenceDate?: string;
}
export function normalizeUpdate(body: unknown): Event | null {
  const parsed = update.safeParse(body);
  if (!parsed.success) return null;
  const u = parsed.data,
    m = u.callback_query?.message || u.message;
  const from = u.callback_query?.from || m?.from;
  if (
    !m ||
    !from ||
    from.is_bot ||
    m.chat.type !== "private" ||
    m.chat.id !== from.id
  )
    return null;
  const base = {
    id: String(u.update_id),
    senderId: String(from.id),
    chatId: String(m.chat.id),
    username: from.username,
  };
  if (u.callback_query)
    return {
      ...base,
      kind: "callback",
      callbackId: u.callback_query.id,
      token: u.callback_query.data || "",
    };
  if (m.text?.startsWith("/start")) {
    const match = /^\/start(?:\s+([A-Za-z0-9_-]{32}))?$/.exec(m.text.trim());
    return {
      ...base,
      kind: "start",
      ...(match?.[1] ? { linkHash: hash(match[1]) } : {}),
    };
  }
  const f = m.document || m.photo?.at(-1);
  if (f)
    return {
      ...base,
      kind: "document",
      fileId: f.file_id,
      fileSize: f.file_size,
      mime: m.document?.mime_type || (m.photo ? "image/jpeg" : ""),
      caption: safeText(m.caption || "", 1000) || "",
    };
  const receivedAt = m.date ? new Date(m.date * 1000) : new Date();
  return {
    ...base,
    kind: "text",
    text: safeText(m.text || "", 4096) || "",
    referenceDate: receivedAt.toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    }),
  };
}
export async function identity(senderId: string) {
  return prisma.telegramIdentity.findFirst({
    where: {
      telegramUserId: senderId,
      verified: true,
      user: { household: { mode: process.env.APP_MODE || "REAL" } },
    },
    include: { user: true },
  });
}
export async function createLink(userId: string) {
  const token = opaqueToken(),
    expiresAt = new Date(Date.now() + 10 * 60000);
  await atomic(async (tx) => {
    await tx.telegramLinkToken.deleteMany({ where: { userId } });
    await tx.telegramLinkToken.create({
      data: { userId, tokenHash: hash(token), expiresAt },
    });
  });
  return { token, expiresAt };
}
export async function consumeLink(event: Event) {
  if (!event.linkHash) return null;
  return atomic(async (tx) => {
    const link = await tx.telegramLinkToken.findUnique({
      where: { tokenHash: event.linkHash },
      include: { user: { include: { household: true } } },
    });
    if (
      !link ||
      link.consumedAt ||
      link.expiresAt <= new Date() ||
      link.user.household.mode !== (process.env.APP_MODE || "REAL")
    )
      throw new IntegrationError(
        "LINK_INVALID",
        "O link expirou ou já foi usado. Gere outro nas Configurações.",
      );
    const existing = await tx.telegramIdentity.findUnique({
      where: { telegramUserId: event.senderId },
    });
    if (existing && existing.userId !== link.userId)
      throw new IntegrationError(
        "LINK_CONFLICT",
        "Este Telegram já está conectado a outra conta.",
      );
    const claimed = await tx.telegramLinkToken.updateMany({
      where: {
        tokenHash: event.linkHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (!claimed.count)
      throw new IntegrationError(
        "LINK_USED",
        "Gere um novo link nas Configurações.",
      );
    return tx.telegramIdentity.upsert({
      where: { userId: link.userId },
      create: {
        userId: link.userId,
        telegramUserId: event.senderId,
        telegramChatId: event.chatId,
        telegramUsername: event.username,
      },
      update: {
        telegramUserId: event.senderId,
        telegramChatId: event.chatId,
        telegramUsername: event.username,
        verified: true,
        editSuggestionId: null,
        editField: null,
        editExpiresAt: null,
      },
      include: { user: true },
    });
  });
}
export async function unlink(userId: string) {
  await atomic(async (tx) => {
    await tx.telegramIdentity.deleteMany({ where: { userId } });
    await tx.telegramLinkToken.deleteMany({ where: { userId } });
    await tx.telegramCallback.deleteMany({ where: { suggestion: { userId } } });
  });
}
