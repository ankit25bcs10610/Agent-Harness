import { expect, test } from "bun:test";
import {
  ProviderError,
  classifyProviderError,
  redactProviderSecrets,
} from "../../src/provider/errors";
import { withProviderRetry } from "../../src/provider/retry";

test("classifies rate limits and parses Retry-After", () => {
  const error = classifyProviderError({
    status: 429,
    headers: { "retry-after": "2" },
  });
  expect(error.code).toBe("rate_limit");
  expect(error.retryable).toBe(true);
  expect(error.details.retryAfterMs).toBe(2000);
});

test("does not retry non-retryable provider errors", async () => {
  let attempts = 0;
  await expect(
    withProviderRetry(
      async () => {
        attempts++;
        throw new ProviderError("bad request", "invalid_request", false);
      },
      new AbortController().signal,
      { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    ),
  ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
  expect(attempts).toBe(1);
});

test("retries transient failures with deterministic backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withProviderRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw { status: 503 };
      return "ok";
    },
    new AbortController().signal,
    {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      jitterRatio: 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
    },
  );
  expect(result).toBe("ok");
  expect(attempts).toBe(3);
  expect(delays).toEqual([10, 20]);
});

test("abort cancels retry backoff", async () => {
  const controller = new AbortController();
  const promise = withProviderRetry(
    async () => {
      throw { status: 503 };
    },
    controller.signal,
    {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 100,
      jitterRatio: 0,
      sleep: async (_delay, signal) => {
        signal?.addEventListener("abort", () => undefined, { once: true });
        controller.abort();
        throw new ProviderError("aborted", "aborted", false);
      },
    },
  );
  await expect(promise).rejects.toMatchObject({ code: "aborted" });
});

test("redacts provider secrets from structured logs", () => {
  expect(
    redactProviderSecrets({
      authorization: "Bearer secret",
      apiKey: "sk-or-v1-test",
    }),
  ).toEqual({
    authorization: "[REDACTED]",
    apiKey: "[REDACTED]",
  });
});
