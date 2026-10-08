import { complete } from "./complete";
import { parseModelRef } from "./registry";
import type { ProviderAdapter, ModelInfo } from "./registry";

export function createOpenRouterAdapter(): ProviderAdapter {
  return {
    id: "openrouter",
    listModels: async (): Promise<ModelInfo[]> => [],
    complete: async (messages, tools, signal, model, options) =>
      complete(messages, tools, signal, parseModelRef(model).model, options),
  };
}
