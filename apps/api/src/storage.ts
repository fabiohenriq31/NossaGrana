/** Contrato preparado para a futura integração, sem upload ou chaves públicas no frontend. */
export const attachmentStorage = {
  bucket: "financial-attachments",
  public: false,
  signedUrlMaxAgeSeconds: 300,
} as const;
export function attachmentPath(
  householdId: string,
  attachmentId: string,
  fileName: string,
) {
  const extension =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10) || "bin";
  return householdId + "/" + attachmentId + "." + extension;
}
export interface PrivateAttachmentStorage {
  upload(path: string, content: Uint8Array, mimeType: string): Promise<void>;
  signedDownloadUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}
