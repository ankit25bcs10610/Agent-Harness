import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { platform } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  ProcessFailure,
  ProcessRequest,
  ProcessResult,
  PreparedProcess,
} from "./types";
import { isolationRegistry, IsolationRegistry } from "./isolation";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const SENSITIVE_ENV =
  /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE)/i;
function containsShellSyntax(command: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaping = false;
  for (const char of command) {
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (/[|;&<>`$()\n\r]/.test(char)) {
      return true;
    }
  }
  return false;
}

export function isSensitiveEnvironmentKey(key: string): boolean {
  return SENSITIVE_ENV.test(key);
}

export function filterEnvironment(
  values: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(
      ([key]) => !isSensitiveEnvironmentKey(key),
    ),
  );
}

function splitCommand(command: string): [string, string[]] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
    } else if (char === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (escaping || quote)
    throw new Error("command has an unterminated escape or quote");
  if (current) parts.push(current);
  if (!parts[0]) throw new Error("command is empty");
  return [parts[0], parts.slice(1)];
}

function appendLimited(current: string, chunk: Buffer | string, limit: number) {
  const remaining = Math.max(0, limit - current.length);
  return (
    current +
    (typeof chunk === "string"
      ? chunk.slice(0, remaining)
      : chunk.toString("utf8", 0, remaining))
  );
}

function terminateProcess(child: ReturnType<typeof spawn>): void {
  if (child.killed) return;
  if (platform() === "win32") {
    child.kill();
    return;
  }
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // The process tree has already exited.
    }
  }, 250).unref();
}

export class ProcessExecutor {
  constructor(
    private readonly isolation: IsolationRegistry = isolationRegistry,
  ) {}

  async run(
    request: ProcessRequest,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const started = Date.now();
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputChars = request.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive finite number");
    }
    if (!Number.isInteger(maxOutputChars) || maxOutputChars <= 0) {
      throw new Error("maxOutputChars must be a positive integer");
    }

    let prepared: PreparedProcess;
    try {
      prepared = await this.isolation.prepare(request);
    } catch (error) {
      return {
        stdout: "",
        stderr:
          error instanceof Error ? error.message : "isolation unavailable",
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        truncated: false,
        failure: "isolation_unavailable",
      };
    }

    const shell = request.shell ?? false;
    if (!shell && containsShellSyntax(request.command)) {
      return {
        stdout: "",
        stderr: "Complex shell syntax requires shell: true",
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        truncated: false,
        failure: "spawn",
      };
    }
    const [file, args] = shell
      ? [request.command, []]
      : splitCommand(request.command);
    let cwd: string | undefined;
    if (request.cwd ?? prepared.cwd) {
      const requestedCwd = request.cwd ?? prepared.cwd!;
      try {
        cwd = await realpath(
          isAbsolute(requestedCwd)
            ? requestedCwd
            : resolve(process.cwd(), requestedCwd),
        );
        const relativeCwd = relative(await realpath(process.cwd()), cwd);
        if (relativeCwd.startsWith("..") || isAbsolute(relativeCwd)) {
          throw new Error("working directory must be inside the workspace");
        }
      } catch (error) {
        return {
          stdout: "",
          stderr:
            error instanceof Error
              ? error.message
              : "invalid working directory",
          exitCode: null,
          signal: null,
          durationMs: Date.now() - started,
          truncated: false,
          failure: "spawn",
        };
      }
    }
    const environment = {
      ...filterEnvironment(process.env as Record<string, string>),
      ...filterEnvironment(request.env),
      ...filterEnvironment(prepared.env as Record<string, string> | undefined),
    };
    const child = spawn(file, args, {
      cwd,
      env: environment,
      shell,
      detached: platform() !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let failure: ProcessFailure | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      failure = "timeout";
      terminateProcess(child);
    }, timeoutMs);
    const cancel = () => {
      failure = "cancelled";
      terminateProcess(child);
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });

    const result = await new Promise<ProcessResult>((resolve) => {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendLimited(stdout, chunk, maxOutputChars);
        if (stdout.length >= maxOutputChars && !truncated) {
          truncated = true;
          failure ??= "output_limit";
          terminateProcess(child);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendLimited(stderr, chunk, maxOutputChars);
        if (stderr.length >= maxOutputChars && !truncated) {
          truncated = true;
          failure ??= "output_limit";
          terminateProcess(child);
        }
      });
      child.on("error", (error) => {
        failure ??= "spawn";
        stderr = appendLimited(stderr, error.message, maxOutputChars);
      });
      child.on("close", (exitCode, exitSignal) => {
        if (timer) clearTimeout(timer);
        if (truncated && !failure) failure = "output_limit";
        if (exitCode !== 0 && !failure) failure = "exit";
        const completed: ProcessResult = {
          stdout,
          stderr,
          exitCode,
          signal: exitSignal,
          durationMs: Date.now() - started,
          truncated,
        };
        if (failure) completed.failure = failure;
        resolve(completed);
      });
    });
    signal?.removeEventListener("abort", cancel);
    return result;
  }
}
