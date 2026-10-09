import { expect, test } from "bun:test";
import { validatePluginManifest } from "../../src/plugin";

const base = {
  manifestVersion: 1,
  id: "example.tool",
  name: "Example Tool",
  version: "1.0.0",
  publisher: { id: "example", name: "Example" },
  description: "A declarative fixture.",
  type: "declarative",
  requiredChikuApi: "1.0.0",
  platforms: ["darwin"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  resourceLimits: {
    maxRuntimeMs: 1000,
    maxOutputChars: 1000,
    maxStorageBytes: 0,
  },
  license: "MIT",
};

test("validates a declarative plugin without executing it", () => {
  expect(
    validatePluginManifest(base, {
      chikuApiVersion: "1.0.0",
      platform: "darwin",
    }).id,
  ).toBe("example.tool");
});

test("rejects unsafe entry points, incompatible APIs, and executable plugins without isolation metadata", () => {
  expect(() =>
    validatePluginManifest(
      { ...base, entryPoint: "../run.ts" },
      { chikuApiVersion: "1.0.0", platform: "darwin" },
    ),
  ).toThrow();
  expect(() =>
    validatePluginManifest(base, {
      chikuApiVersion: "2.0.0",
      platform: "darwin",
    }),
  ).toThrow("requires Chiku API");
  expect(() =>
    validatePluginManifest(
      { ...base, type: "tool" },
      { chikuApiVersion: "1.0.0", platform: "darwin" },
    ),
  ).toThrow("requires an entryPoint");
});
