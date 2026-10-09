import { describe, expect, test } from "bun:test";
import { runLoop } from "../../src/loop/loop";
import type { ProviderResponse } from "../../src/provider/types";
import type { PermissionGrant } from "../../src/permission/types";
import { PerformanceInstrumentation } from "../../src/performance";

const config = (overrides = {}) => ({
  maxIterations: 3,
  maxTokens: 100,
  contextWindow: 1000,
  pruneRatio: 0.5,
  maxPruneAllowanceRatio: 0.1,
  compactionRatio: 0.9,
  compactionModel: "mock",
  loopModel: "mock",
  transcriptCapChars: 2000,
  ...overrides,
});

const ctx = {
  permissions: {
    projectRoot: process.cwd(),
    grants: [
      {
        capability: "execute",
        scope: "prefix",
        target: "echo",
      } as PermissionGrant,
    ],
    audit: [],
  },
  asker: async () => "allow-once" as const,
  signal: new AbortController().signal,
  maxOutputChars: 2000,
};

const response = (
  finishReason: "stop" | "tool_calls" = "stop",
  totalTokens = 1,
): ProviderResponse => ({
  message:
    finishReason === "tool_calls"
      ? {
          type: "assistant",
          content: null,
          toolCalls: [
            {
              toolCallId: "1",
              name: "bash",
              arguments: JSON.stringify({ command: "echo ok" }),
            },
          ],
        }
      : { type: "assistant", content: "done" },
  finishReason,
  stats: { promptTokens: 1, completionTokens: totalTokens, totalTokens },
});

describe("agent loop", () => {
  test("stops on a normal provider stop reason", async () => {
    const result = await runLoop({
      messages: [{ type: "user", content: "hello" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => response(),
      config: config(),
      ctx,
    });
    expect(result.stopReason).toBe("stop");
    expect(result.iterations).toBe(0);
  });

  test("dispatches tool calls and continues", async () => {
    let calls = 0;
    const result = await runLoop({
      messages: [{ type: "user", content: "run" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () =>
        ++calls === 1 ? response("tool_calls") : response(),
      config: config(),
      ctx,
    });
    expect(calls).toBe(2);
    expect(result.stopReason).toBe("stop");
    expect(
      result.messages.some(
        (message) => message.type === "tool" && message.content.includes("ok"),
      ),
    ).toBe(true);
  });

  test("enforces iteration and token budgets", async () => {
    const maxIterations = await runLoop({
      messages: [{ type: "user", content: "loop" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => response("tool_calls"),
      config: config({ maxIterations: 2 }),
      ctx,
    });
    expect(maxIterations.stopReason).toBe("max_iterations");

    const maxTokens = await runLoop({
      messages: [{ type: "user", content: "budget" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => response("tool_calls", 101),
      config: config({ maxTokens: 100 }),
      ctx,
    });
    expect(maxTokens.stopReason).toBe("max_tokens");
  });

  test("records interruption when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runLoop({
      messages: [{ type: "user", content: "stop" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => response(),
      config: config(),
      ctx: { ...ctx, signal: controller.signal },
    });
    expect(result.stopReason).toBe("interrupted");
    expect(result.messages.at(-1)).toEqual({
      type: "user",
      content: "[Request interrupted by user]",
    });
  });

  test("emits lifecycle events and preserves tool-call relationships", async () => {
    const events: string[] = [];
    let calls = 0;
    const result = await runLoop({
      messages: [{ type: "user", content: "run" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () =>
        ++calls === 1 ? response("tool_calls") : response(),
      config: config(),
      ctx,
      events: {
        onEvent: (event) =>
          events.push(event.type === "lifecycle" ? event.state : event.type),
      },
    });
    expect(events).toContain("reasoning");
    expect(events).toContain("tool_dispatch");
    expect(events).toContain("execution");
    expect(events.at(-1)).toBe("stopped");
    expect(result.execution.toolCalls).toBe(1);
    const assistantIndex = result.messages.findIndex(
      (message) => message.type === "assistant",
    );
    const toolIndex = result.messages.findIndex(
      (message) => message.type === "tool",
    );
    expect(assistantIndex).toBeLessThan(toolIndex);
  });

  test("recovers predictably by returning a checkpointable provider failure", async () => {
    const checkpoints: unknown[] = [];
    const result = await runLoop({
      messages: [{ type: "user", content: "recover" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => {
        throw new Error("temporary provider failure");
      },
      config: config(),
      ctx,
      checkpoint: async (state) => {
        checkpoints.push(state);
      },
    });
    expect(result.stopReason).toBe("provider_failure");
    expect(checkpoints).toHaveLength(1);
    expect(result.execution.modelRequests).toBe(1);
  });

  test("enforces a wall-clock budget before another model request", async () => {
    const result = await runLoop({
      messages: [{ type: "user", content: "slow" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return response("tool_calls");
      },
      config: config({ wallClockMs: 1 }),
      ctx,
    });
    expect(result.stopReason).toBe("wall_clock");
  });

  test("does not dispatch an incomplete tool-call response", async () => {
    const result = await runLoop({
      messages: [{ type: "user", content: "bad tool" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => ({
        message: { type: "assistant", content: null },
        finishReason: "tool_calls",
        stats: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
      config: config(),
      ctx,
    });
    expect(result.stopReason).toBe("malformed_response");
    expect(
      result.messages.filter((message) => message.type === "tool"),
    ).toHaveLength(0);
  });

  test("records real model and tool spans without changing loop results", async () => {
    let now = 100;
    const performance = new PerformanceInstrumentation(() => now);
    const result = await runLoop({
      messages: [{ type: "user", content: "measure" }],
      systemPrompt: { type: "system", content: "test" },
      complete: async () => {
        now += 4;
        return response("stop");
      },
      config: config(),
      ctx,
      performance,
    });
    expect(result.stopReason).toBe("stop");
    expect(performance.list().map((span) => span.name)).toEqual([
      "model.request",
    ]);
    expect(performance.list()[0]?.status).toBe("ok");
  });
});
