import type { AgentMessage, ToolMessage } from "../provider";
import type { PruneMsgs } from "./types";

// estimate tokens used by existing tool calls = chars/4
function estimateToolTokens(message: ToolMessage): number {
  return message.content.length / 4;
}

export const prune: PruneMsgs = (
  messages: AgentMessage[],
  contextWindow: number,
  maxContextRatio: number,
) => {
  const maxAllowedTokens = contextWindow * maxContextRatio; // max allowed context fill
  const groups: AgentMessage[][] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index]!;
    const group = [message];
    index++;
    if (message.type === "assistant" && message.toolCalls?.length) {
      const ids = new Set(message.toolCalls.map((call) => call.toolCallId));
      while (
        index < messages.length &&
        messages[index]?.type === "tool" &&
        ids.has((messages[index] as ToolMessage).toolCallId)
      ) {
        group.push(messages[index]!);
        index++;
      }
    }
    groups.push(group);
  }
  const kept: AgentMessage[][] = [];
  let tokensUsed = 0;
  for (const group of groups.reverse()) {
    const cost = group.reduce(
      (total, message) =>
        total + (message.type === "tool" ? estimateToolTokens(message) : 0),
      0,
    );
    if (tokensUsed + cost <= maxAllowedTokens || kept.length === 0) {
      kept.unshift(group);
      tokensUsed += cost;
      continue;
    }
    kept.unshift(
      group.map((message) => {
        if (message.type !== "tool") return { ...message };
        const replacement =
          "[Tool output pruned. Rerun the tool to see output]";
        return message.content.length > replacement.length
          ? { ...message, content: replacement }
          : { ...message };
      }),
    );
  }
  return kept.flat();
};
