import { z } from "zod";

export const MigrationSpecSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    technology: z.string().min(1),
    version: z.string().min(1),
  }),
  target: z.object({
    technology: z.string().min(1),
    version: z.string().min(1),
  }),
  goals: z.array(z.string().min(1)).min(1),
  breakingChangeTolerance: z.enum(["none", "approved", "allowed"]),
  approvedFiles: z.array(z.string().min(1)).default([]),
  dependencyConstraints: z.record(z.string(), z.string()).default({}),
  requiredChecks: z.array(z.string().min(1)).default([]),
  maxSteps: z.number().int().positive().default(20),
  maxRepairAttempts: z.number().int().nonnegative().default(1),
  humanApprovalRequired: z.boolean().default(true),
});
export type MigrationSpec = z.infer<typeof MigrationSpecSchema>;

export type TechnologyEvidence = {
  kind: "language" | "framework" | "package_manager" | "build" | "test";
  name: string;
  version: string | null;
  source: string;
  confidence: "observed" | "declared";
};

export type DependencyRecord = {
  name: string;
  requestedVersion: string;
  resolvedVersion: string | null;
  kind:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  source: string;
};

export type ProjectInventory = {
  root: string;
  evidence: TechnologyEvidence[];
  dependencies: DependencyRecord[];
  sourceFiles: string[];
  publicFiles: string[];
  lockfile: string | null;
  verificationCommands: { name: string; command: string }[];
};

export type MigrationRiskLevel =
  "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type MigrationRisk = {
  level: MigrationRiskLevel;
  reasons: string[];
  affectedFiles: string[];
};

export type MigrationStep = {
  id: string;
  description: string;
  dependsOn: string[];
  requiresApproval: boolean;
  verification: string[];
};

export type MigrationPlan = {
  spec: MigrationSpec;
  steps: MigrationStep[];
  risk: MigrationRisk;
  uncertain: string[];
};

export type MigrationBaseline = {
  capturedAt: string;
  root: string;
  revision: string | null;
  dirty: boolean;
  changedFiles: string[];
  lockfile: string | null;
  checks: {
    name: string;
    command: string;
    status: "passed" | "failed" | "untested";
    reason?: string;
  }[];
};

export type TransformationResult = {
  changed: boolean;
  files: string[];
  diff: string;
  reason?: string;
};
