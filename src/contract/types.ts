import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = 1;

const FileChangeSchema = z.object({
  path: z.string().min(1),
  operation: z.enum(["create", "modify", "delete", "rename"]),
  originalExists: z.boolean(),
  originalHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  proposedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  mode: z.number().int().nonnegative().nullable(),
});

const ComponentSchema = z.object({
  path: z.string().min(1),
  symbols: z.array(z.string()),
  dependencies: z.array(z.string()),
});

const PreconditionSchema = z.object({
  kind: z.enum([
    "repository_identity",
    "workspace_boundary",
    "file_existence",
    "file_hash",
    "file_permissions",
    "patch_compatibility",
    "git_status",
    "symbol_dependency",
  ]),
  target: z.string().min(1),
  expected: z.string(),
});

const ImpactSchema = z.object({
  changedFiles: z.array(z.string()),
  dependentFiles: z.array(z.string()),
  symbols: z.array(z.string()),
  reasons: z.array(z.string()),
});

const RiskSchema = z.object({
  level: z.enum(["low", "medium", "high", "critical"]),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
});

const PermissionRequirementSchema = z.object({
  capability: z.enum([
    "read",
    "create",
    "modify",
    "delete",
    "execute",
    "external",
  ]),
  target: z.string().min(1),
  explanation: z.string().min(1),
  risk: z.enum(["normal", "high"]),
});

const VerificationPlanSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  required: z.boolean(),
});

const RollbackSchema = z.object({
  strategy: z.enum(["patch-undo-token", "manual-recovery", "none"]),
  undoToken: z.string().nullable(),
  notes: z.string().min(1),
});

const OutcomeSchema = z.object({
  status: z.enum(["accepted", "rejected", "failed", "recovered"]),
  reason: z.string().min(1),
  changedFiles: z.array(z.string()),
});

export const ChangeContractSchema = z.object({
  contractId: z.string().uuid(),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  userRequest: z.string().min(1),
  objective: z.string().min(1),
  workspaceRoot: z.string().min(1),
  repositoryIdentity: z.string().min(1),
  proposedPatch: z.string().min(1),
  proposedFiles: z.array(FileChangeSchema).min(1),
  affectedComponents: z.array(ComponentSchema),
  preconditions: z.array(PreconditionSchema),
  impactAnalysis: ImpactSchema,
  riskAssessment: RiskSchema,
  permissionRequirements: z.array(PermissionRequirementSchema),
  verificationPlan: z.array(VerificationPlanSchema),
  rollback: RollbackSchema,
  status: z.enum([
    "proposed",
    "approved",
    "executing",
    "verifying",
    "accepted",
    "rejected",
    "failed",
    "recovered",
  ]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  evidenceReferences: z.array(z.string()),
  outcome: OutcomeSchema.nullable(),
});

export type ChangeContract = z.infer<typeof ChangeContractSchema>;
export type ContractFileChange = z.infer<typeof FileChangeSchema>;
export type ContractPrecondition = z.infer<typeof PreconditionSchema>;
export type ContractOutcome = z.infer<typeof OutcomeSchema>;

export type ContractValidation =
  | { valid: true; contract: ChangeContract }
  | { valid: false; errors: string[] };

export function validateContract(value: unknown): ContractValidation {
  const parsed = ChangeContractSchema.safeParse(value);
  if (parsed.success) return { valid: true, contract: parsed.data };
  return {
    valid: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "contract"}: ${issue.message}`,
    ),
  };
}

export function serializeContract(contract: ChangeContract): string {
  const validated = ChangeContractSchema.parse(contract);
  return JSON.stringify(validated, null, 2) + "\n";
}

export function deserializeContract(value: string): ChangeContract {
  return ChangeContractSchema.parse(JSON.parse(value));
}

export function reviseContract(
  previous: ChangeContract,
  changes: Partial<ChangeContract>,
): ChangeContract {
  const next = ChangeContractSchema.parse({
    ...previous,
    ...changes,
    contractId: previous.contractId,
    schemaVersion: previous.schemaVersion,
    revision: previous.revision + 1,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
  });
  return next;
}

export function compareContracts(
  left: ChangeContract,
  right: ChangeContract,
): string[] {
  const changed: string[] = [];
  const fields: (keyof ChangeContract)[] = [
    "taskId",
    "sessionId",
    "userRequest",
    "objective",
    "workspaceRoot",
    "repositoryIdentity",
    "proposedPatch",
    "proposedFiles",
    "affectedComponents",
    "preconditions",
    "impactAnalysis",
    "riskAssessment",
    "permissionRequirements",
    "verificationPlan",
    "rollback",
    "status",
    "evidenceReferences",
    "outcome",
  ];
  for (const field of fields)
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field]))
      changed.push(field);
  return changed;
}
