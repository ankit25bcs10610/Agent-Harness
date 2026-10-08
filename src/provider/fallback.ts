import { ProviderError } from "./errors";
import type {
  ProviderResponse,
  AgentMessage,
  ToolSpec,
  ProviderOptions,
} from "./types";

export type CompletionRunner = (
  model: string,
  messages: AgentMessage[],
  tools: ToolSpec[],
  signal: AbortSignal,
  options?: ProviderOptions,
) => Promise<ProviderResponse>;

export async function completeWithFallback(
  models: string[],
  run: CompletionRunner,
  messages: AgentMessage[],
  tools: ToolSpec[],
  signal: AbortSignal,
  options?: ProviderOptions,
): Promise<ProviderResponse> {
  let last: unknown;
  for (const model of models) {
    if (signal.aborted)
      throw new DOMException("The operation was aborted", "AbortError");
    try {
      return await run(model, messages, tools, signal, options);
    } catch (error) {
      last = error;
      if (!(error instanceof ProviderError) || !error.retryable) throw error;
    }
  }
  throw last instanceof Error
    ? last
    : new Error("All configured model routes failed");
}
