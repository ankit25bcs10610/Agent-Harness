import { existsSync, accessSync, constants, readFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { loadCliConfig } from "./cli-config";

export type CliOptions = {
  command: "run" | "help" | "version" | "doctor";
  model?: string;
  provider?: string;
  workspace?: string;
  config?: string;
  continueSession: boolean;
  verbose: boolean;
  noColor: boolean;
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
`;
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
    else if (arg === "--continue") options.continueSession = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--no-color") options.noColor = true;
    else if (arg === "--model") options.model = value(args, index++, arg);
    else if (arg === "--provider") options.provider = value(args, index++, arg);
    else if (arg === "--workspace")
      options.workspace = resolve(value(args, index++, arg));
    else if (arg === "--config")
      options.config = resolve(value(args, index++, arg));
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (options.provider && options.provider !== "openrouter")
    throw new Error(`provider is not configured: ${options.provider}`);
  return options;
}

export function diagnostics(workspace = process.cwd()) {
  const projectChiku = join(workspace, ".chiku");
  const userChiku = join(homedir(), ".chiku");
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
      status: process.env.OPENROUTER_API_KEY ? "PASS" : "WARNING",
      detail: process.env.OPENROUTER_API_KEY
        ? "configured"
        : "not configured; interactive requests will require setup",
    },
  ];
  return checks;
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
  if (options.command === "doctor") {
    for (const check of diagnostics(options.workspace))
      console.log(`${check.status.padEnd(7)} ${check.name}: ${check.detail}`);
    return diagnostics(options.workspace).some(
      (check) => check.status === "FAIL",
    )
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
  const { launch } = await import("./runtime");
  await launch(options);
  return 0;
}
