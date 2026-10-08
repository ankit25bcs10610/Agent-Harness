import type { AgentMessage } from "../provider";
import type { ContextDiagnostics, ContextState } from "../context/types";
import type {
  CompleteStreamFunc,
  SystemMessage,
  ToolCall,
} from "../provider/types";
import type { ToolContext } from "../tool/types";
import type {
  VerificationReport,
  WorkflowController,
  WorkflowPolicy,
} from "../workflow/types";

// dependency injecting interfaces for loop

// loop config
export interface LoopConfig {
  maxIterations: number;
  maxTokens: number;
  contextWindow: number; // depends on the model (TODO: model mapping)
  pruneRatio: number; // limit after which prune fires
  maxPruneAllowanceRatio: number; // max ctx allowed (latest max not pruned)
  compactionRatio: number; // limit after which compaction fires
  compactionModel: string;
  loopModel: string;
  transcriptCapChars: number;
  wallClockMs?: number;
  workflow?: WorkflowPolicy;
  contextActiveRatio?: number;
  recentContextTurns?: number;
  maxMemoryEntries?: number;
}

export type LifecycleState =
  | "initializing"
  | "reasoning"
  | "tool_dispatch"
  | "permission_waiting"
  | "execution"
  | "verification"
  | "completion"
  | "cancellation"
  | "failure";

export type AgentEvent =
  | { type: "lifecycle"; state: LifecycleState; at: number }
  | { type: "model_request"; model: string; attempt: number; at: number }
  | { type: "model_response"; totalTokens: number; at: number }
  | { type: "tool_call"; call: ToolCall; at: number }
  | { type: "tool_result"; call: ToolCall; result: string; at: number }
  | { type: "checkpoint"; at: number }
  | { type: "stopped"; reason: StopReason; at: number };

// loop input format
export interface LoopInput {
  messages: AgentMessage[]; // new user query
  systemPrompt: SystemMessage; // built at runtime, kept out of config and state
  complete: CompleteStreamFunc;
  config: LoopConfig;
  ctx: ToolContext;
  events?: LoopEvents;
  checkpoint?: CheckpointHook;
  state?: LoopState | undefined;
  workflow?: WorkflowController;
}

export type StopReason =
  | "stop"
  | "max_iterations"
  | "error"
  | "length"
  | "content_filter"
  | "interrupted"
  | "max_tokens"
  | "wall_clock"
  | "provider_failure"
  | "malformed_response"
  | "tool_failure"
  | "verification_failed";

// loop output format
export interface LoopOutput {
  messages: AgentMessage[];
  stopReason: StopReason;
  iterations: number;
  lastPromptTokens: number;
  tokensUsed: number;
  lastMessageView: AgentMessage[];
  state: LoopState;
  execution: ExecutionStats;
  verification?: VerificationReport;
  context?: ContextDiagnostics;
}

export interface ExecutionStats {
  startedAt: number;
  durationMs: number;
  modelRequests: number;
  toolCalls: number;
  tokensUsed: number;
  usageIncomplete: boolean;
}

export interface LoopEvents {
  onText?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolResult?: (call: ToolCall, result: string) => void;
  onPermissionWaiting?: () => void;
  onEvent?: (event: AgentEvent) => void;
}

export type CheckpointHook = (state: LoopState) => void | Promise<void>;

export interface LoopState {
  messages: AgentMessage[]; // raw history, no system prompt
  view: AgentMessage[];
  summary: AgentMessage;
  summarizedUpTo: number;
  lastPromptTokens: number;
  execution?: ExecutionStats;
  context?: ContextState;
}
