import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PluginManifestSchema,
  validatePluginManifest,
  type PluginCapability,
  type PluginManifest,
} from "./manifest";
import { z } from "zod";

export const PluginStateSchema = z.enum([
  "DISCOVERED",
  "VALIDATED",
  "INSTALLED",
  "DISABLED",
  "ENABLED",
  "RUNNING",
  "STOPPED",
  "FAILED",
  "QUARANTINED",
  "UNINSTALLED",
]);
export type PluginState = z.infer<typeof PluginStateSchema>;

export const ManagedPluginSchema = z.object({
  schemaVersion: z.literal(1),
  manifest: PluginManifestSchema,
  state: PluginStateSchema,
  grantedCapabilities: z.array(z.string()),
  installedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  failureReason: z.string().optional(),
});
export type ManagedPlugin = z.infer<typeof ManagedPluginSchema>;

const transitions: Record<PluginState, readonly PluginState[]> = {
  DISCOVERED: ["VALIDATED", "QUARANTINED"],
  VALIDATED: ["INSTALLED", "QUARANTINED"],
  INSTALLED: ["ENABLED", "DISABLED", "UNINSTALLED"],
  DISABLED: ["ENABLED", "UNINSTALLED"],
  ENABLED: ["RUNNING", "DISABLED", "FAILED", "QUARANTINED"],
  RUNNING: ["STOPPED", "FAILED", "QUARANTINED"],
  STOPPED: ["ENABLED", "DISABLED", "UNINSTALLED"],
  FAILED: ["DISABLED", "QUARANTINED", "UNINSTALLED"],
  QUARANTINED: ["UNINSTALLED"],
  UNINSTALLED: [],
};

const pluginFile = (directory: string, id: string) =>
  join(directory, `${id}.json`);
const timestamp = () => new Date().toISOString();

async function save(path: string, plugin: ManagedPlugin) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(plugin, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class PluginManager {
  constructor(
    private readonly directory: string,
    private readonly options: {
      chikuApiVersion: string;
      platform: NodeJS.Platform;
    },
  ) {}

  async discover(value: unknown) {
    const manifest = PluginManifestSchema.parse(value);
    const plugin = ManagedPluginSchema.parse({
      schemaVersion: 1,
      manifest,
      state: "DISCOVERED",
      grantedCapabilities: [],
      installedAt: timestamp(),
      updatedAt: timestamp(),
    });
    await save(pluginFile(this.directory, manifest.id), plugin);
    return plugin;
  }

  async load(id: string): Promise<ManagedPlugin | undefined> {
    try {
      return ManagedPluginSchema.parse(
        JSON.parse(await readFile(pluginFile(this.directory, id), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  async validate(id: string) {
    const plugin = await this.require(id);
    validatePluginManifest(plugin.manifest, this.options);
    return this.transition(plugin, "VALIDATED");
  }

  async install(id: string) {
    const plugin = await this.require(id);
    if (plugin.state !== "VALIDATED")
      throw new Error(`plugin ${id} must be validated before installation`);
    if (plugin.manifest.type !== "declarative")
      throw new Error(
        "executable plugins require an approved isolated execution host",
      );
    return this.transition(plugin, "INSTALLED");
  }

  async grant(id: string, capabilities: readonly PluginCapability[]) {
    const plugin = await this.require(id);
    const requested = new Set(plugin.manifest.requiredCapabilities);
    for (const capability of capabilities) {
      if (
        !requested.has(capability) &&
        !plugin.manifest.optionalCapabilities.includes(capability)
      )
        throw new Error(
          `plugin ${id} did not declare capability ${capability}`,
        );
    }
    const updated = ManagedPluginSchema.parse({
      ...plugin,
      grantedCapabilities: [
        ...new Set([...plugin.grantedCapabilities, ...capabilities]),
      ],
      updatedAt: timestamp(),
    });
    await save(pluginFile(this.directory, id), updated);
    return updated;
  }

  async transitionById(id: string, state: PluginState, failureReason?: string) {
    return this.transition(await this.require(id), state, failureReason);
  }

  private async transition(
    plugin: ManagedPlugin,
    state: PluginState,
    failureReason?: string,
  ) {
    if (!transitions[plugin.state].includes(state))
      throw new Error(`illegal plugin transition: ${plugin.state} -> ${state}`);
    const updated = ManagedPluginSchema.parse({
      ...plugin,
      state,
      updatedAt: timestamp(),
      ...(failureReason ? { failureReason } : {}),
    });
    await save(pluginFile(this.directory, plugin.manifest.id), updated);
    return updated;
  }

  private async require(id: string) {
    const plugin = await this.load(id);
    if (!plugin) throw new Error(`plugin not found: ${id}`);
    return plugin;
  }
}
