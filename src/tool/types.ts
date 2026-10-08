import type { z, ZodRawShape } from "zod";
import type { Asker, PermissionKey, PermSession } from "../permission/types";

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
  execute: (
    args: z.infer<z.ZodObject<TParams>>,
    signal: AbortSignal,
  ) => Promise<TResult>;
};

export type ToolContext = {
  permissions: PermSession;
  asker: Asker;
  signal: AbortSignal;
  maxOutputChars: number;
};
