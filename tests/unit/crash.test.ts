import { expect, test } from "bun:test";
import {
  createCrashReport,
  exportCrashReport,
  installCrashReporter,
  listCrashReports,
  saveCrashReport,
} from "../../src/beta";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("crash reports are bounded and redact provider secrets", () => {
  const report = createCrashReport(
    "uncaught_exception",
    new Error(`Bearer secret sk-or-v1-${"x".repeat(10000)}`),
    new Date("2026-01-01T00:00:00.000Z"),
  );
  expect(report.version).toBe(1);
  expect(report.error.message).toContain("[REDACTED]");
  expect(report.error.message.length).toBeLessThanOrEqual(2_001);
  expect(report.error.message).not.toContain("sk-or-v1-xxxx");
});

test("crash reporter can be installed and removed without external transmission", async () => {
  const reports: string[] = [];
  const writes: string[] = [];
  const remove = installCrashReporter(
    async (report) => {
      reports.push(report.event);
      return "local-report.json";
    },
    (message) => writes.push(message),
  );
  process.emit("unhandledRejection", new Error("fixture"));
  await Bun.sleep(0);
  remove();
  expect(reports).toEqual(["unhandled_rejection"]);
  expect(writes[0]).toContain("local-report.json");
});

test("crash storage is bounded and exports only a redacted local report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-crashes-"));
  const destination = join(directory, "export.json");
  try {
    const first = createCrashReport("uncaught_exception", "first");
    const second = createCrashReport("uncaught_exception", "Bearer secret");
    await saveCrashReport(first, directory, { maxReports: 1 });
    await saveCrashReport(second, directory, { maxReports: 1 });
    expect(await listCrashReports(directory)).toHaveLength(1);
    await exportCrashReport(second.id, destination, directory);
    const exported = await readFile(destination, "utf8");
    expect(exported).toContain("[REDACTED]");
    await expect(
      exportCrashReport(second.id, destination, directory),
    ).rejects.toThrow("already exists");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
