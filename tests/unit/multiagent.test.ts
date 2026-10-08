import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentCommunicationBus,
  AgentRegistry,
  AgentRuntime,
  AgentWorkspaceAllocator,
  MultiAgentCoordinator,
  MultiAgentScheduler,
  ReviewRepairLoop,
  TaskDecomposer,
  TaskGraph,
  createDefaultAgentRegistry,
  loadAgentSession,
  saveAgentSession,
} from "../../src/multiagent";
import { runTool } from "../../src/tool/registry";
import type { AgentSessionState, AgentTask } from "../../src/multiagent";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function gitAt(root: string, args: string[]) {
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

function task(
  role: AgentTask["role"] = "explorer",
  dependencies: string[] = [],
): AgentTask {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    parentTaskId: null,
    objective: "inspect the repository",
    role,
    dependencies,
    inputRequirements: [],
    expectedOutput: "grounded findings",
    acceptanceCriteria: ["contains evidence"],
    risk: "low",
    requiredCapabilities: ["read"],
    workspaceRequired: false,
    contractId: null,
    budget: {
      maxIterations: 2,
      maxTokens: 100,
      wallClockMs: 10_000,
      maxToolCalls: 4,
    },
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

test("registry validates duplicates, disabled agents, and capability selection", () => {
  const registry = createDefaultAgentRegistry();
  const explorer = registry.select(task());
  expect(explorer.role).toBe("explorer");
  registry.disable(explorer.id);
  expect(() => registry.select(task())).toThrow("no active compatible agent");
  expect(() => registry.register(explorer)).toThrow("already registered");
});

test("task graph enforces dependencies and rejects cycles", () => {
  const first = task();
  const second = task("planner");
  const graph = new TaskGraph([first, second]);
  graph.addDependency(second.id, first.id);
  expect(graph.ready().map((value) => value.id)).toEqual([first.id]);
  graph.update(first.id, "succeeded");
  expect(graph.ready().map((value) => value.id)).toEqual([second.id]);
  expect(() => graph.addDependency(first.id, second.id)).toThrow("cycle");
});

test("decomposer validates model-produced task definitions and bounds depth", async () => {
  const first = task();
  const second = task("planner", [first.id]);
  const decomposer = new TaskDecomposer(
    async () => ({
      tasks: [
        {
          key: "inspect",
          objective: first.objective,
          role: "explorer",
          dependsOn: [],
          inputRequirements: [],
          expectedOutput: first.expectedOutput,
          acceptanceCriteria: first.acceptanceCriteria,
          risk: "low",
          requiredCapabilities: ["read"],
          workspaceRequired: false,
        },
        {
          key: "plan",
          objective: second.objective,
          role: "planner",
          dependsOn: ["inspect"],
          inputRequirements: [],
          expectedOutput: second.expectedOutput,
          acceptanceCriteria: second.acceptanceCriteria,
          risk: "low",
          requiredCapabilities: ["read"],
          workspaceRequired: false,
        },
      ],
    }),
    {
      maxTasks: 4,
      maxDepth: 2,
      defaultBudget: first.budget,
    },
  );
  const graph = await decomposer.decompose(
    "analyze",
    new AbortController().signal,
  );
  expect(graph.list()).toHaveLength(2);
  expect(graph.ready()).toHaveLength(1);
});

test("communication bus validates and acknowledges structured handoffs", async () => {
  const value = task();
  const bus = new AgentCommunicationBus();
  const received: string[] = [];
  bus.subscribe("reviewer", (message) => {
    received.push(message.type);
  });
  const message = await bus.publish({
    sourceAgent: "explorer",
    destination: "reviewer",
    taskId: value.id,
    type: "FINDINGS_READY",
    payload: { files: ["src/auth.ts"] },
  });
  bus.acknowledge(message.id);
  expect(received).toEqual(["FINDINGS_READY"]);
  expect(bus.isAcknowledged(message.id)).toBe(true);
});

test("bounded scheduler runs independent agents concurrently through the existing loop", async () => {
  const registry = createDefaultAgentRegistry();
  const runtime = new AgentRuntime(registry);
  const scheduler = new MultiAgentScheduler(registry, runtime, {
    maxActiveAgents: 2,
  });
  const first = task();
  const second = task();
  const graph = new TaskGraph([first, second]);
  let active = 0;
  let peak = 0;
  const result = await scheduler.run(
    graph,
    "session-1",
    () => ({
      sessionId: "session-1",
      parentTaskId: null,
      context: {
        permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
        asker: async () => "deny" as const,
        signal: new AbortController().signal,
        maxOutputChars: 1000,
      },
      loop: {
        messages: [{ type: "user", content: "inspect" }],
        systemPrompt: { type: "system", content: "test" },
        complete: async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
          return {
            message: { type: "assistant", content: "evidence" },
            finishReason: "stop",
            stats: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        },
        config: {
          maxIterations: 2,
          maxTokens: 100,
          contextWindow: 1000,
          pruneRatio: 0.5,
          maxPruneAllowanceRatio: 0.1,
          compactionRatio: 0.9,
          compactionModel: "mock",
          loopModel: "mock",
          transcriptCapChars: 1000,
        },
        ctx: {
          permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
          asker: async () => "deny" as const,
          signal: new AbortController().signal,
          maxOutputChars: 1000,
        },
      },
    }),
    new AbortController().signal,
  );
  expect(peak).toBe(2);
  expect(result.list().every((value) => value.status === "succeeded")).toBe(
    true,
  );
});

test("multi-agent sessions persist and recover uncertain running work as blocked", async () => {
  directory = await mkdtemp(join(tmpdir(), "chiku-agents-"));
  const first = task();
  const state: AgentSessionState = {
    version: 1 as const,
    sessionId: "session-1",
    rootTaskId: first.id,
    agents: createDefaultAgentRegistry()
      .list()
      .map(({ active: _active, ...agent }) => agent),
    tasks: [{ ...first, status: "running" as const }],
    executions: [],
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  await saveAgentSession(state, directory);
  const loaded = await loadAgentSession("session-1", directory);
  const coordinator = new MultiAgentCoordinator(
    createDefaultAgentRegistry(),
    { maxActiveAgents: 1 },
    directory,
  );
  const graph = coordinator.restore(loaded);
  expect(graph.get(first.id).status).toBe("blocked");
});

test("write-capable tasks receive dedicated real workspaces", async () => {
  directory = await mkdtemp(join(tmpdir(), "chiku-agent-workspace-"));
  await writeFile(join(directory, "README.md"), "base\n");
  await gitAt(directory, ["init"]);
  await gitAt(directory, ["config", "user.email", "test@example.invalid"]);
  await gitAt(directory, ["config", "user.name", "Test"]);
  await gitAt(directory, ["add", "."]);
  await gitAt(directory, ["commit", "-m", "initial"]);
  const manager = new (await import("../../src/workspace")).WorkspaceManager({
    repositoryRoot: directory,
    workspaceDirectory: join(directory, ".chiku", "workspaces"),
  });
  const allocation = new AgentWorkspaceAllocator(manager);
  const value = { ...task("implementer"), workspaceRequired: true };
  const result = await allocation.allocate(
    value,
    "implementer",
    "session-1",
    new AbortController().signal,
  );
  expect(result?.context.authorizedRoot).toContain("workspaces");
  expect(result?.workspaceId).toBeDefined();
});

test("required change contracts reject unbound delegated edits", async () => {
  const contractId = crypto.randomUUID();
  const result = await runTool(
    "apply_patch",
    JSON.stringify({
      patch: "*** Update File: README.md\n@@\n-base\n+changed\n",
    }),
    {
      permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
      asker: async () => "allow-once",
      signal: new AbortController().signal,
      maxOutputChars: 1000,
      allowedTools: ["apply_patch"],
      requiredContractId: contractId,
    },
  );
  expect(result).toContain("required change contract");
});

test("review and repair stops at a bounded accepted result", async () => {
  let checks = 0;
  let repairs = 0;
  const result = await new ReviewRepairLoop({
    maxRepairAttempts: 1,
    verify: async () => ({
      passed: checks++ > 0,
      checks: [{ name: "test", status: checks > 0 ? "passed" : "failed" }],
    }),
    review: async () =>
      checks > 1
        ? []
        : [
            {
              id: "finding-1",
              severity: "blocking",
              message: "fix",
              files: [],
              evidence: [],
            },
          ],
    repair: async () => {
      repairs++;
      return true;
    },
  }).run(new AbortController().signal);
  expect(result.accepted).toBe(true);
  expect(repairs).toBe(1);
  expect(result.attempts).toHaveLength(2);
});
