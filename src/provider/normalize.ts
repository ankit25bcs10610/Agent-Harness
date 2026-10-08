// conversion between sdk types and custom types

import {
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatResult,
  type ChatStreamChunk,
  type ChatToolCall,
  type ChatUsage,
} from "@openrouter/sdk/models";

import type {
  AgentMessage,
  AssistantMessage,
  FinishReason,
  ProviderResponse,
  Statistics,
  StreamCallbacks,
  ToolCall,
  ToolSpec,
} from "./types";
import { ProviderError } from "./errors";

// as ChatFinishReasonEnum is an OpenEnum, it can consider unwanted values
function normalizeFinishReason(raw: string | null): FinishReason {
  switch (raw) {
    case "tool_calls":
      return "tool_calls";
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
      return "error";
    default:
      throw new ProviderError(
        "Non-standard finish reason",
        "malformed_response",
        false,
      );
  }
}

function normalizeStats(usage: ChatUsage | undefined): Statistics {
  const promptTokens = usage?.promptTokens ?? 0;
  const completionTokens = usage?.completionTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens;
  const complete =
    typeof usage?.promptTokens === "number" &&
    typeof usage?.completionTokens === "number" &&
    typeof usage?.totalTokens === "number";
  if (complete) return { promptTokens, completionTokens, totalTokens };
  return { promptTokens, completionTokens, totalTokens, usageComplete: false };
}

function normalizeToolCalls(raw: ChatToolCall[] | undefined): ToolCall[] {
  let result: ToolCall[] = [];
  if (raw) {
    for (const tool of raw) {
      if (
        !tool.id ||
        !tool.function?.name ||
        typeof tool.function.arguments !== "string"
      ) {
        throw new ProviderError(
          "Incomplete tool call",
          "incomplete_response",
          false,
        );
      }
      try {
        JSON.parse(tool.function.arguments);
      } catch {
        throw new ProviderError(
          "Malformed tool arguments",
          "malformed_response",
          false,
        );
      }
      result.push({
        toolCallId: tool.id,
        name: tool.function.name,
        arguments: tool.function.arguments,
      });
    }
  }
  return result;
}

function normalizeAssistantMessage(choice: ChatChoice): AssistantMessage {
  const msg = choice.message?.content;
  if (choice.message) {
    return {
      type: "assistant",
      content: typeof msg === "string" ? msg : null,
      toolCalls: normalizeToolCalls(choice.message.toolCalls),
    };
  }
  throw new ProviderError(
    "Invalid assistant message",
    "malformed_response",
    false,
  );
}

export function normalize(completion: ChatResult): ProviderResponse {
  const choice = completion.choices[0];
  if (!choice) {
    throw new ProviderError(
      "Provider response contained no choices",
      "malformed_response",
      false,
    );
  }

  const message = normalizeAssistantMessage(choice);
  const finishReason = normalizeFinishReason(choice.finishReason);
  if (finishReason === "tool_calls" && !message.toolCalls?.length) {
    throw new ProviderError(
      "Tool-call finish reason contained no tool calls",
      "incomplete_response",
      false,
    );
  }
  return {
    message,
    finishReason,
    stats: normalizeStats(completion.usage),
  };
}

export function toSdkMsg(msg: AgentMessage): ChatMessages {
  switch (msg.type) {
    case "user":
    case "system":
      return {
        role: msg.type,
        content: msg.content,
      };
    case "assistant":
      return {
        role: "assistant",
        content: msg.content,
        toolCalls: msg.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      };
    case "tool":
      return {
        role: "tool",
        toolCallId: msg.toolCallId,
        content: msg.content,
      };
  }
}

export function toSdkTool(tool: ToolSpec): ChatFunctionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export async function normalizeStream(
  stream: AsyncIterable<ChatStreamChunk>,
  callbacks: StreamCallbacks = {},
): Promise<ProviderResponse> {
  let text = "";
  let rawFinish: string | null = null;
  let usage: ChatUsage | undefined;
  const calls: { id: string; name: string; args: string }[] = [];

  for await (const chunk of stream) {
    if (chunk.error)
      throw new ProviderError(
        `Stream error: ${chunk.error.message}`,
        "server",
        true,
      );
    if (chunk.usage) usage = chunk.usage;

    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (delta.content) {
      text += delta.content;
      callbacks.onText?.(delta.content);
    }

    if (delta.reasoning) callbacks.onReasoning?.(delta.reasoning); // not kept in history

    for (const piece of delta.toolCalls ?? []) {
      const call = (calls[piece.index] ??= { id: "", name: "", args: "" });
      call.id += piece.id ?? "";
      call.name += piece.function?.name ?? "";
      call.args += piece.function?.arguments ?? "";
    }

    if (choice.finishReason) rawFinish = choice.finishReason;
  }

  if (!rawFinish) {
    throw new ProviderError(
      "Provider stream ended without a finish reason",
      "incomplete_response",
      false,
    );
  }

  const toolCalls: ToolCall[] = calls.map((c) => {
    if (!c.id || !c.name || !c.args) {
      throw new ProviderError(
        "Incomplete streamed tool call",
        "incomplete_response",
        false,
      );
    }
    try {
      JSON.parse(c.args);
    } catch {
      throw new ProviderError(
        "Malformed streamed tool arguments",
        "malformed_response",
        false,
      );
    }
    return { toolCallId: c.id, name: c.name, arguments: c.args };
  });

  return {
    message: { type: "assistant", content: text || null, toolCalls },
    finishReason: normalizeFinishReason(rawFinish),
    stats: normalizeStats(usage),
  };
}
