import type { LoopConfig } from "./loop/types";

export const CONFIG: LoopConfig = {
  maxIterations: 20,
  maxTokens: 200000,
  contextWindow: 128000,
  maxPruneAllowanceRatio: 0.1,
  compactionRatio: 0.9,
  pruneRatio: 0.5,
  loopModel: "openai/gpt-4o",
  compactionModel: "openrouter/free",
  transcriptCapChars: 2000,
  contextActiveRatio: 0.75,
  recentContextTurns: 6,
  maxMemoryEntries: 100,
  workflow: {
    root: process.cwd(),
    maxRepairAttempts: 1,
    commandTimeoutMs: 120_000,
    maxOutputChars: 20_000,
    enabled: true,
  },
};

export const TOOLS = {
  maxOutputChars: 2000, // cap per string field of a tool result
  readFileDefaultLimit: 2000, // lines read_file returns when no limit is given
};

// project-local storage
const CHIKU_DIR = `${process.cwd()}/.chiku`;
export const PATHS = {
  skillsDir: `${CHIKU_DIR}/skills`,
  sessionsDir: `${CHIKU_DIR}/sessions`,
  contractsDir: `${CHIKU_DIR}/contracts`,
  tasksDir: `${CHIKU_DIR}/tasks`,
  memoryDir: `${CHIKU_DIR}/memory`,
  workspacesDir: `${CHIKU_DIR}/workspaces`,
  workspaceLocksDir: `${CHIKU_DIR}/locks`,
};

// display only
export const UI = {
  titleMaxChars: 50, // session title taken from the first message
  reasoningTailChars: 300, // live reasoning shows only its tail
  toolSummaryChars: 60, // tool line argument summary
  resizeDebounceMs: 100, // wait for the resize to settle before reprinting
};
