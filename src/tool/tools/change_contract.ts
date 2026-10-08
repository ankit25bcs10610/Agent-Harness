import { z } from "zod";
import { buildRepositoryIndex } from "../../intelligence";
import {
  loadContract,
  listContracts,
  saveContract,
} from "../../contract/store";
import { planChange } from "../../contract/planner";
import { validateContractPreconditions } from "../../contract/preconditions";
import type { Tool } from "../types";

const root = z.string().optional();
const permission = (operation: string, target: unknown) => ({
  capability: "read" as const,
  target: typeof target === "string" ? target : ".",
  explanation: `${operation} change contract metadata and repository evidence`,
  risk: "normal" as const,
});

export const createChangeContract: Tool<any, unknown> = {
  name: "create_change_contract",
  description:
    "Create and persist a validated change contract from an actual unified patch. The patch is dry-run checked, repository evidence is collected, and preconditions are recorded.",
  parameters: z.object({
    root,
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    userRequest: z.string().min(1),
    objective: z.string().min(1),
    patch: z.string().min(1),
  }),
  getPermissionKey: (args) => permission("Inspect", args.root),
  execute: async (args: any) => {
    const contract = await planChange({
      root: args.root ?? process.cwd(),
      taskId: args.taskId,
      sessionId: args.sessionId,
      userRequest: args.userRequest,
      objective: args.objective,
      patch: args.patch,
    });
    const path = await saveContract(contract);
    return {
      contractId: contract.contractId,
      revision: contract.revision,
      status: contract.status,
      path,
      proposedFiles: contract.proposedFiles,
      riskAssessment: contract.riskAssessment,
      verificationPlan: contract.verificationPlan,
      permissionRequirements: contract.permissionRequirements,
    };
  },
};

export const validateChangeContract: Tool<any, unknown> = {
  name: "validate_change_contract",
  description:
    "Validate a persisted change contract against the current workspace and file hashes.",
  parameters: z.object({ contractId: z.string().uuid(), root }),
  getPermissionKey: (args) => permission("Validate", args.root),
  execute: async (args: any) => {
    const contract = await loadContract(args.contractId);
    if (!contract)
      throw new Error(`change contract not found: ${args.contractId}`);
    const results = await validateContractPreconditions(
      contract,
      args.root ?? process.cwd(),
    );
    return {
      contractId: contract.contractId,
      revision: contract.revision,
      valid: results.every((result) => result.passed),
      results,
    };
  },
};

export const listChangeContracts: Tool<any, unknown> = {
  name: "list_change_contracts",
  description:
    "List the latest immutable revision of persisted change contracts.",
  parameters: z.object({}),
  getPermissionKey: () => permission("List", ".chiku/contracts"),
  execute: async () =>
    (await listContracts()).map((contract) => ({
      contractId: contract.contractId,
      revision: contract.revision,
      taskId: contract.taskId,
      objective: contract.objective,
      status: contract.status,
      risk: contract.riskAssessment.level,
      updatedAt: contract.updatedAt,
    })),
};
