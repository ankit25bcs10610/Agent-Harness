import { Box, Text } from "ink";

type Props = {
  model: string;
  contextPercent: number;
  contextTokens: number;
  contextWindow: number;
  warnAt: number; // percent where pruning starts
  dangerAt: number; // percent where compaction starts
  title: string;
  status: string;
  retainedMessages?: number | undefined;
  prunedMessages?: number | undefined;
};

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function StatusBar({
  model,
  contextWindow,
  contextTokens,
  contextPercent,
  warnAt,
  dangerAt,
  title,
  status,
  retainedMessages,
  prunedMessages,
}: Props) {
  const contextColor =
    contextPercent >= dangerAt
      ? "red"
      : contextPercent >= warnAt
        ? "yellow"
        : "gray";

  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text dimColor>
          {model} · ctx {formatTokens(contextTokens)} /{" "}
          {formatTokens(contextWindow)}{" "}
        </Text>
        <Text color={contextColor}>{contextPercent}%</Text>
        {retainedMessages !== undefined && prunedMessages !== undefined ? (
          <Text dimColor>
            {" · "}kept {retainedMessages}, pruned {prunedMessages}
          </Text>
        ) : null}
      </Box>
      <Text dimColor>
        {title || "new session"} . {status}
      </Text>
    </Box>
  );
}
