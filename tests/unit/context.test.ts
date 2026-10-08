import { describe, expect, test } from "bun:test";
import { prune } from "../../src/context/prune";
import { compact } from "../../src/context/compact";

describe("context management", () => {
  test("prunes oversized tool output while preserving the latest response", () => {
    const messages = [
      { type: "user", content: "inspect" },
      { type: "assistant", content: "calling", toolCalls: [] },
      { type: "tool", toolCallId: "1", content: "x".repeat(100) },
      { type: "assistant", content: "latest" },
    ] as never;
    const result = prune(messages, 10, 0.1) as any[];
    const original = messages as any[];
    expect(result[result.length - 1]).toEqual(original[original.length - 1]);
    expect(
      result.some(
        (message) =>
          message.content ===
          "[Tool output pruned. Rerun the tool to see output]",
      ),
    ).toBe(true);
  });

  test("compacts older messages through the injected completion function", async () => {
    const calls: unknown[][] = [];
    const complete = async (...args: unknown[]) => {
      calls.push(args);
      return {
        message: { type: "assistant", content: "## Goal\n- Keep working" },
        finishReason: "stop",
        stats: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      };
    };
    const result = await compact(
      { type: "assistant", content: "" },
      -1,
      [
        { type: "user", content: "old request" },
        { type: "assistant", content: "old response" },
        { type: "user", content: "new request" },
        { type: "assistant", content: "new response" },
      ] as never,
      new AbortController().signal,
      "mock-compactor",
      2000,
      complete as never,
    );
    expect(calls).toHaveLength(1);
    expect(result?.[0].content).toContain("[SUMMARIZED]");
    expect(result?.[2]).toBe(5);
  });
});
