import type { z, ZodRawShape } from "zod";
import type { Asker, PermissionKey, PermSession } from "../permission/types";
import type { WorkspaceExecutionContext } from "../workspace/types";

export type Tool<
  TParams extends ZodRawShape = ZodRawShape,
  TResult = unknown,
> = {
  name: string;
  description: string;
  parameters: z.ZodObject<TParams>;
  getPermissionKey: (
    args: z.infer<z.ZodObject<TParams>>,
  ) => PermissionKey | undefined;
  getPermissionKeys?: (args: z.infer<z.ZodObject<TParams>>) => PermissionKey[];
  execute: (
    args: z.infer<z.ZodObject<TParams>>,
    signal: AbortSignal,
    context?: ToolContext,
  ) => Promise<TResult>;
};

export type ToolContext = {
  permissions: PermSession;
  asker: Asker;
  signal: AbortSignal;
  maxOutputChars: number;
  workspace?: WorkspaceExecutionContext;
  /** Runtime capability boundary for delegated agents. Omitted for normal single-agent mode. */
  allowedTools?: readonly string[];
  /** Required contract binding for delegated write tasks. */
  requiredContractId?: string;
  /** Internal marker set only after the central permission engine approves a tool. */
  permissionGranted?: boolean;
};
