import { z } from "zod";

export const PluginTypeSchema = z.enum([
  "declarative",
  "skill",
  "tool",
  "workflow",
  "mcp",
  "ide",
]);
export type PluginType = z.infer<typeof PluginTypeSchema>;

export const PluginCapabilitySchema = z.enum([
  "workspace.read",
  "workspace.write",
  "shell.execute",
  "network.access",
  "git.read",
  "git.write",
  "provider.invoke",
  "mcp.invoke",
  "configuration.read",
  "plugin.storage",
  "workflow.register",
]);
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;

const safeId = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const safeRelativePath = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "must be a safe relative path",
  );

export const PluginManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: safeId,
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  publisher: z.object({ id: safeId, name: z.string().min(1).max(100) }),
  description: z.string().min(1).max(2_000),
  type: PluginTypeSchema,
  entryPoint: safeRelativePath.optional(),
  requiredChikuApi: z.string().regex(/^\d+\.\d+\.\d+$/),
  platforms: z.array(z.enum(["darwin", "linux", "win32"])).min(1),
  requiredCapabilities: z.array(PluginCapabilitySchema).max(20),
  optionalCapabilities: z.array(PluginCapabilitySchema).max(20),
  dependencies: z.record(safeId, z.string().min(1)).default({}),
  resourceLimits: z.object({
    maxRuntimeMs: z.number().int().positive().max(3_600_000),
    maxOutputChars: z.number().int().positive().max(1_000_000),
    maxStorageBytes: z.number().int().nonnegative().max(1_000_000_000),
  }),
  integrity: z
    .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .optional(),
  license: z.string().min(1).max(100),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export function validatePluginManifest(
  value: unknown,
  options: { chikuApiVersion: string; platform?: NodeJS.Platform },
) {
  const manifest = PluginManifestSchema.parse(value);
  const platform = options.platform ?? process.platform;
  if (!manifest.platforms.includes(platform as "darwin" | "linux" | "win32"))
    throw new Error(
      `plugin ${manifest.id} does not support platform ${platform}`,
    );
  if (manifest.type !== "declarative" && !manifest.entryPoint)
    throw new Error(`executable plugin ${manifest.id} requires an entryPoint`);
  if (manifest.type === "declarative" && manifest.entryPoint)
    throw new Error(
      `declarative plugin ${manifest.id} cannot declare an entryPoint`,
    );
  if (
    manifest.requiredCapabilities.some((capability) =>
      manifest.optionalCapabilities.includes(capability),
    )
  )
    throw new Error(
      `plugin ${manifest.id} duplicates required and optional capabilities`,
    );
  if (manifest.requiredChikuApi !== options.chikuApiVersion)
    throw new Error(
      `plugin ${manifest.id} requires Chiku API ${manifest.requiredChikuApi}, current API is ${options.chikuApiVersion}`,
    );
  return manifest;
}
