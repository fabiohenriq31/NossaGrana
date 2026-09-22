import type { Overview } from "../../../../packages/shared/src/types";
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(body.message || "Não foi possível concluir. Tente novamente."),
      { status: res.status },
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const fetchOverview = (month: string, signal?: AbortSignal) =>
  api<Overview>("/overview?month=" + encodeURIComponent(month), { signal });
