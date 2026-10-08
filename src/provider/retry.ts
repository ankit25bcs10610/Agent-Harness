import { classifyProviderError, ProviderError } from "./errors";

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

const defaultSleep = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(
        new ProviderError("Provider request aborted", "aborted", false),
      );
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ProviderError("Provider request aborted", "aborted", false));
      },
      { once: true },
    );
  });

export async function withProviderRetry<T>(
  operation: (attempt: number) => Promise<T>,
  signal: AbortSignal,
  policy: RetryPolicy,
): Promise<T> {
  const random = policy.random ?? Math.random;
  const sleep = policy.sleep ?? defaultSleep;
  let lastError: ProviderError | undefined;
  const attempts = Math.max(1, Math.floor(policy.maxAttempts));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal.aborted)
      throw new ProviderError("Provider request aborted", "aborted", false, {
        attempt,
      });
    try {
      return await operation(attempt);
    } catch (error) {
      const classified = classifyProviderError(error, signal);
      lastError = new ProviderError(
        classified.message,
        classified.code,
        classified.retryable,
        {
          ...classified.details,
          attempt,
        },
      );
      if (!classified.retryable || attempt === attempts) throw lastError;
      const exponential = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * 2 ** (attempt - 1),
      );
      const jitter = exponential * Math.max(0, policy.jitterRatio) * random();
      const delay = Math.min(
        policy.maxDelayMs,
        classified.details.retryAfterMs ?? exponential + jitter,
      );
      await sleep(delay, signal);
    }
  }
  throw (
    lastError ?? new ProviderError("Provider request failed", "unknown", false)
  );
}
