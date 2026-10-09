import { arch, cpus, platform, totalmem } from "node:os";
import { z } from "zod";
import { ProviderError } from "./errors";
import { requestJson } from "./transport";
import type {
  AgentMessage,
  CompleteStreamFunc,
  ProviderOptions,
  ProviderResponse,
  ToolSpec,
  ToolCall,
} from "./types";
import type { ModelCapabilities, ModelInfo, ProviderAdapter } from "./registry";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type LocalEndpointConfig = {
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
  offline?: boolean;
  allowRemote?: boolean;
  privateEndpointConsent?: boolean;
  timeoutMs?: number;
  models?: Readonly<Record<string, Partial<ModelCapabilities>>>;
  fetchImpl?: typeof fetch;
};

export type LocalModelCapability = {
  model: string;
  capabilities: Partial<ModelCapabilities>;
  verified: boolean;
  source: "configuration" | "discovery" | "unknown";
};

export type HardwareProfile = {
  platform: NodeJS.Platform;
  architecture: string;
  cpuCount: number;
  totalMemoryBytes: number;
  appleSilicon: boolean;
  gpu: "unknown";
  acceleration: "unknown";
};

export type LocalEndpointInspection = {
  allowed: boolean;
  classification: "loopback" | "private-or-remote" | "invalid";
  reason: string;
  origin?: string;
};

const LocalEndpointSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  offline: z.boolean().optional(),
  allowRemote: z.boolean().optional(),
  privateEndpointConsent: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});

export function detectHardware(): HardwareProfile {
  const currentPlatform = platform();
  const currentArch = arch();
  return {
    platform: currentPlatform,
    architecture: currentArch,
    cpuCount: Math.max(1, cpus().length),
    totalMemoryBytes: totalmem(),
    appleSilicon: currentPlatform === "darwin" && currentArch === "arm64",
    gpu: "unknown",
    acceleration: "unknown",
  };
}

function endpointInspection(
  config: LocalEndpointConfig,
): LocalEndpointInspection {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return {
      allowed: false,
      classification: "invalid",
      reason: "local endpoint must be a valid URL",
    };
  }
  if (url.username || url.password)
    return {
      allowed: false,
      classification: "invalid",
      reason: "credentials in endpoint URLs are not allowed",
    };
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return {
      allowed: false,
      classification: "invalid",
      reason: "local endpoint must use http or https",
    };
  const loopback = LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if (loopback)
    return {
      allowed: true,
      classification: "loopback",
      reason: "loopback endpoint",
      origin: url.origin,
    };
  if (config.offline)
    return {
      allowed: false,
      classification: "private-or-remote",
      reason: "offline policy allows loopback endpoints only",
      origin: url.origin,
    };
  if (!config.allowRemote || !config.privateEndpointConsent)
    return {
      allowed: false,
      classification: "private-or-remote",
      reason:
        "non-loopback endpoint requires allowRemote and explicit privateEndpointConsent",
      origin: url.origin,
    };
  if (url.protocol !== "https:")
    return {
      allowed: false,
      classification: "private-or-remote",
      reason: "non-loopback endpoint must use HTTPS",
      origin: url.origin,
    };
  return {
    allowed: true,
    classification: "private-or-remote",
    reason: "explicitly authorized HTTPS endpoint",
    origin: url.origin,
  };
}

export function inspectLocalEndpoint(
  config: LocalEndpointConfig,
): LocalEndpointInspection {
  return endpointInspection(config);
}

export function localEndpointFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LocalEndpointConfig | undefined {
  const baseUrl = env.CHIKU_LOCAL_BASE_URL;
  if (!baseUrl) return undefined;
  const parseBool = (value: string | undefined) =>
    value === "1" || value === "true";
  return {
    baseUrl,
    ...(env.CHIKU_LOCAL_API_KEY ? { apiKey: env.CHIKU_LOCAL_API_KEY } : {}),
    ...(env.CHIKU_LOCAL_PROVIDER_ID
      ? { providerId: env.CHIKU_LOCAL_PROVIDER_ID }
      : {}),
    offline: parseBool(env.CHIKU_OFFLINE),
    allowRemote: parseBool(env.CHIKU_LOCAL_ALLOW_REMOTE),
    privateEndpointConsent: parseBool(env.CHIKU_LOCAL_PRIVATE_ENDPOINT_CONSENT),
  };
}

function capabilitiesFor(
  model: string,
  configured: Readonly<Record<string, Partial<ModelCapabilities>>> | undefined,
): LocalModelCapability {
  const capabilities = configured?.[model];
  return capabilities
    ? { model, capabilities, verified: true, source: "configuration" }
    : { model, capabilities: {}, verified: false, source: "unknown" };
}

function completeFromResponse(data: unknown): ProviderResponse {
  if (!data || typeof data !== "object")
    throw new ProviderError(
      "Local provider returned malformed JSON",
      "malformed_response",
      false,
    );
  const body = data as {
    choices?: Array<{
      message?: { content?: unknown; tool_calls?: unknown };
      finish_reason?: unknown;
    }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
  };
  const choice = body.choices?.[0];
  if (!choice?.message)
    throw new ProviderError(
      "Local provider response did not contain a choice",
      "malformed_response",
      false,
    );
  const rawCalls = choice.message.tool_calls;
  const toolCalls: ToolCall[] | undefined =
    rawCalls === undefined
      ? undefined
      : Array.isArray(rawCalls)
        ? rawCalls.map((raw) => {
            if (!raw || typeof raw !== "object")
              throw new ProviderError(
                "Local provider returned an invalid tool call",
                "malformed_response",
                false,
              );
            const call = raw as {
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            };
            if (
              typeof call.id !== "string" ||
              typeof call.function?.name !== "string" ||
              typeof call.function.arguments !== "string"
            )
              throw new ProviderError(
                "Local provider returned an incomplete tool call",
                "incomplete_response",
                false,
              );
            try {
              JSON.parse(call.function.arguments);
            } catch {
              throw new ProviderError(
                "Local provider returned malformed tool arguments",
                "malformed_response",
                false,
              );
            }
            return {
              toolCallId: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            };
          })
        : (() => {
            throw new ProviderError(
              "Local provider returned invalid tool calls",
              "malformed_response",
              false,
            );
          })();
  const finish = choice.finish_reason;
  const finishReason =
    finish === "tool_calls"
      ? "tool_calls"
      : finish === "length"
        ? "length"
        : finish === "stop"
          ? "stop"
          : undefined;
  if (!finishReason)
    throw new ProviderError(
      "Local provider returned an unknown finish reason",
      "malformed_response",
      false,
    );
  if (finishReason === "tool_calls" && !toolCalls?.length)
    throw new ProviderError(
      "Local provider returned an incomplete tool call response",
      "incomplete_response",
      false,
    );
  const usage = body.usage;
  const promptTokens =
    typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens =
    typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens =
    typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : promptTokens + completionTokens;
  return {
    message: {
      type: "assistant",
      content:
        typeof choice.message.content === "string"
          ? choice.message.content
          : null,
      ...(toolCalls ? { toolCalls } : {}),
    },
    finishReason,
    stats: {
      promptTokens,
      completionTokens,
      totalTokens,
      ...(usage?.total_tokens === undefined ? { usageComplete: false } : {}),
    },
  };
}

async function postCompletion(
  config: LocalEndpointConfig,
  messages: AgentMessage[],
  tools: ToolSpec[],
  signal: AbortSignal,
  model: string,
  stream: boolean,
  options?: ProviderOptions,
) {
  if (signal.aborted)
    throw new ProviderError("Local provider request aborted", "aborted", false);
  const inspection = endpointInspection(config);
  if (!inspection.allowed)
    throw new ProviderError(
      `Local endpoint rejected: ${inspection.reason}`,
      "invalid_request",
      false,
    );
  LocalEndpointSchema.parse(config);
  return requestJson<unknown>({
    url: `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    method: "POST",
    headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
    body: { model, messages, tools, stream },
    signal,
    timeoutMs: options?.timeoutMs ?? config.timeoutMs,
    fetchImpl: config.fetchImpl,
  });
}

export function createLocalProviderAdapter(
  config: LocalEndpointConfig,
): ProviderAdapter {
  const id = config.providerId ?? "local";
  return {
    id,
    listModels: async (): Promise<ModelInfo[]> => {
      const inspection = endpointInspection(config);
      if (!inspection.allowed)
        throw new Error(`Local endpoint rejected: ${inspection.reason}`);
      const response = await requestJson<{
        data?: Array<{ id?: unknown; name?: unknown }>;
      }>({
        url: `${config.baseUrl.replace(/\/$/, "")}/models`,
        headers: config.apiKey
          ? { authorization: `Bearer ${config.apiKey}` }
          : {},
        timeoutMs: config.timeoutMs,
        fetchImpl: config.fetchImpl,
      });
      return (response.data.data ?? []).flatMap((entry) => {
        if (typeof entry.id !== "string") return [];
        const capability = capabilitiesFor(entry.id, config.models);
        const capabilities: ModelCapabilities = {
          streaming: capability.capabilities.streaming ?? false,
          toolCalling: capability.capabilities.toolCalling ?? false,
          reasoning: capability.capabilities.reasoning ?? false,
          structuredOutput: capability.capabilities.structuredOutput ?? false,
          ...(capability.capabilities.contextWindow !== undefined
            ? { contextWindow: capability.capabilities.contextWindow }
            : {}),
          ...(capability.capabilities.maxOutputTokens !== undefined
            ? { maxOutputTokens: capability.capabilities.maxOutputTokens }
            : {}),
        };
        return [
          {
            provider: id,
            id: entry.id,
            ...(typeof entry.name === "string" ? { name: entry.name } : {}),
            capabilities,
            configured: capability.verified,
            capabilitiesVerified: capability.verified,
          },
        ];
      });
    },
    complete: async (messages, tools, signal, model, options) => {
      const response = await postCompletion(
        config,
        messages,
        tools,
        signal,
        model,
        false,
        options,
      );
      return completeFromResponse(response.data);
    },
    completeStream: createLocalStream(config),
  };
}

function createLocalStream(config: LocalEndpointConfig): CompleteStreamFunc {
  return async (messages, tools, signal, model, callbacks, options) => {
    if (signal.aborted)
      throw new ProviderError(
        "Local provider request aborted",
        "aborted",
        false,
      );
    const inspection = endpointInspection(config);
    if (!inspection.allowed)
      throw new ProviderError(
        `Local endpoint rejected: ${inspection.reason}`,
        "invalid_request",
        false,
      );
    LocalEndpointSchema.parse(config);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options?.timeoutMs ?? config.timeoutMs ?? 45_000,
    );
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(
        `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey
              ? { authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({ model, messages, tools, stream: true }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (signal.aborted)
        throw new ProviderError(
          "Local provider request aborted",
          "aborted",
          false,
        );
      throw new ProviderError(
        "Local provider request failed",
        "network",
        true,
        {
          ...(error instanceof Error ? { providerCode: error.name } : {}),
        },
      );
    }
    if (!response.ok)
      throw new ProviderError(
        `Local provider request failed with ${response.status}`,
        response.status >= 500 ? "server" : "invalid_request",
        response.status >= 500,
        { status: response.status },
      );
    if (!response.body)
      throw new ProviderError(
        "Local provider did not return a streaming body",
        "malformed_response",
        false,
      );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let text = "";
    let finish: string | undefined;
    let usage:
      | {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
          total_tokens?: unknown;
        }
      | undefined;
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    const process = (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        throw new ProviderError(
          "Local provider returned malformed stream JSON",
          "malformed_response",
          false,
        );
      }
      usage ??= chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") {
        text += delta.content;
        callbacks?.onText?.(delta.content);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      for (const part of delta.tool_calls ?? []) {
        const current = calls.get(part.index ?? 0) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        current.id += typeof part.id === "string" ? part.id : "";
        current.name +=
          typeof part.function?.name === "string" ? part.function.name : "";
        current.arguments +=
          typeof part.function?.arguments === "string"
            ? part.function.arguments
            : "";
        calls.set(part.index ?? 0, current);
      }
    };
    try {
      while (true) {
        const next = await reader.read();
        pending += decoder.decode(next.value ?? new Uint8Array(), {
          stream: !next.done,
        });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        lines.forEach(process);
        if (next.done) break;
      }
      if (pending) process(pending);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
    if (!finish)
      throw new ProviderError(
        "Local provider stream ended without a finish reason",
        "incomplete_response",
        false,
      );
    const toolCalls = [...calls.values()].map((call) => {
      if (!call.id || !call.name || !call.arguments)
        throw new ProviderError(
          "Local provider returned an incomplete streamed tool call",
          "incomplete_response",
          false,
        );
      try {
        JSON.parse(call.arguments);
      } catch {
        throw new ProviderError(
          "Local provider returned malformed streamed tool arguments",
          "malformed_response",
          false,
        );
      }
      return {
        toolCallId: call.id,
        name: call.name,
        arguments: call.arguments,
      };
    });
    const promptTokens =
      typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const completionTokens =
      typeof usage?.completion_tokens === "number"
        ? usage.completion_tokens
        : 0;
    const totalTokens =
      typeof usage?.total_tokens === "number"
        ? usage.total_tokens
        : promptTokens + completionTokens;
    return {
      message: {
        type: "assistant",
        content: text || null,
        ...(toolCalls.length ? { toolCalls } : {}),
      },
      finishReason:
        finish === "tool_calls"
          ? "tool_calls"
          : finish === "length"
            ? "length"
            : finish === "stop"
              ? "stop"
              : "error",
      stats: {
        promptTokens,
        completionTokens,
        totalTokens,
        ...(usage?.total_tokens === undefined ? { usageComplete: false } : {}),
      },
    };
  };
}
