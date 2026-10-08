import { z } from "zod";

export const WorkspaceStatusSchema = z.enum([
  "CREATING",
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "SUSPENDED",
  "INTEGRATING",
  "INTEGRATED",
  "CONFLICTED",
  "RECOVERY_REQUIRED",
  "REMOVAL_PENDING",
  "REMOVED",
]);

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const WorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  repositoryIdentity: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1).nullable(),
  detached: z.boolean(),
  baseCommit: z.string().min(1),
  currentHead: z.string().min(1).nullable(),
  status: WorkspaceStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  contractIds: z.array(z.string().uuid()),
  verification: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["passed", "failed", "untested"]),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().nonnegative(),
    }),
  ),
  approval: z.enum(["not_requested", "pending", "approved", "denied"]),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export type RepositoryMetadata = {
  isRepository: boolean;
  root: string;
  commonDirectory?: string;
  currentWorktree?: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  untracked: string[];
  worktrees: { path: string; head?: string; branch?: string; bare: boolean }[];
  gitVersion?: string;
  capabilities: string[];
  identity: string;
};

export type WorkspaceExecutionContext = {
  workspaceId: string;
  repositoryIdentity: string;
  authorizedRoot: string;
  cwd: string;
  sessionId: string;
  taskId: string;
  signal: AbortSignal;
  executionLimits: { wallClockMs?: number; maxTokens?: number };
  contractIds: string[];
};

export type WorkspaceDiff = {
  workspaceId: string;
  status: string;
  diff: string;
  changedFiles: string[];
  untrackedFiles: string[];
  additions: number;
  deletions: number;
};

export type ConflictReport = {
  workspaceId: string;
  target: string;
  category:
    | "same_file"
    | "delete_modify"
    | "rename"
    | "stale_base"
    | "untracked"
    | "dirty_target"
    | "binary"
    | "apply_check";
  files: string[];
  sourceBase: string;
  targetHead: string;
  details: string;
  options: ("cancel" | "review" | "resolve")[];
};

export type IntegrationResult = {
  workspaceId: string;
  target: string;
  applied: boolean;
  changedFiles: string[];
  conflict?: ConflictReport;
  verificationRequired: boolean;
};
