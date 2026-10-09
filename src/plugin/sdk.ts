import { z, type ZodObject, type ZodRawShape } from "zod";
import type { PluginCapability } from "./manifest";
import type { PermissionKey } from "../permission/types";
import type { Tool } from "../tool/types";

/** Versioned public extension API. Keep changes additive within this major. */
export const CHIKU_EXTENSION_API_VERSION = "1.0.0" as const;

export type ExtensionProgress = {
  stage: string;
  completed?: number;
  total?: number;
};

export type ExtensionToolContext = {
  signal: AbortSignal;
  reportProgress?: (progress: ExtensionProgress) => void;
  /** Extension-owned state must remain inside the host-provided namespace. */
  storageNamespace: string;
};

export type ExtensionToolDefinition<Shape extends ZodRawShape, Result> = {
  /** Names must be namespaced to avoid collisions with Chiku core tools. */
  name: `${string}.${string}`;
  description: string;
  parameters: ZodObject<Shape>;
  capability: PluginCapability;
  declaredCapabilities: readonly PluginCapability[];
  getPermissionKey: (
    args: z.infer<ZodObject<Shape>>,
  ) => PermissionKey | undefined;
  execute: (
    args: z.infer<ZodObject<Shape>>,
    context: ExtensionToolContext,
  ) => Promise<Result>;
};

function validateName(name: string) {
  if (
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(
      name,
    )
  )
    throw new Error("extension tool name must be a lowercase namespace.name");
}

/**
 * Adapts an extension tool to Chiku's existing centrally-authorized Tool
 * contract. It does not grant permissions or execute code by itself.
 */
export function defineExtensionTool<Shape extends ZodRawShape, Result>(
  definition: ExtensionToolDefinition<Shape, Result>,
): Tool<Shape, Result> {
  validateName(definition.name);
  if (!definition.description.trim())
    throw new Error("extension tool description is required");
  if (!definition.declaredCapabilities.includes(definition.capability))
    throw new Error(
      `extension tool ${definition.name} requires declared capability ${definition.capability}`,
    );
  const extensionContext = (context?: {
    reportProgress?: ExtensionToolContext["reportProgress"];
  }): Omit<ExtensionToolContext, "signal"> => ({
    storageNamespace: `plugin:${definition.name}`,
    ...(context?.reportProgress
      ? { reportProgress: context.reportProgress }
      : {}),
  });
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    getPermissionKey: definition.getPermissionKey,
    execute: (args, signal, context) =>
      definition.execute(args, {
        ...extensionContext(context),
        signal,
      }),
  };
}
