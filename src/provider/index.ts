export type {
  ToolSpec,
  AgentMessage,
  ProviderResponse,
  ToolCall,
  ToolMessage,
  SystemMessage,
  CompleteStreamFunc,
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
export {
  createLocalProviderAdapter,
  detectHardware,
  inspectLocalEndpoint,
  localEndpointFromEnv,
  type HardwareProfile,
  type LocalEndpointConfig,
  type LocalModelCapability,
  type LocalEndpointInspection,
} from "./local";
export { chooseModel } from "./router";
export type { RoutingDecision, RoutingPolicy, RoutingRequest } from "./router";
