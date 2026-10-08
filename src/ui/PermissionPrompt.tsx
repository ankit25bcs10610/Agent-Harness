import { Box, Text } from "ink";
import type {
  PermissionDecision,
  PermissionKey,
  UserDecision,
} from "../permission/types";

export type AskRequest = {
  key: PermissionKey;
  decision: PermissionDecision;
  resolve: (d: UserDecision) => void;
};

type Option = { label: string; value: UserDecision };

const LABELS: Record<PermissionKey["capability"], string> = {
  read: "read: ",
  create: "create: ",
  modify: "modify: ",
  delete: "delete: ",
  execute: "run: ",
  external: "external: ",
};

export function optionsFor(
  key: PermissionKey,
  decision: PermissionDecision,
): Option[] {
  if (decision === "deny" || key.risk === "high") {
    return [
      { label: "allow once", value: "allow-once" },
      { label: "deny", value: "deny" },
    ];
  }
  if (key.capability !== "execute") {
    return [
      { label: "allow once", value: "allow-once" },
      { label: "always allow this exact target", value: "allow-always-exact" },
      {
        label: "always allow this target subtree",
        value: "allow-always-prefix",
      },
      { label: "deny", value: "deny" },
    ];
  }
  return [
    { label: "allow once", value: "allow-once" },
    { label: "always allow this exact command", value: "allow-always-exact" },
    { label: "always allow this command prefix", value: "allow-always-prefix" },
    { label: "deny", value: "deny" },
  ];
}

export function PermissionPrompt({
  request,
  selected,
}: {
  request: AskRequest;
  selected: number;
}) {
  const risky = request.key.risk === "high";
  const options = optionsFor(request.key, request.decision);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={risky ? "red" : "yellow"}
      paddingX={1}
    >
      <Text bold color={risky ? "red" : "yellow"}>
        {risky ? "Sensitive action requires approval" : "Permission needed"}
      </Text>
      <Text>
        {LABELS[request.key.capability]}
        {request.key.target}
      </Text>
      <Text dimColor>{request.key.explanation}</Text>
      {options.map((option, index) => (
        <Text
          key={option.value}
          bold={index === selected}
          color={index === selected ? "cyan" : "gray"}
        >
          {index === selected ? "> " : "  "}
          {option.label}
        </Text>
      ))}
      <Text dimColor>up/down to move, enter to choose, esc to deny</Text>
    </Box>
  );
}
