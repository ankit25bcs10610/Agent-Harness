import { complete } from "./complete";
import { parseModelRef } from "./registry";
import type { ProviderAdapter, ModelInfo } from "./registry";

export type OpenRouterAdapterOptions = {
  baseUrl?: string;
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  apiKey?: string;
  timeoutMs?: number;
};

type OpenRouterModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  top_provider?: { max_completion_tokens?: unknown };
  supported_parameters?: unknown;
};

function hasParameter(model: OpenRouterModel, parameter: string) {
  return (
    Array.isArray(model.supported_parameters) &&
    model.supported_parameters.includes(parameter)
  );
}

export function createOpenRouterAdapter(
  options: OpenRouterAdapterOptions = {},
): ProviderAdapter {
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: "openrouter",
    listModels: async (): Promise<ModelInfo[]> => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 10_000,
      );
      try {
        const response = await fetchImpl(
          `${baseUrl.replace(/\/$/, "")}/models`,
          {
            headers: options.apiKey
              ? { authorization: `Bearer ${options.apiKey}` }
              : {},
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            `OpenRouter model discovery returned HTTP ${response.status}`,
          );
        const body = (await response.json()) as { data?: OpenRouterModel[] };
        if (!Array.isArray(body.data))
          throw new Error("OpenRouter model discovery returned malformed data");
        return body.data.flatMap((model) => {
          if (typeof model.id !== "string" || !model.id) return [];
          const contextWindow =
            typeof model.context_length === "number" &&
            Number.isSafeInteger(model.context_length) &&
            model.context_length > 0
              ? model.context_length
              : undefined;
          const maxOutputTokens =
            typeof model.top_provider?.max_completion_tokens === "number" &&
            Number.isSafeInteger(model.top_provider.max_completion_tokens) &&
            model.top_provider.max_completion_tokens > 0
              ? model.top_provider.max_completion_tokens
              : undefined;
          return [
            {
              provider: "openrouter",
              id: model.id,
              ...(typeof model.name === "string" ? { name: model.name } : {}),
              capabilities: {
                ...(contextWindow !== undefined ? { contextWindow } : {}),
                ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
                streaming: true,
                toolCalling: hasParameter(model, "tools"),
                reasoning: hasParameter(model, "reasoning"),
                structuredOutput: hasParameter(model, "response_format"),
              },
              configured: true,
              capabilitiesVerified: true,
            },
          ];
        });
      } finally {
        clearTimeout(timer);
      }
    },
    complete: async (messages, tools, signal, model, options) =>
      complete(messages, tools, signal, parseModelRef(model).model, options),
  };
}
