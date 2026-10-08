import { describe, expect, test } from "bun:test";
import { runLoop } from "../../src/loop/loop";
import type { ProviderResponse } from "../../src/provider/types";

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
  permissions: { projectRoot: process.cwd(), allowList: [/^echo /] },
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
});
