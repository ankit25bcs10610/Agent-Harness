// Need to know when:
// 1) Response from the provider
// 2) Agent message (Tool result/ text)
// 3) Tool calls requested by the provider

export type ToolCall = {
  toolCallId: string;
  name: string;
  arguments: string;
};

export type FinishReason =
  "tool_calls" | "stop" | "length" | "content_filter" | "error";

export type Statistics = {
  promptTokens: number; // zero when the provider omits usage
  completionTokens: number;
  totalTokens: number;
  usageComplete?: boolean;
};

export type ProviderResponse = {
  message: AssistantMessage;
  finishReason: FinishReason;
  stats: Statistics;
};

export type UserMessage = {
  type: "user";
  content: string;
};

export type SystemMessage = {
  type: "system";
  content: string;
};

// previous provider response
export type AssistantMessage = {
  type: "assistant";
  content: string | null;
  toolCalls?: ToolCall[];
};

export type ToolMessage = {
  type: "tool";
  toolCallId: string;
  content: string;
};

export type AgentMessage =
  UserMessage | SystemMessage | AssistantMessage | ToolMessage;

export type ToolSpec = {
  name: string;
  description: string;
  parameters: object;
};

export type CompleteFunc = (
  // generates the next completion
  messages: AgentMessage[],
  tools: ToolSpec[],
  signal: AbortSignal,
  model: string,
  options?: ProviderOptions,
) => Promise<ProviderResponse>;

export type ProviderOptions = {
  timeoutMs?: number;
  retry?: Partial<import("./retry").RetryPolicy>;
  logger?: ProviderLogger;
  fallback?: ModelFallbackResolver;
};

/** Explicit extension point; automatic model switching is intentionally disabled. */
export type ModelFallbackResolver = {
  resolve: (primaryModel: string, error: unknown) => string | undefined;
};

export type ProviderLogger = {
  warn?: (event: string, details: Record<string, unknown>) => void;
  error?: (event: string, details: Record<string, unknown>) => void;
};

export type StreamCallbacks = {
  onText?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
};

export type CompleteStreamFunc = (
  // generates the next completion
  messages: AgentMessage[],
  tools: ToolSpec[],
  signal: AbortSignal,
  model: string,
  callbacks?: StreamCallbacks,
  options?: ProviderOptions,
) => Promise<ProviderResponse>;
