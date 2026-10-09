import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { PluginManager } from "../../src/plugin";

const manifest = {
  manifestVersion: 1,
  id: "example.declarative",
  name: "Example",
  version: "1.0.0",
  publisher: { id: "example", name: "Example" },
  description: "Fixture",
  type: "declarative",
  requiredChikuApi: "1.0.0",
  platforms: ["darwin"],
  requiredCapabilities: ["workspace.read"],
  optionalCapabilities: [],
  resourceLimits: {
    maxRuntimeMs: 1000,
    maxOutputChars: 1000,
    maxStorageBytes: 1000,
  },
  license: "MIT",
};

test("plugin manager validates lifecycle and explicit capability grants", async () => {
  const manager = new PluginManager(
    await mkdtemp(join(tmpdir(), "chiku-plugin-")),
    { chikuApiVersion: "1.0.0", platform: "darwin" },
  );
  await manager.discover(manifest);
  await manager.validate(manifest.id);
  const installed = await manager.install(manifest.id);
  expect(installed.state).toBe("INSTALLED");
  const granted = await manager.grant(manifest.id, ["workspace.read"]);
  expect(granted.grantedCapabilities).toEqual(["workspace.read"]);
  await expect(manager.grant(manifest.id, ["shell.execute"])).rejects.toThrow(
    "did not declare capability",
  );
});

test("plugin manager refuses executable plugins without an isolated host", async () => {
  const manager = new PluginManager(
    await mkdtemp(join(tmpdir(), "chiku-plugin-")),
    { chikuApiVersion: "1.0.0", platform: "darwin" },
  );
  await manager.discover({
    ...manifest,
    id: "example.tool",
    type: "tool",
    entryPoint: "dist/index.js",
  });
  await manager.validate("example.tool");
  await expect(manager.install("example.tool")).rejects.toThrow(
    "isolated execution host",
  );
});
