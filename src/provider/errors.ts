export type ProviderErrorCode =
  | "aborted"
  | "timeout"
  | "network"
  | "rate_limit"
  | "server"
  | "authentication"
  | "invalid_request"
  | "malformed_response"
  | "incomplete_response"
  | "unknown";

export type ProviderErrorDetails = {
  status?: number;
  retryAfterMs?: number | undefined;
  attempt?: number | undefined;
  providerCode?: string | undefined;
};

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly code: ProviderErrorCode;
  readonly details: ProviderErrorDetails;

  constructor(
    message: string,
    code: ProviderErrorCode,
    retryable: boolean,
    details: ProviderErrorDetails = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

function getValue(error: unknown, key: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[key];
}

function getStatus(error: unknown): number | undefined {
  const value = getValue(error, "status") ?? getValue(error, "statusCode");
  return typeof value === "number" ? value : undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  const headers = getValue(error, "headers");
  if (!headers || typeof headers !== "object") return undefined;
  const raw =
    getValue(headers, "retry-after") ??
    getValue(headers, "Retry-After") ??
    (typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get(name: string): unknown }).get("retry-after")
      : undefined);
  if (typeof raw === "number" && Number.isFinite(raw))
    return Math.max(0, raw * 1000);
  if (typeof raw !== "string") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function classifyProviderError(
  error: unknown,
  signal?: AbortSignal,
): ProviderError {
  if (error instanceof ProviderError) return error;
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new ProviderError("Provider request aborted", "aborted", false);
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = getStatus(error);
  const retryAfterMs = getRetryAfterMs(error);
  if (status === 401 || status === 403)
    return new ProviderError(
      "Provider authentication failed",
      "authentication",
      false,
      { status },
    );
  if (status === 408 || status === 409 || status === 425 || status === 429)
    return new ProviderError(
      "Provider request is rate limited or temporarily unavailable",
      "rate_limit",
      true,
      { status, retryAfterMs },
    );
  if (status !== undefined && status >= 500)
    return new ProviderError("Provider server failure", "server", true, {
      status,
      retryAfterMs,
    });
  if (/timeout|timed out|ETIMEDOUT/i.test(message))
    return new ProviderError("Provider request timed out", "timeout", true, {
      retryAfterMs,
    });
  if (
    /network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket/i.test(message)
  )
    return new ProviderError("Provider network failure", "network", true, {
      retryAfterMs,
    });
  if (status !== undefined && status >= 400 && status < 500)
    return new ProviderError(
      "Provider rejected the request",
      "invalid_request",
      false,
      { status },
    );
  return new ProviderError("Provider request failed", "unknown", false, {
    retryAfterMs,
  });
}

export function redactProviderSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
      .replace(/(sk-or-v1-|sk-)[A-Za-z0-9_-]+/g, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactProviderSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) =>
        /key|token|secret|password|authorization|cookie/i.test(key)
          ? [key, "[REDACTED]"]
          : [key, redactProviderSecrets(item)],
      ),
    );
  }
  return value;
}
