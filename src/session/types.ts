import type { LoopState } from "../loop/types";
import type { SkillLifecycleState } from "../skill/lifecycle";

export type Session = {
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  state: LoopState | undefined;
  skills?: SkillLifecycleState;
  status: "active" | "completed" | "interrupted" | "failed";
  stopReason?: string;
  /** Persisted MCP metadata only; credentials and live transport handles are excluded. */
  mcpServers?: Array<{
    id: string;
    transport: "stdio" | "streamable-http";
    command?: string;
    args: string[];
    cwd?: string;
    url?: string;
    enabled: boolean;
    allowedTools: string[];
  }>;
};

export type SessionSummary = Pick<
  Session,
  "id" | "name" | "title" | "createdAt" | "updatedAt" | "status" | "stopReason"
>;

export type SessionRetention = {
  maxSessions?: number;
  maxAgeMs?: number;
};
