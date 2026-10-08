import { describe, expect, test } from "bun:test";
import { normalize, normalizeStream } from "../../src/provider/normalize";

const usage = { promptTokens: 3, completionTokens: 4, totalTokens: 7 };

describe("provider normalization", () => {
  test("normalizes a non-streaming assistant response and tool calls", () => {
    const result = normalize({
      choices: [
        {
          finishReason: "tool_calls",
          message: {
            content: null,
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        },
      ],
      usage,
    } as never);

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toEqual([
      { toolCallId: "call-1", name: "read_file", arguments: '{"path":"a.ts"}' },
    ]);
    expect(result.stats).toEqual(usage);
  });

  test("reassembles fragmented streamed text and tool calls", async () => {
    const chunks = [
      {
        choices: [
          {
            delta: {
              content: "hel",
              toolCalls: [
                {
                  index: 0,
                  id: "c",
                  function: { name: "read", arguments: '{"pa' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              content: "lo",
              toolCalls: [
                {
                  index: 0,
                  id: "all-1",
                  function: { name: "_file", arguments: 'th":"x"}' },
                },
              ],
            },
            finishReason: "tool_calls",
          },
        ],
        usage,
      },
    ];
    const text: string[] = [];
    const result = await normalizeStream(chunks as never, {
      onText: (part) => text.push(part),
    });
    expect(text.join("")).toBe("hello");
    expect(result.message.toolCalls).toEqual([
      { toolCallId: "call-1", name: "read_file", arguments: '{"path":"x"}' },
    ]);
    expect(result.stats.totalTokens).toBe(7);
  });

  test("uses safe partial usage defaults and rejects malformed streams", async () => {
    const result = normalize({
      choices: [{ finishReason: "stop", message: { content: "ok" } }],
    } as never);
    expect(result.stats).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      usageComplete: false,
    });
    await expect(
      normalizeStream([
        { choices: [{ delta: {}, finishReason: "unknown" }] },
      ] as never),
    ).rejects.toThrow("Non-standard finish reason");
    await expect(
      normalizeStream([{ choices: [{ delta: {} }] }] as never),
    ).rejects.toThrow("finish reason");
  });
});
