import { getClient } from "./client";
import { normalize, normalizeStream, toSdkMsg, toSdkTool } from "./normalize";
import type {
  AgentMessage,
  CompleteFunc,
  CompleteStreamFunc,
  ProviderResponse,
  StreamCallbacks,
  ToolSpec,
  ProviderOptions,
} from "./types";
import { ProviderError, redactProviderSecrets } from "./errors";
import { withProviderRetry } from "./retry";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.25,
};

function requestSignal(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}

function logFailure(
  options: ProviderOptions | undefined,
  event: string,
  error: unknown,
) {
  const details =
    error instanceof ProviderError
      ? {
          code: error.code,
          retryable: error.retryable,
          ...error.details,
          message: error.message,
        }
      : { message: error instanceof Error ? error.message : String(error) };
  options?.logger?.warn?.(
    event,
    redactProviderSecrets(details) as Record<string, unknown>,
  );
}

export const complete: CompleteFunc = async (
  messages: AgentMessage[],
  tools: ToolSpec[] = [],
  signal: AbortSignal,
  model: string,
  options?: ProviderOptions,
): Promise<ProviderResponse> => {
  const request = () => {
    const scoped = requestSignal(
      signal,
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    return getClient()
      .chat.send(
        {
          chatRequest: {
            model,
            maxTokens: 4000,
            messages: messages.map(toSdkMsg),
            tools: tools.map(toSdkTool),
            stream: false,
          },
        },
        { fetchOptions: { signal: scoped.signal } },
      )
      .catch((error) => {
        if (scoped.timedOut() && !signal.aborted)
          throw new ProviderError(
            "Provider request timed out",
            "timeout",
            true,
          );
        throw error;
      })
      .finally(scoped.dispose);
  };

  try {
    return await withProviderRetry(
      async () => {
        const completion = await request();
        if (completion instanceof ReadableStream)
          throw new ProviderError(
            "Expected a non-streaming response",
            "malformed_response",
            false,
          );
        return normalize(completion);
      },
      signal,
      { ...DEFAULT_RETRY, ...options?.retry },
    );
  } catch (error) {
    logFailure(options, "provider_request_failed", error);
    throw error;
  }
};

export const completeStream: CompleteStreamFunc = async (
  messages: AgentMessage[],
  tools: ToolSpec[] = [],
  signal: AbortSignal,
  model: string,
  callbacks?: StreamCallbacks,
  options?: ProviderOptions,
): Promise<ProviderResponse> => {
  try {
    const response = await withProviderRetry(
      async () => {
        const scoped = requestSignal(
          signal,
          options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        try {
          let stream;
          try {
            stream = await getClient().chat.send(
              {
                chatRequest: {
                  model,
                  maxTokens: 4000,
                  messages: messages.map(toSdkMsg),
                  tools: tools.map(toSdkTool),
                  stream: true,
                  streamOptions: { includeUsage: true },
                },
              },
              { fetchOptions: { signal: scoped.signal } },
            );
          } catch (error) {
            if (scoped.timedOut() && !signal.aborted)
              throw new ProviderError(
                "Provider stream timed out",
                "timeout",
                true,
              );
            throw error;
          }
          if (!(stream instanceof ReadableStream))
            throw new ProviderError(
              "Expected a streaming response",
              "malformed_response",
              false,
            );
          const text: string[] = [];
          const reasoning: string[] = [];
          const response = await normalizeStream(stream, {
            onText: (chunk) => text.push(chunk),
            onReasoning: (chunk) => reasoning.push(chunk),
          });
          text.forEach((chunk) => callbacks?.onText?.(chunk));
          reasoning.forEach((chunk) => callbacks?.onReasoning?.(chunk));
          return response;
        } finally {
          scoped.dispose();
        }
      },
      signal,
      { ...DEFAULT_RETRY, ...options?.retry },
    );
    return response;
  } catch (error) {
    logFailure(options, "provider_stream_failed", error);
    throw error;
  }
};
