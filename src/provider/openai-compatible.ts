import { requestJson } from "./transport";
import type {
  AgentMessage,
  ProviderResponse,
  ToolSpec,
  ProviderOptions,
} from "./types";
import type { ModelCapabilities, ModelInfo, ProviderAdapter } from "./registry";

export type CompatibleProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  capabilities?: Partial<ModelCapabilities>;
  fetchImpl?: typeof fetch;
};

export function createOpenAICompatibleAdapter(
  config: CompatibleProviderConfig,
): ProviderAdapter {
  return {
    id: config.id,
    listModels: async (): Promise<ModelInfo[]> => [],
    complete: async (
      messages: AgentMessage[],
      tools: ToolSpec[],
      signal: AbortSignal,
      model: string,
      options?: ProviderOptions,
    ): Promise<ProviderResponse> => {
      const response = await requestJson<any>({
        url: `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        headers: config.apiKey
          ? { authorization: `Bearer ${config.apiKey}` }
          : {},
        body: { model, messages, tools, stream: false },
        signal,
        ...(options?.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      });
      const choice = response.data?.choices?.[0];
      if (!choice?.message)
        throw new Error("Provider response did not contain a choice");
      const usage = response.data.usage ?? {};
      return {
        message: {
          type: "assistant",
          content: choice.message.content ?? null,
          ...(choice.message.tool_calls
            ? {
                toolCalls: choice.message.tool_calls.map((call: any) => ({
                  toolCallId: call.id,
                  name: call.function?.name ?? "",
                  arguments: call.function?.arguments ?? "",
                })),
              }
            : {}),
        },
        finishReason:
          choice.finish_reason === "tool_calls"
            ? "tool_calls"
            : choice.finish_reason === "length"
              ? "length"
              : "stop",
        stats: {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
          usageComplete: usage.total_tokens !== undefined,
        },
      };
    },
  };
}
