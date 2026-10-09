import { expect, test } from "bun:test";
import {
  diagnoseProvider,
  helpText,
  installationStatus,
  parseArgs,
  providerDiagnosticExitCode,
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
  expect(
    parseArgs([
      "eval-run",
      "--workspace",
      "/tmp/project",
      "--task-file",
      "/tmp/task.txt",
      "--result-file",
      "/tmp/result.json",
    ]).command,
  ).toBe("eval-run");
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
  expect(() => parseArgs(["eval-run", "--workspace", "/tmp/project"])).toThrow(
    "task-file",
  );
});

test("configuration loads from an explicit file without persisting credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-cli-config-"));
  const path = join(directory, "config.json");
  await writeFile(
    path,
    JSON.stringify({ model: "local/model", provider: "local" }),
  );
  const config = await loadCliConfig(path);
  expect(config).toEqual({ model: "local/model", provider: "local" });
  await writeFile(path, JSON.stringify({ provider: "ollama" }));
  await expect(loadCliConfig(path)).rejects.toThrow("invalid Chiku config");
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

test("provider diagnostics honor local mode without requiring cloud credentials", async () => {
  const env = {
    CHIKU_PROVIDER: "local",
    CHIKU_LOCAL_BASE_URL: "http://127.0.0.1:11434/v1",
  };
  const available = await diagnoseProvider(
    "local/qwen",
    async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:11434/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "qwen" }] }), {
        status: 200,
      });
    },
    env,
  );
  expect(available).toEqual({
    name: "provider",
    status: "AVAILABLE",
    detail: "local/qwen is listed by the local endpoint",
  });
  const missingEndpoint = await diagnoseProvider("local/qwen", fetch, {
    CHIKU_PROVIDER: "local",
  });
  expect(missingEndpoint.status).toBe("CONFIGURATION_REQUIRED");
});

test("doctor treats every unavailable provider state as a nonzero result", () => {
  expect(providerDiagnosticExitCode("AVAILABLE")).toBe(0);
  expect(providerDiagnosticExitCode("CONFIGURATION_REQUIRED")).toBe(1);
  expect(providerDiagnosticExitCode("UNREACHABLE")).toBe(1);
  expect(providerDiagnosticExitCode("UNSUPPORTED")).toBe(1);
});
