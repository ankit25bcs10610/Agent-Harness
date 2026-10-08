import type { ToolCall } from "../provider";
import type { ProcessResult } from "../process/types";

export type WorkflowPhase =
  | "task_intake"
  | "repository_inspection"
  | "plan"
  | "proposed_changes"
  | "permission_evaluation"
  | "patch_execution"
  | "verification"
  | "failure_analysis"
  | "bounded_repair"
  | "final_evidence";

export type VerificationStatus = "passed" | "failed" | "untested";

export type VerificationCheck = {
  name: string;
  command: string;
  status: VerificationStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  reason?: string;
};

export type VerificationReport = {
  phase: "final_evidence";
  changedFiles: string[];
  plannedFiles: string[];
  checks: VerificationCheck[];
  repairAttempts: number;
  passed: boolean;
  remainingRisks: string[];
};

export type WorkflowPolicy = {
  root: string;
  plannedFiles?: string[];
  maxRepairAttempts: number;
  commandTimeoutMs: number;
  maxOutputChars: number;
  enabled: boolean;
};

export type WorkflowEvents = {
  onPhase?: (phase: WorkflowPhase) => void;
  onVerification?: (check: VerificationCheck) => void;
};

export type RepairHook = (
  report: VerificationReport,
  signal: AbortSignal,
) => Promise<boolean>;

export type WorkflowController = {
  recordToolCall: (call: ToolCall) => void;
  finalize: (
    stopReason: string,
    signal: AbortSignal,
  ) => Promise<VerificationReport | undefined>;
};

export type ProcessVerification = (
  command: string,
  signal: AbortSignal,
) => Promise<ProcessResult>;
