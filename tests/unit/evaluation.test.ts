import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BenchmarkRegistry,
  EvaluationEngine,
  ExperimentManager,
  TraceCollector,
  compareResults,
  compareExperiments,
  createDefaultGraderRegistry,
  evaluateQualityGate,
  listExperiments,
  proposeImprovements,
  summarizeEvaluationResults,
  type EvaluationTask,
} from "../../src/evaluation";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function git(args: string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr);
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "chiku-eval-"));
  await writeFile(join(root, "README.md"), "fixture\n");
  await git(["init"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await git(["config", "user.name", "Test"]);
  await git(["add", "."]);
  await git(["commit", "-m", "fixture"]);
}

function task(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    taskId: "fixture-task",
    benchmarkId: "fixture-suite",
    description: "validate a fixture",
    category: "comprehension",
    difficulty: "easy",
    repositoryFixture: root,
    instructions: "inspect the fixture",
    allowedTools: ["read_file"],
    allowedWorkspaces: "none",
    budget: {
      maxIterations: 2,
      maxTokens: 100,
      wallClockMs: 10_000,
      maxToolCalls: 2,
    },
    setupRequirements: [],
    expectedOutcomes: {
      requiredFiles: ["README.md"],
      forbiddenFiles: [],
      assertions: [],
    },
    verificationCommands: [],
    requiredGraders: ["task_assertion", "file_scope", "repository_state"],
    securityConstraints: {
      requiresIsolation: false,
      allowNetwork: false,
      allowedPaths: ["README.md"],
    },
    timeoutMs: 2_000,
    tags: ["fixture"],
    datasetVersion: "test-v1",
    expectedArtifacts: [],
    ...overrides,
  };
}

test("benchmark registry validates suites and rejects duplicate task IDs", async () => {
  await fixture();
  const registry = new BenchmarkRegistry();
  registry.register({
    id: "fixture-suite",
    name: "Fixture",
    version: "1",
    trustedGraderRevision: "test",
    tasks: [task()],
  });
  expect(() =>
    registry.register({
      id: "fixture-suite",
      name: "Duplicate",
      version: "1",
      trustedGraderRevision: "test",
      tasks: [task()],
    }),
  ).toThrow("already registered");
});

test("evaluation engine runs trusted graders, persists traces, and reports measured pass", async () => {
  await fixture();
  const resultDirectory = await mkdtemp(join(tmpdir(), "chiku-eval-results-"));
  const engine = new EvaluationEngine(
    undefined,
    createDefaultGraderRegistry(),
    resultDirectory,
  );
  const result = await engine.evaluateTask(
    task(),
    async (_task, _environment, trace) => {
      trace.record({
        taskId: "fixture-task",
        type: "AGENT_STARTED",
        data: { apiKey: "secret" },
      });
      return { changedFiles: [] };
    },
  );
  expect(result.status).toBe("PASS");
  expect(result.grades.every((grade) => grade.outcome === "PASS")).toBe(true);
  expect(result.trace.some((event) => event.data.apiKey === "[REDACTED]")).toBe(
    true,
  );
  await rm(resultDirectory, { recursive: true, force: true });
});

test("evaluation integrity rejects changes outside declared paths", async () => {
  await fixture();
  const engine = new EvaluationEngine();
  const result = await engine.evaluateTask(
    task({ requiredGraders: ["file_scope"] }),
    async () => ({ changedFiles: ["secret.txt"] }),
  );
  expect(result.status).toBe("FAIL");
  expect(result.integrity.changedOutsideAllowedPaths).toEqual([]);
  expect(result.metrics.correctness.unnecessaryFiles).toBe(1);
});

test("comparison and quality gates identify a regression without claiming significance", () => {
  const make = (status: "PASS" | "FAIL") => ({
    evaluationId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    taskId: "task",
    status,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    grades: [],
    trace: [],
    artifacts: [],
    metrics: {
      correctness: {
        taskPassed: status === "PASS",
        requiredTestsPassed: status === "PASS",
        changedFiles: 0,
        unnecessaryFiles: 0,
      },
      efficiency: { durationMs: 10, toolCalls: 0, modelRequests: 1 },
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      cost: {
        reportedCents: null,
        estimatedCents: null,
        status: "unknown" as const,
      },
      reliability: {
        providerFailures: 0,
        toolFailures: 0,
        interruptions: 0,
        timeouts: 0,
      },
      safety: {
        unauthorizedAttempts: 0,
        contractViolations: 0,
        crossWorkspaceAttempts: 0,
      },
    },
    integrity: {
      trustedGraderRevision: "test",
      changedOutsideAllowedPaths: [],
      graderTampered: false,
      fixtureContaminated: false,
    },
  });
  const comparisons = compareResults([make("PASS")], [make("FAIL")]);
  expect(
    evaluateQualityGate(comparisons, {
      name: "gate",
      minimumSampleSize: 1,
      maxRegressionRate: 0,
      securityBlocking: true,
    }).outcome,
  ).toBe("FAIL");
  expect(proposeImprovements([make("FAIL")])).toEqual([]);
});

test("statistical summaries keep honest denominators and unknown usage", () => {
  const make = (status: "PASS" | "BLOCKED") => ({
    evaluationId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    taskId: status,
    status,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    grades: [],
    trace: [],
    artifacts: [],
    metrics: {
      correctness: {
        taskPassed: status === "PASS",
        requiredTestsPassed: status === "PASS",
        changedFiles: 0,
        unnecessaryFiles: 0,
      },
      efficiency: {
        durationMs: status === "PASS" ? 10 : 20,
        toolCalls: 0,
        modelRequests: 0,
      },
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: status === "PASS" ? 5 : null,
      },
      cost: {
        reportedCents: null,
        estimatedCents: null,
        status:
          status === "PASS" ? ("measured" as const) : ("unknown" as const),
      },
      reliability: {
        providerFailures: 0,
        toolFailures: 0,
        interruptions: 0,
        timeouts: 0,
      },
      safety: {
        unauthorizedAttempts: 0,
        contractViolations: 0,
        crossWorkspaceAttempts: 0,
      },
    },
    integrity: {
      trustedGraderRevision: "test",
      changedOutsideAllowedPaths: [],
      graderTampered: false,
      fixtureContaminated: false,
    },
  });
  const summary = summarizeEvaluationResults([make("PASS"), make("BLOCKED")]);
  expect(summary.successRate).toBe(1);
  expect(summary.measuredTokenTrials).toBe(1);
  expect(summary.measuredCostTrials).toBe(1);
  expect(summary.limitations.join(" ")).toContain("excluded");
});

test("trace collector keeps bounded redacted evidence", () => {
  const trace = new TraceCollector("evaluation", "run");
  const event = trace.record({
    taskId: "task",
    type: "MODEL_REQUEST",
    data: {
      authorization: "secret",
      value: "ok",
      message: "Bearer abcdefghijklmnop",
    },
  });
  expect(event.data.authorization).toBe("[REDACTED]");
  expect(event.data.message).toBe("[REDACTED]");
  for (let index = 0; index < 2_100; index++)
    trace.record({ taskId: "task", type: "STEP", data: { index } });
  expect(trace.list()).toHaveLength(2_000);
});

test("pinned fixtures fail closed when their HEAD cannot be verified", async () => {
  await fixture();
  const head = await new Response(
    Bun.spawn(["git", "-C", root, "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    }).stdout,
  ).text();
  const result = await new EvaluationEngine().evaluateTask(
    task({ baseCommit: `${head.trim()}-not-real` }),
    async () => ({ changedFiles: [] }),
  );
  expect(result.status).toBe("BLOCKED");
  expect(result.error).toContain("fixture base commit mismatch");
});

test("dedicated evaluation workspaces stay outside the source fixture", async () => {
  await fixture();
  const environment = await new EvaluationEngine().environments.prepare(
    task({ allowedWorkspaces: "dedicated" }),
    "evaluation-id",
    new AbortController().signal,
  );
  try {
    expect(environment.root.startsWith(root)).toBe(false);
    expect(environment.workspaceId).toBeDefined();
  } finally {
    await environment.cleanup?.();
  }
});

test("evaluation fails when the real adapter exceeds declared budgets", async () => {
  await fixture();
  const result = await new EvaluationEngine().evaluateTask(
    task({ budget: { ...task().budget, maxToolCalls: 0 } }),
    async () => ({
      changedFiles: [],
      iterations: 3,
      execution: {
        startedAt: Date.now(),
        durationMs: 1,
        modelRequests: 1,
        toolCalls: 1,
        tokensUsed: 1,
        usageIncomplete: false,
      },
    }),
  );
  expect(result.status).toBe("FAIL");
  expect(result.integrity.budgetExceeded).toEqual(["iterations", "tool_calls"]);
  expect(result.trace.some((event) => event.type === "BUDGET_EXCEEDED")).toBe(
    true,
  );
});

test("evaluation blocks tasks that require unavailable isolation", async () => {
  await fixture();
  const result = await new EvaluationEngine().evaluateTask(
    task({
      securityConstraints: {
        requiresIsolation: true,
        allowNetwork: false,
        allowedPaths: ["README.md"],
      },
    }),
    async () => ({ changedFiles: [] }),
  );
  expect(result.status).toBe("BLOCKED");
  expect(result.error).toContain("isolation backend");
});

test("experiments are persisted and malformed records are ignored", async () => {
  await fixture();
  const directory = await mkdtemp(join(tmpdir(), "chiku-experiments-"));
  const engine = new EvaluationEngine(undefined, undefined, directory);
  await engine.createExperiment({
    name: "fixture experiment",
    suiteId: "fixture-suite",
    datasetVersion: "test-v1",
    modelConfiguration: { provider: "mock" },
    agentConfiguration: { mode: "single" },
    toolConfiguration: {},
    runtimeVersion: "test",
    trialCount: 1,
  });
  await writeFile(join(directory, "experiment-corrupt.json"), "not json");
  expect(await listExperiments(directory)).toHaveLength(1);
  await rm(directory, { recursive: true, force: true });
});

test("experiment resume skips completed tasks instead of replaying them", async () => {
  await fixture();
  const directory = await mkdtemp(join(tmpdir(), "chiku-experiment-run-"));
  const engine = new EvaluationEngine(undefined, undefined, directory);
  const manager = new ExperimentManager(engine, directory);
  const experiment = await manager.create({
    name: "resume experiment",
    suiteId: "fixture-suite",
    datasetVersion: "test-v1",
    modelConfiguration: { provider: "mock" },
    agentConfiguration: { mode: "single" },
    toolConfiguration: {},
    runtimeVersion: "test",
    trialCount: 1,
  });
  let executions = 0;
  const adapter = async () => {
    executions++;
    return { changedFiles: [] };
  };
  const completed = await manager.run(experiment, [task()], adapter);
  const resumed = await manager.resume(
    experiment.experimentId,
    [task()],
    adapter,
  );
  expect(executions).toBe(1);
  expect(completed.status).toBe("completed");
  expect(resumed.results).toHaveLength(1);
  await rm(directory, { recursive: true, force: true });
});

test("experiment runner executes and resumes configured trial counts", async () => {
  await fixture();
  const directory = await mkdtemp(join(tmpdir(), "chiku-experiment-trials-"));
  const engine = new EvaluationEngine(undefined, undefined, directory);
  const manager = new ExperimentManager(engine, directory);
  const experiment = await manager.create({
    name: "repeated trials",
    suiteId: "fixture-suite",
    datasetVersion: "test-v1",
    modelConfiguration: { provider: "mock" },
    agentConfiguration: { mode: "single" },
    toolConfiguration: {},
    runtimeVersion: "test",
    trialCount: 3,
  });
  let executions = 0;
  const adapter = async () => {
    executions++;
    return { changedFiles: [] };
  };
  const completed = await manager.run(experiment, [task()], adapter);
  expect(executions).toBe(3);
  expect(completed.results).toHaveLength(3);
  const resumed = await manager.resume(
    experiment.experimentId,
    [task()],
    adapter,
  );
  expect(executions).toBe(3);
  expect(resumed.results).toHaveLength(3);
  await rm(directory, { recursive: true, force: true });
});

test("fault injection produces an honest failure and experiment comparison warns on incompatible data", async () => {
  await fixture();
  const engine = new EvaluationEngine();
  const result = await engine.evaluateTask(
    task({ requiredGraders: ["runtime_failure"] }),
    async () => ({ runtimeFailure: "provider_timeout" }),
  );
  expect(result.status).toBe("FAIL");
  const base = {
    experimentId: crypto.randomUUID(),
    name: "base",
    suiteId: "fixture-suite",
    datasetVersion: "v1",
    modelConfiguration: {},
    agentConfiguration: {},
    toolConfiguration: {},
    runtimeVersion: "test",
    status: "completed" as const,
    trialCount: 1,
    results: [result],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const comparison = compareExperiments(base, {
    ...base,
    experimentId: crypto.randomUUID(),
    datasetVersion: "v2",
  });
  expect(comparison.configurationWarning).toContain("different");
});
