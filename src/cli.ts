import { existsSync, accessSync, constants, readFileSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { loadCliConfig } from "./cli-config";
import { CONFIG } from "./config";
import { deploymentCapabilities, loadOperationalConfig } from "./ops";
import { inventoryTests } from "./testing";
import {
  detectHardware,
  inspectLocalEndpoint,
  localEndpointFromEnv,
} from "./provider";

export type CliOptions = {
  command:
    | "run"
    | "help"
    | "version"
    | "doctor"
    | "setup"
    | "install-status"
    | "local-status"
    | "test-discover"
    | "eval-run";
  model?: string;
  provider?: string;
  workspace?: string;
  config?: string;
  continueSession: boolean;
  verbose: boolean;
  noColor: boolean;
  taskFile?: string;
  resultFile?: string;
  timeoutMs?: number;
};

function installedVersion() {
  if (process.env.CHIKU_VERSION) return process.env.CHIKU_VERSION;
  try {
    return (
      JSON.parse(
        readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return "unknown";
  }
}
export const VERSION = installedVersion();

export function helpText() {
  return `Chiku ${VERSION} — terminal-native AI coding agent

Usage:
  chiku [options]
  chiku doctor
  chiku setup
  chiku install-status
  chiku local-status
  chiku test-discover [--workspace <path>]
  chiku eval-run --workspace <path> --task-file <path> --result-file <path>

Options:
  --help                 Show this help without contacting a provider
  --version              Show the installed version
  --model <id>           Select the model for this run
  --provider <name>      Select the configured provider
  --workspace <path>     Run against a specific project directory
  --config <path>        Load a JSON configuration file
  --continue             Resume the newest compatible session
  --verbose              Enable diagnostic logging
  --no-color             Disable terminal color output
  --diagnostics          Alias for chiku doctor
  --task-file <path>     Task text for eval-run
  --result-file <path>   JSON evidence output for eval-run
  --timeout-ms <n>       Wall-clock budget for eval-run (default 120000)
`;
}

export function setupText(workspace = process.cwd()) {
  const checks = diagnostics(workspace);
  const status = (name: string) => checks.find((check) => check.name === name);
  const workspaceCheck = status("workspace");
  const providerCheck = status("provider credentials");
  const ready = checks.every((check) => check.status !== "FAIL");
  const localMode =
    process.env.CHIKU_PROVIDER === "local" ||
    process.env.CHIKU_MODEL?.startsWith("local/") === true;
  const providerName = localMode
    ? "Local OpenAI-compatible endpoint"
    : "OpenRouter";
  const providerNext = localMode
    ? process.env.CHIKU_LOCAL_BASE_URL
      ? "Run chiku local-status, then start Chiku with an explicitly selected local model."
      : "Set CHIKU_LOCAL_BASE_URL to a loopback OpenAI-compatible endpoint; Chiku will not fall back to the cloud."
    : providerCheck?.status === "PASS"
      ? "Run chiku doctor to validate provider reachability and model support."
      : "Set OPENROUTER_API_KEY in your shell or an ignored .env file, then run chiku doctor.";
  return `Chiku setup — local configuration

Workspace: ${workspace}
Workspace check: ${workspaceCheck?.status ?? "NOT_RUN"}
Provider: ${providerName}
Credentials: ${providerCheck?.detail ?? "not checked"}
Setup status: ${ready ? "ready for validation" : "action required"}

Next steps:
1. ${providerNext}
2. Review permission prompts before approving file changes or commands.
3. Start with: chiku --workspace "${workspace}"
4. Resume safely with: chiku --continue

Chiku setup is cancelable and makes no changes. Credentials are never written by this command.
Use chiku doctor for detailed runtime, storage, Git, and provider diagnostics.`;
}

export function installationStatus(workspace = process.cwd()) {
  const operational = loadOperationalConfig();
  return {
    version: VERSION,
    runtime: typeof Bun !== "undefined" ? `bun ${Bun.version}` : "unknown",
    platform: platform(),
    architecture: arch(),
    workspace,
    configurationDirectory: join(homedir(), ".chiku"),
    projectConfigurationDirectory: join(workspace, ".chiku"),
    git: Bun.which("git") ? "available" : "unavailable",
    credentialStorage: "environment-or-ignored-dotenv",
    sandbox: "not-provided-by-this-distribution",
    automaticUpdates: "not-enabled",
    installationMethod: process.env.CHIKU_VERSION
      ? "compiled-or-packaged"
      : "source-or-runtime",
    operationalEnvironment: operational.environment,
    hostedControlPlane: operational.hostedControlPlane,
    deploymentCapabilities: deploymentCapabilities().map(
      ({ mode, status }) => ({
        mode,
        status,
      }),
    ),
  } as const;
}

function value(args: readonly string[], index: number, flag: string) {
  const next = args[index + 1];
  if (!next || next.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return next;
}

export function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    command: "run",
    continueSession: false,
    verbose: false,
    noColor: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) throw new Error("missing command-line argument");
    if (arg === "--help" || arg === "-h") options.command = "help";
    else if (arg === "--version" || arg === "-v") options.command = "version";
    else if (arg === "doctor" || arg === "--diagnostics")
      options.command = "doctor";
    else if (arg === "setup") options.command = "setup";
    else if (arg === "install-status") options.command = "install-status";
    else if (arg === "local-status") options.command = "local-status";
    else if (arg === "test-discover") options.command = "test-discover";
    else if (arg === "eval-run") options.command = "eval-run";
    else if (arg === "--continue") options.continueSession = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--no-color") options.noColor = true;
    else if (arg === "--model") options.model = value(args, index++, arg);
    else if (arg === "--provider") options.provider = value(args, index++, arg);
    else if (arg === "--workspace")
      options.workspace = resolve(value(args, index++, arg));
    else if (arg === "--config")
      options.config = resolve(value(args, index++, arg));
    else if (arg === "--task-file")
      options.taskFile = resolve(value(args, index++, arg));
    else if (arg === "--result-file")
      options.resultFile = resolve(value(args, index++, arg));
    else if (arg === "--timeout-ms") {
      const raw = value(args, index++, arg);
      const timeoutMs = Number(raw);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
        throw new Error("--timeout-ms must be a positive integer");
      options.timeoutMs = timeoutMs;
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (options.provider && !["openrouter", "local"].includes(options.provider))
    throw new Error(`provider is not configured: ${options.provider}`);
  if (options.command === "eval-run") {
    if (!options.workspace) throw new Error("eval-run requires --workspace");
    if (!options.taskFile) throw new Error("eval-run requires --task-file");
    if (!options.resultFile) throw new Error("eval-run requires --result-file");
  }
  return options;
}

export function diagnostics(workspace = process.cwd()) {
  const projectChiku = join(workspace, ".chiku");
  const userChiku = join(homedir(), ".chiku");
  const localMode =
    process.env.CHIKU_PROVIDER === "local" ||
    process.env.CHIKU_MODEL?.startsWith("local/") === true;
  const localEndpoint = localEndpointFromEnv();
  const checks = [
    {
      name: "runtime",
      status: typeof Bun !== "undefined" ? "PASS" : "FAIL",
      detail: typeof Bun !== "undefined" ? Bun.version : "Bun is required",
    },
    {
      name: "operating system",
      status: "PASS",
      detail: `${platform()} ${release()}`,
    },
    {
      name: "git",
      status: Bun.which("git") ? "PASS" : "FAIL",
      detail: Bun.which("git") ?? "git not found",
    },
    {
      name: "workspace",
      status: existsSync(workspace) ? "PASS" : "FAIL",
      detail: workspace,
    },
    {
      name: "project storage",
      status: canWrite(projectChiku) ? "PASS" : "WARNING",
      detail: projectChiku,
    },
    {
      name: "user storage",
      status: canWrite(userChiku) ? "PASS" : "WARNING",
      detail: userChiku,
    },
    {
      name: "provider credentials",
      status: localMode
        ? localEndpoint && inspectLocalEndpoint(localEndpoint).allowed
          ? "PASS"
          : "WARNING"
        : process.env.OPENROUTER_API_KEY
          ? "PASS"
          : "WARNING",
      detail: localMode
        ? localEndpoint
          ? `local endpoint ${inspectLocalEndpoint(localEndpoint).reason}; reachability is not tested`
          : "local endpoint is not configured; cloud fallback is disabled"
        : process.env.OPENROUTER_API_KEY
          ? "configured"
          : "not configured; interactive requests will require setup",
    },
  ];
  return checks;
}

export type ProviderDiagnosticStatus =
  "AVAILABLE" | "CONFIGURATION_REQUIRED" | "UNREACHABLE" | "UNSUPPORTED";

export function providerDiagnosticExitCode(
  status: ProviderDiagnosticStatus,
): 0 | 1 {
  return status === "AVAILABLE" ? 0 : 1;
}

export async function diagnoseProvider(
  model = process.env.CHIKU_MODEL ?? CONFIG.loopModel,
  fetchImpl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  const localMode =
    env.CHIKU_PROVIDER === "local" || model.startsWith("local/");
  if (localMode) {
    const endpoint = localEndpointFromEnv(env);
    if (!endpoint)
      return {
        name: "provider",
        status: "CONFIGURATION_REQUIRED" as const,
        detail:
          "local provider selected but CHIKU_LOCAL_BASE_URL is not configured",
      };
    const inspection = inspectLocalEndpoint(endpoint);
    if (!inspection.allowed)
      return {
        name: "provider",
        status: "CONFIGURATION_REQUIRED" as const,
        detail: `local endpoint is not allowed: ${inspection.reason}`,
      };
    try {
      const response = await fetchImpl(
        `${endpoint.baseUrl.replace(/\/$/, "")}/models`,
        {
          headers: endpoint.apiKey
            ? { authorization: `Bearer ${endpoint.apiKey}` }
            : {},
          signal: AbortSignal.timeout(endpoint.timeoutMs ?? 10_000),
        },
      );
      if (!response.ok)
        return {
          name: "provider",
          status: "UNREACHABLE" as const,
          detail: `local model discovery returned HTTP ${response.status}`,
        };
      const body = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const requestedModel = model.startsWith("local/")
        ? model.slice("local/".length)
        : model;
      const supported =
        body.data?.some((entry) => entry.id === requestedModel) ?? false;
      return {
        name: "provider",
        status: supported ? ("AVAILABLE" as const) : ("UNSUPPORTED" as const),
        detail: supported
          ? `${model} is listed by the local endpoint`
          : `${model} is not listed by the local endpoint`,
      };
    } catch (error) {
      return {
        name: "provider",
        status: "UNREACHABLE" as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (!env.OPENROUTER_API_KEY)
    return {
      name: "provider",
      status: "CONFIGURATION_REQUIRED" as const,
      detail: "OPENROUTER_API_KEY is not configured",
    };
  try {
    const response = await fetchImpl("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
    if (!response.ok)
      return {
        name: "provider",
        status: "UNREACHABLE" as const,
        detail: `OpenRouter model discovery returned HTTP ${response.status}`,
      };
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const supported = body.data?.some((entry) => entry.id === model) ?? false;
    return {
      name: "provider",
      status: supported ? ("AVAILABLE" as const) : ("UNSUPPORTED" as const),
      detail: supported
        ? `${model} is listed by OpenRouter`
        : `${model} is not listed by OpenRouter`,
    };
  } catch (error) {
    return {
      name: "provider",
      status: "UNREACHABLE" as const,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return existsSync(path) ? false : canWrite(join(path, ".."));
  }
}

export async function main(args = process.argv.slice(2)) {
  let options: CliOptions;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(
      `chiku: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("Use --help for usage.");
    return 2;
  }
  if (options.noColor) process.env.NO_COLOR = "1";
  if (options.command === "help") {
    console.log(helpText());
    return 0;
  }
  if (options.command === "version") {
    console.log(VERSION);
    return 0;
  }
  if (options.command === "setup") {
    console.log(setupText(options.workspace ?? process.cwd()));
    return 0;
  }
  if (options.command === "install-status") {
    console.log(
      JSON.stringify(
        installationStatus(options.workspace ?? process.cwd()),
        null,
        2,
      ),
    );
    return 0;
  }
  if (options.command === "local-status") {
    const endpoint = localEndpointFromEnv();
    const inspection = endpoint
      ? inspectLocalEndpoint(endpoint)
      : {
          allowed: false,
          classification: "invalid" as const,
          reason: "CHIKU_LOCAL_BASE_URL is not configured",
        };
    console.log(
      JSON.stringify(
        {
          endpoint: endpoint
            ? { configured: true, ...inspection }
            : { configured: false, reason: inspection.reason },
          hardware: detectHardware(),
          cloudFallback: false,
          capabilities: "unknown until explicitly configured or probed",
        },
        null,
        2,
      ),
    );
    return inspection.allowed ? 0 : 1;
  }
  if (options.command === "doctor") {
    const checks = [
      ...diagnostics(options.workspace),
      await diagnoseProvider(),
    ];
    for (const check of checks)
      console.log(`${check.status.padEnd(7)} ${check.name}: ${check.detail}`);
    const provider = checks.at(-1);
    return checks.some((check) => check.status === "FAIL") ||
      (provider &&
        "status" in provider &&
        providerDiagnosticExitCode(
          provider.status as ProviderDiagnosticStatus,
        ) === 1)
      ? 1
      : 0;
  }
  if (options.workspace) {
    if (!existsSync(options.workspace)) {
      console.error(`chiku: workspace does not exist: ${options.workspace}`);
      return 2;
    }
    process.chdir(options.workspace);
  }
  if (options.command === "test-discover") {
    const inventory = await inventoryTests(process.cwd());
    console.log(JSON.stringify(inventory, null, 2));
    return inventory.framework.supported ? 0 : 1;
  }
  try {
    const fileConfig = await loadCliConfig(options.config);
    if (fileConfig.model && !options.model)
      process.env.CHIKU_MODEL = fileConfig.model;
    if (fileConfig.provider && !options.provider)
      process.env.CHIKU_PROVIDER = fileConfig.provider;
    if (fileConfig.noColor) process.env.NO_COLOR = "1";
  } catch (error) {
    console.error(
      `chiku: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  if (options.model) process.env.CHIKU_MODEL = options.model;
  if (options.provider) process.env.CHIKU_PROVIDER = options.provider;
  if (options.command === "eval-run") {
    try {
      const { runEvaluation } = await import("./eval-run");
      const evidence = await runEvaluation({
        workspace: process.cwd(),
        taskFile: options.taskFile!,
        resultFile: options.resultFile!,
        timeoutMs: options.timeoutMs ?? 120_000,
        ...(options.model ? { model: options.model } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
      });
      console.log(JSON.stringify(evidence, null, 2));
      return evidence.status === "COMPLETED" ? 0 : 1;
    } catch (error) {
      console.error(
        `chiku: evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  try {
    const { launch } = await import("./runtime");
    await launch(options);
    return 0;
  } catch (error) {
    console.error(
      `chiku: unable to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
