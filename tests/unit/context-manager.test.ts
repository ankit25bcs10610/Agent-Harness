import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../../src/provider";
import { ContextManager } from "../../src/context/manager";

const policy = (contextWindow: number) => ({
  contextWindow,
  activeRatio: 0.5,
  recentTurns: 1,
  maxMemoryEntries: 10,
});

describe("ContextManager", () => {
  test("keeps assistant tool calls atomically paired with their results", () => {
    const manager = new ContextManager(policy(100));
    const messages: AgentMessage[] = [
      { type: "user", content: "inspect the repository" },
      {
        type: "assistant",
        content: "",
        toolCalls: [
          { toolCallId: "call-1", name: "read_file", arguments: "{}" },
        ],
      },
      { type: "tool", toolCallId: "call-1", content: "file contents" },
      { type: "assistant", content: "The inspection is complete." },
    ];
    const selected = manager.select(messages, "repository");
    const callIndex = selected.findIndex(
      (message) => message.type === "assistant" && message.toolCalls?.length,
    );
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(selected[callIndex + 1]?.type).toBe("tool");
    const toolResult = selected[callIndex + 1];
    expect(
      toolResult?.type === "tool" ? toolResult.toolCallId : undefined,
    ).toBe("call-1");
  });

  test("prefers task-relevant history and reports pruning", () => {
    const manager = new ContextManager(policy(40));
    const messages: AgentMessage[] = [
      { type: "user", content: "database migration details" },
      { type: "assistant", content: "unrelated styling discussion" },
      { type: "user", content: "fix the database migration" },
      { type: "assistant", content: "migration verification is pending" },
    ];
    const selected = manager.select(messages, "database migration");
    expect(
      selected.some((message) => message.content?.includes("database")),
    ).toBe(true);
    expect(manager.diagnostics().rawMessages).toBe(messages.length);
    expect(manager.diagnostics().prunedMessages).toBeGreaterThan(0);
  });

  test("deduplicates memories, blocks secrets, and invalidates stale paths", () => {
    const manager = new ContextManager(policy(100));
    manager.addMemory(
      "decision",
      "Use src/loop/loop.ts for lifecycle control",
      [1],
    );
    manager.addMemory(
      "decision",
      "Use src/loop/loop.ts for lifecycle control",
      [2],
    );
    manager.addMemory("error", "OPENROUTER_API_KEY=do-not-persist");
    manager.addMemory("edit", "Updated src/old.ts after verification", [3]);
    expect(manager.state().memories).toHaveLength(2);
    expect(manager.memoryFor("lifecycle control")).toHaveLength(1);
    manager.invalidatePath("src/old.ts");
    expect(manager.memoryFor("old verification")).toHaveLength(0);
  });

  test("supports multiple compaction cycles and different model capacities", () => {
    const small = new ContextManager(policy(20));
    const large = new ContextManager(policy(200));
    small.markCompacted();
    small.markCompacted();
    expect(small.diagnostics().compactionCount).toBe(2);
    const messages: AgentMessage[] = Array.from({ length: 30 }, (_, index) => ({
      type: "user",
      content: `requirement ${index} ${"detail ".repeat(8)}`,
    }));
    small.select(messages, "requirement");
    large.select(messages, "requirement");
    expect(small.diagnostics().estimatedTokens).toBeLessThanOrEqual(
      small.diagnostics().budgetTokens + 40,
    );
    expect(large.diagnostics().retainedMessages).toBeGreaterThan(
      small.diagnostics().retainedMessages,
    );
  });

  test("adds relevant persistent context without duplicating the synthetic message", () => {
    const manager = new ContextManager(policy(100));
    manager.addMemory("verification", "typecheck passed for src/index.ts");
    const first = manager.buildWindow(
      [{ type: "user", content: "continue src/index.ts work" }],
      "src/index.ts",
    );
    const second = manager.buildWindow(first, "src/index.ts");
    expect(first.filter((message) => message.type === "system")).toHaveLength(
      1,
    );
    expect(second.filter((message) => message.type === "system")).toHaveLength(
      1,
    );
  });
});
