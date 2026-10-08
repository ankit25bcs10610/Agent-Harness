import type {
  ProviderResponse,
  AgentMessage,
  ToolSpec,
  ProviderOptions,
} from "./types";

export type ModelCapabilities = {
  contextWindow?: number;
  maxOutputTokens?: number;
  streaming: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
};
export type ModelInfo = {
  provider: string;
  id: string;
  name?: string;
  capabilities: ModelCapabilities;
  configured: boolean;
};
export type ProviderAdapter = {
  id: string;
  listModels: () => Promise<ModelInfo[]>;
  complete: (
    messages: AgentMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
    model: string,
    options?: ProviderOptions,
  ) => Promise<ProviderResponse>;
};

const adapters = new Map<string, ProviderAdapter>();
export function registerProvider(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}
export function providerFor(modelRef: string): ProviderAdapter | undefined {
  return adapters.get(modelRef.split("/", 1)[0] ?? "");
}
export function parseModelRef(modelRef: string): {
  provider: string;
  model: string;
} {
  const separator = modelRef.indexOf("/");
  return separator < 1
    ? { provider: "", model: modelRef }
    : {
        provider: modelRef.slice(0, separator),
        model: modelRef.slice(separator + 1),
      };
}
export function registeredProviders(): string[] {
  return [...adapters.keys()].sort();
}
export async function listRegisteredModels(): Promise<ModelInfo[]> {
  return (
    await Promise.all(
      [...adapters.values()].map((adapter) => adapter.listModels()),
    )
  ).flat();
}
