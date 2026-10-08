export type {
  ToolSpec,
  AgentMessage,
  ProviderResponse,
  ToolCall,
  ToolMessage,
  SystemMessage,
} from "./types";

export { complete, completeStream } from "./complete";
export {
  registerProvider,
  providerFor,
  parseModelRef,
  registeredProviders,
  listRegisteredModels,
} from "./registry";
export type { ModelCapabilities, ModelInfo, ProviderAdapter } from "./registry";
export { createOpenRouterAdapter } from "./openrouter";
export { requestJson } from "./transport";
export { completeWithFallback } from "./fallback";
export { createOpenAICompatibleAdapter } from "./openai-compatible";
export type { CompatibleProviderConfig } from "./openai-compatible";
