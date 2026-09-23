import { createClient } from "@supabase/supabase-js";
import { config, MAX_FILE_BYTES, MIME_TYPES, IntegrationError } from "./config";
import type { PrivateAttachmentStorage } from "../../storage";
export type Keyboard = { text: string; callback_data: string }[][];
export interface TelegramGateway {
  me(): Promise<{ username: string }>;
  send(chatId: string, text: string, keyboard?: Keyboard): Promise<void>;
  answer(callbackId: string): Promise<void>;
  download(fileId: string): Promise<Uint8Array>;
}
export class TelegramAPI implements TelegramGateway {
  async call<T>(
    method: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      const response = await fetch(
        "https://api.telegram.org/bot" + config().botToken + "/" + method,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(20000),
        },
      );
      const body = (await response.json()) as { ok: boolean; result: T };
      if (!response.ok || !body.ok) throw new Error();
      return body.result;
    } catch {
      throw new IntegrationError(
        "TELEGRAM_FAILED",
        "Telegram indisponível temporariamente.",
        true,
      );
    }
  }
  me() {
    return this.call<{ username: string }>("getMe");
  }
  async send(chatId: string, text: string, keyboard?: Keyboard) {
    await this.call("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }
  async answer(callbackId: string) {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId });
  }
  async download(fileId: string) {
    const file = await this.call<{ file_path?: string; file_size?: number }>(
      "getFile",
      { file_id: fileId },
    );
    if ((file.file_size || 0) > MAX_FILE_BYTES)
      throw new IntegrationError("FILE_SIZE", "Envie um arquivo de até 10 MB.");
    if (
      !file.file_path ||
      !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) ||
      file.file_path.includes("..")
    )
      throw new IntegrationError("FILE_PATH", "Arquivo indisponível.");
    try {
      const response = await fetch(
        "https://api.telegram.org/file/bot" +
          config().botToken +
          "/" +
          file.file_path,
        { signal: AbortSignal.timeout(30000), redirect: "error" },
      );
      if (!response.ok || !response.body) throw new Error();
      if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES)
        throw new IntegrationError(
          "FILE_SIZE",
          "Envie um arquivo de até 10 MB.",
        );
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_FILE_BYTES)
            throw new IntegrationError(
              "FILE_SIZE",
              "Envie um arquivo de até 10 MB.",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      throw new IntegrationError(
        "DOWNLOAD_FAILED",
        "Não consegui baixar o arquivo. Tente novamente.",
        true,
      );
    }
  }
}
export class SupabaseAttachmentStorage implements PrivateAttachmentStorage {
  private client() {
    const c = config();
    return createClient(c.storageUrl, c.storageKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
      },
    });
  }
  async ensurePrivateBucket() {
    const client = this.client(),
      bucket = config().bucket;
    let { data, error } = await client.storage.getBucket(bucket);
    if (
      error &&
      (String(error.status) === "404" ||
        ("statusCode" in error && String(error.statusCode) === "404"))
    ) {
      const result = await client.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: MAX_FILE_BYTES,
        allowedMimeTypes: MIME_TYPES,
      });
      if (result.error)
        throw new IntegrationError(
          "STORAGE_CONFIG",
          "Armazenamento indisponível.",
          true,
        );
      ({ data, error } = await client.storage.getBucket(bucket));
    }
    if (error || !data || data.public)
      throw new IntegrationError(
        "STORAGE_PRIVATE",
        "O armazenamento privado precisa ser configurado.",
      );
  }
  async upload(path: string, content: Uint8Array, mime: string) {
    await this.ensurePrivateBucket();
    const { error } = await this.client()
      .storage.from(config().bucket)
      .upload(path, content, { contentType: mime, upsert: true });
    if (error)
      throw new IntegrationError(
        "STORAGE_UPLOAD",
        "Não consegui guardar o comprovante.",
        true,
      );
  }
  async signedDownloadUrl(path: string, expires = 300) {
    await this.ensurePrivateBucket();
    const { data, error } = await this.client()
      .storage.from(config().bucket)
      .createSignedUrl(path, Math.min(expires, 300));
    if (error || !data)
      throw new IntegrationError(
        "STORAGE_DOWNLOAD",
        "Comprovante indisponível.",
      );
    return data.signedUrl;
  }
  async remove(path: string) {
    const { error } = await this.client()
      .storage.from(config().bucket)
      .remove([path]);
    if (error)
      throw new IntegrationError(
        "STORAGE_REMOVE",
        "Não foi possível remover o comprovante.",
        true,
      );
  }
}
