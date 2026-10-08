import type { LoopState } from "../loop/types";

export type Session = {
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  state: LoopState | undefined;
  status: "active" | "completed" | "interrupted" | "failed";
  stopReason?: string;
};

export type SessionSummary = Pick<
  Session,
  "id" | "name" | "title" | "createdAt" | "updatedAt" | "status" | "stopReason"
>;

export type SessionRetention = {
  maxSessions?: number;
  maxAgeMs?: number;
};
