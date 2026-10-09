import { z } from "zod";

export const RemoteWorkspaceStateSchema = z.enum([
  "REQUESTED",
  "PROVISIONING",
  "READY",
  "RUNNING",
  "PAUSED",
  "FAILED",
  "STOPPING",
  "STOPPED",
  "EXPIRED",
]);
export type RemoteWorkspaceState = z.infer<typeof RemoteWorkspaceStateSchema>;

export const ResourceQuotaSchema = z.object({
  cpuMillis: z.number().int().positive().max(64_000),
  memoryBytes: z
    .number()
    .int()
    .positive()
    .max(1_024 * 1_024 * 1_024 * 128),
  diskBytes: z
    .number()
    .int()
    .positive()
    .max(1_024 * 1_024 * 1_024 * 1_024),
  processCount: z.number().int().positive().max(10_000),
  wallClockMs: z.number().int().positive().max(86_400_000),
  allowNetwork: z.boolean(),
});
export type ResourceQuota = z.infer<typeof ResourceQuotaSchema>;

export const RemoteWorkspaceSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string().uuid(),
  organizationId: z.string().min(1),
  ownerId: z.string().min(1),
  repositoryIdentity: z.string().min(1),
  sourceRevision: z.string().min(1),
  runtimeImage: z.string().min(1),
  state: RemoteWorkspaceStateSchema,
  quota: ResourceQuotaSchema,
  sourceTransferConsent: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  activeLeaseId: z.string().uuid().nullable(),
});
export type RemoteWorkspace = z.infer<typeof RemoteWorkspaceSchema>;

export const TaskLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  taskId: z.string().min(1),
  workerId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  attempt: z.number().int().positive(),
  sideEffectsUncertain: z.boolean(),
});
export type TaskLease = z.infer<typeof TaskLeaseSchema>;

export type SourceTransferPolicy = {
  consent: boolean;
  include: readonly string[];
  exclude: readonly string[];
  maxBytes: number;
};

export type SnapshotFile = { path: string; bytes: number; sha256: string };
export type WorkspaceSnapshot = {
  workspaceId: string;
  sourceRevision: string;
  files: SnapshotFile[];
  totalBytes: number;
  digest: string;
};
