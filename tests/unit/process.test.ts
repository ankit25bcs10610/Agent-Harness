import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ProcessExecutor, filterEnvironment } from "../../src/process/executor";
import { IsolationRegistry } from "../../src/process/isolation";

const command = process.platform === "win32" ? "node" : "node";
const nodeArgs = (script: string) => `${command} -e "${script}"`;

test("process executor uses direct spawning and returns structured success metadata", async () => {
  const result = await new ProcessExecutor().run({
    command: nodeArgs("process.stdout.write('ok')"),
  });
  expect(result.stdout).toBe("ok");
  expect(result.exitCode).toBe(0);
  expect(result.failure).toBeUndefined();
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test("complex syntax requires explicit shell mode", async () => {
  const result = await new ProcessExecutor().run({
    command: "printf ok | cat",
  });
  expect(result.failure).toBe("spawn");
  expect(result.stderr).toContain("shell: true");
});

test("timeout terminates a process and reports the timeout", async () => {
  const result = await new ProcessExecutor().run({
    command: nodeArgs("setTimeout(() => {}, 10000)"),
    timeoutMs: 30,
  });
  expect(result.failure).toBe("timeout");
});

test("abort signal terminates a process", async () => {
  const controller = new AbortController();
  const promise = new ProcessExecutor().run(
    {
      command: nodeArgs("setTimeout(() => {}, 10000)"),
    },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 20);
  expect((await promise).failure).toBe("cancelled");
});

test("output is bounded and the process is stopped", async () => {
  const result = await new ProcessExecutor().run({
    command: nodeArgs("process.stdout.write('x'.repeat(1000000))"),
    maxOutputChars: 100,
  });
  expect(result.stdout.length).toBeLessThanOrEqual(100);
  expect(result.truncated).toBe(true);
  expect(result.failure).toBe("output_limit");
});

test("failed processes include stderr and exit metadata", async () => {
  const result = await new ProcessExecutor().run({
    command: nodeArgs("process.stderr.write('bad'); process.exit(3)"),
  });
  expect(result.stderr).toContain("bad");
  expect(result.exitCode).toBe(3);
  expect(result.failure).toBe("exit");
});

test("filters sensitive inherited and requested environment keys", () => {
  const filtered = filterEnvironment({
    SAFE_VALUE: "yes",
    API_TOKEN: "secret",
  });
  expect(filtered).toEqual({ SAFE_VALUE: "yes" });
});

test("fails closed when requested isolation is unavailable", async () => {
  const registry = new IsolationRegistry();
  const result = await new ProcessExecutor(registry).run({
    command: "echo should-not-run",
    isolation: { backend: "container", workspace: "." },
  });
  expect(result.failure).toBe("isolation_unavailable");
});

test("rejects a working directory outside the workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-process-"));
  try {
    const result = await new ProcessExecutor().run({
      command: "echo no",
      cwd: directory,
    });
    expect(result.failure).toBe("spawn");
    expect(result.stderr).toContain("inside the workspace");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
