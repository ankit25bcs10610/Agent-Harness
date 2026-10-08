import { Box, Text } from "ink";

export function Header({
  model,
  session,
  workspace,
  status,
}: {
  model: string;
  session: string;
  workspace: string;
  status: string;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Chiku
        </Text>
        <Text dimColor>{model}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>workspace: {workspace}</Text>
        <Text dimColor>
          session: {session || "new"} · {status}
        </Text>
      </Box>
    </Box>
  );
}
