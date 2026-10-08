import {
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform, release } from "node:os";
import { randomUUID } from "node:crypto";
import { redactProviderSecrets } from "../provider/errors";

export type CrashReport = {
  version: 1;
  id: string;
  occurredAt: string;
  event: "uncaught_exception" | "unhandled_rejection";
  error: { name: string; message: string; stack?: string };
  runtime: { platform: string; release: string; bun?: string };
};

const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 6_000;
const DEFAULT_MAX_REPORTS = 50;

export type CrashStorageOptions = {
  maxReports?: number;
};

function bounded(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeError(value: unknown): CrashReport["error"] {
  const error = value instanceof Error ? value : new Error(String(value));
  const redacted = redactProviderSecrets({
    name: error.name || "Error",
    message: bounded(error.message, MAX_MESSAGE_CHARS),
    ...(error.stack ? { stack: bounded(error.stack, MAX_STACK_CHARS) } : {}),
  }) as { name: string; message: string; stack?: string };
  return redacted;
}

export function createCrashReport(
  event: CrashReport["event"],
  error: unknown,
  now = new Date(),
): CrashReport {
  return {
    version: 1,
    id: randomUUID(),
    occurredAt: now.toISOString(),
    event,
    error: safeError(error),
    runtime: {
      platform: platform(),
      release: release(),
      ...(typeof Bun !== "undefined" ? { bun: Bun.version } : {}),
    },
  };
}

export async function saveCrashReport(
  report: CrashReport,
  directory = join(homedir(), ".chiku", "crashes"),
  options: CrashStorageOptions = {},
) {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${report.id}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
  await pruneCrashReports(directory, options.maxReports ?? DEFAULT_MAX_REPORTS);
  return destination;
}

export async function listCrashReports(
  directory = join(homedir(), ".chiku", "crashes"),
) {
  const files = await readdir(directory).catch(() => []);
  const reports = await Promise.all(
    files
      .filter((file) => file.endsWith(".json") && !file.endsWith(".tmp"))
      .map(async (file) => ({
        path: join(directory, file),
        modified: (await stat(join(directory, file))).mtimeMs,
      })),
  );
  return reports
    .sort((left, right) => left.modified - right.modified)
    .map((report) => report.path);
}

export async function pruneCrashReports(
  directory = join(homedir(), ".chiku", "crashes"),
  maxReports = DEFAULT_MAX_REPORTS,
) {
  if (!Number.isInteger(maxReports) || maxReports < 1)
    throw new Error("maxReports must be a positive integer");
  const files = await listCrashReports(directory);
  for (const file of files.slice(0, Math.max(0, files.length - maxReports)))
    await rm(file, { force: true });
}

export async function exportCrashReport(
  reportId: string,
  destination: string,
  directory = join(homedir(), ".chiku", "crashes"),
) {
  if (!/^[0-9a-f-]{36}(?:\.json)?$/i.test(reportId))
    throw new Error("invalid crash report identifier");
  const source = join(
    directory,
    reportId.endsWith(".json") ? reportId : `${reportId}.json`,
  );
  const report = JSON.parse(await readFile(source, "utf8")) as CrashReport;
  const redacted = redactProviderSecrets(report) as CrashReport;
  await writeFile(destination, `${JSON.stringify(redacted, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  }).catch(async (error) => {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error("export destination already exists");
    throw error;
  });
  return destination;
}

export function installCrashReporter(
  save: (report: CrashReport) => Promise<string> = saveCrashReport,
  write: (message: string) => void = (message) => process.stderr.write(message),
) {
  const onCrash = (event: CrashReport["event"], error: unknown) => {
    void save(createCrashReport(event, error))
      .then((path) => write(`Chiku captured a local crash report: ${path}\n`))
      .catch(() => write("Chiku crashed; local diagnostic capture failed.\n"));
  };
  const uncaught = (error: unknown) => onCrash("uncaught_exception", error);
  const rejection = (error: unknown) => onCrash("unhandled_rejection", error);
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", rejection);
  return () => {
    process.off("uncaughtException", uncaught);
    process.off("unhandledRejection", rejection);
  };
}
