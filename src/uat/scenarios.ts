import type { UatScenario } from "./types";

export const UAT_SCENARIOS: readonly UatScenario[] = [
  {
    scenarioId: "install-help",
    version: "1",
    title: "Fresh installation",
    description: "A clean package exposes a working CLI entry point.",
    expectedBehaviors: ["help and version commands exit successfully"],
    requirements: ["bun", "npm"],
  },
  {
    scenarioId: "secure-setup",
    version: "1",
    title: "Credential-safe setup",
    description:
      "A new user can inspect setup state without writing or printing credentials.",
    expectedBehaviors: [
      "setup reports configuration state",
      "doctor reports actionable diagnostics",
    ],
    requirements: ["interactive terminal"],
  },
  {
    scenarioId: "session-resume",
    version: "1",
    title: "Session continuity",
    description:
      "A saved session resumes without replaying uncertain side effects.",
    expectedBehaviors: [
      "compatible state loads",
      "unfinished tool calls are not replayed",
    ],
    requirements: ["writable workspace"],
  },
  {
    scenarioId: "permission-boundary",
    version: "1",
    title: "Permission denial",
    description:
      "Out-of-scope and sensitive operations are rejected before execution.",
    expectedBehaviors: [
      "denied operations produce audit evidence",
      "side effects do not occur",
    ],
    requirements: ["writable workspace"],
  },
];
