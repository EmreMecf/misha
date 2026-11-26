/** İstemci bileşenleri için JSON API çağrısı; sunucunun tek tip hata gövdesini okunur mesaja çevirir. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = json?.error ?? {};
    throw new ApiError(error.message ?? `İstek başarısız (${response.status})`, response.status, error.code, error.details?.fieldErrors);
  }
  return json as T;
}
