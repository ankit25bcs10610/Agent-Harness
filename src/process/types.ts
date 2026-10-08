export type IsolationRequest = {
  backend: string;
  workspace: string;
};

export type ProcessRequest = {
  command: string;
  workspaceRoot?: string;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  timeoutMs?: number;
  maxOutputChars?: number;
  isolation?: IsolationRequest;
};

export type ProcessFailure =
  | "spawn"
  | "timeout"
  | "cancelled"
  | "exit"
  | "output_limit"
  | "isolation_unavailable";

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  truncated: boolean;
  failure?: ProcessFailure;
};

export type PreparedProcess = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

export type IsolationBackend = {
  name: string;
  prepare(request: ProcessRequest): Promise<PreparedProcess>;
};
