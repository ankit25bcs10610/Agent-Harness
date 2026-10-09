import { expect, test } from "bun:test";
import {
  diagnoseProvider,
  helpText,
  installationStatus,
  parseArgs,
  setupText,
} from "../src/cli";
import { loadCliConfig } from "../src/cli-config";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

test("CLI help and version parsing are provider-independent", () => {
  expect(parseArgs(["--help"]).command).toBe("help");
  expect(parseArgs(["--version"]).command).toBe("version");
  expect(helpText()).toContain("--workspace <path>");
  expect(parseArgs(["setup"]).command).toBe("setup");
  expect(parseArgs(["install-status"]).command).toBe("install-status");
  expect(parseArgs(["local-status"]).command).toBe("local-status");
  expect(parseArgs(["test-discover"]).command).toBe("test-discover");
  expect(helpText()).toContain("test-discover");
  expect(setupText("/tmp/project")).toContain("Credentials are never written");
  expect(setupText("/tmp/project")).toContain("Review permission prompts");
  expect(setupText("/tmp/project")).toContain("chiku doctor");
  expect(installationStatus("/tmp/project").workspace).toBe("/tmp/project");
});

test("CLI validates options and preserves explicit runtime configuration", () => {
  const options = parseArgs([
    "--workspace",
    "/tmp/project",
    "--model",
    "openai/gpt-4o",
    "--provider",
    "openrouter",
    "--continue",
    "--no-color",
  ]);
  expect(options.workspace).toBe(resolve("/tmp/project"));
  expect(options.model).toBe("openai/gpt-4o");
  expect(options.continueSession).toBe(true);
  expect(() => parseArgs(["--unknown"])).toThrow("unknown option");
  expect(() => parseArgs(["--provider", "unknown"])).toThrow("not configured");
});

test("configuration loads from an explicit file without persisting credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-cli-config-"));
  const path = join(directory, "config.json");
  await writeFile(
    path,
    JSON.stringify({ model: "local/model", provider: "ollama" }),
  );
  const config = await loadCliConfig(path);
  expect(config).toEqual({ model: "local/model", provider: "ollama" });
  await rm(directory, { recursive: true, force: true });
});

test("provider diagnostics distinguish configured model availability", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only";
  try {
    const available = await diagnoseProvider(
      "openai/gpt-4o",
      async () =>
        new Response(JSON.stringify({ data: [{ id: "openai/gpt-4o" }] }), {
          status: 200,
        }),
    );
    expect(available.status).toBe("AVAILABLE");
    const unsupported = await diagnoseProvider(
      "missing/model",
      async () =>
        new Response(JSON.stringify({ data: [{ id: "openai/gpt-4o" }] }), {
          status: 200,
        }),
    );
    expect(unsupported.status).toBe("UNSUPPORTED");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
