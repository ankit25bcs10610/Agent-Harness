import { ProviderError } from "./errors";

export type HttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function requestJson<T>(
  request: HttpRequest,
): Promise<{ data: T; headers: Headers }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? 45_000,
  );
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: {
        ...(request.body ? { "content-type": "application/json" } : {}),
        ...request.headers,
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError(
        "Provider returned malformed JSON",
        "malformed_response",
        false,
      );
    }
    if (!response.ok)
      throw new ProviderError(
        `Provider request failed with ${response.status}`,
        response.status === 429
          ? "rate_limit"
          : response.status >= 500
            ? "server"
            : "invalid_request",
        response.status === 429 || response.status >= 500,
        {
          status: response.status,
        },
      );
    return { data: data as T, headers: response.headers };
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("Provider request failed", "network", true);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abort);
  }
}
