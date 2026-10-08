import type { CompleteStreamFunc } from "../provider/types";
import type { AgentMessage } from "../provider";

export type PruneMsgs = (
  messages: AgentMessage[],
  contextWindow: number,
  maxContextRatio: number,
) => AgentMessage[];

export type Compact = (
  previousSummary: AgentMessage,
  previousSummarizedUpTo: number,
  messages: AgentMessage[],
  signal: AbortSignal,
  compactionModel: string,
  transcriptCapChars: number,
  complete: CompleteStreamFunc,
) => Promise<
  [summary: AgentMessage, summaryUpTo: number, tokensUsed: number] | null
>;

export type Skill = {
  name: string;
  description: string;
};

export type ContextMemory = {
  id: string;
  kind: "requirement" | "decision" | "edit" | "error" | "verification";
  text: string;
  sourceIndexes: number[];
  invalidatedBy?: string;
};

export type ContextState = {
  memories: ContextMemory[];
  invalidatedPaths: string[];
  compactionCount: number;
};

export type ContextDiagnostics = {
  estimatedTokens: number;
  budgetTokens: number;
  retainedMessages: number;
  rawMessages: number;
  prunedMessages: number;
  memoryEntries: number;
  compactionCount: number;
  usageRatio: number;
};

export type ContextPolicy = {
  contextWindow: number;
  activeRatio: number;
  recentTurns: number;
  maxMemoryEntries: number;
};
