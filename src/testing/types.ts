export type TestFramework =
  "bun" | "jest" | "vitest" | "mocha" | "pytest" | "unknown";

export type FrameworkDetection = {
  framework: TestFramework;
  supported: boolean;
  source: string;
  command: string | null;
  reason?: string;
};

export type TestCaseRecord = {
  file: string;
  name: string | null;
  framework: TestFramework;
};

export type TestInventory = {
  root: string;
  framework: FrameworkDetection;
  files: string[];
  cases: TestCaseRecord[];
  commands: { name: string; command: string }[];
};

export type TestSelection = {
  files: string[];
  fallback: boolean;
  reason: string;
};

export type FailureKind =
  | "ASSERTION_FAILURE"
  | "COMPILE_FAILURE"
  | "TEST_SETUP_FAILURE"
  | "TIMEOUT"
  | "RESOURCE_FAILURE"
  | "ENVIRONMENT_FAILURE"
  | "UNKNOWN";

export type MutationOperator =
  | "boolean-negation"
  | "comparison-boundary"
  | "conditional-removal"
  | "return-value";

export type MutationStatus =
  "KILLED" | "SURVIVED" | "INVALID" | "TIMEOUT" | "UNSUPPORTED" | "UNKNOWN";

export type MutationCase = {
  id: string;
  file: string;
  operator: MutationOperator;
  line: number;
  status: MutationStatus;
  reason?: string;
};

export type MutationReport = {
  cases: MutationCase[];
  validCount: number;
  killedCount: number;
  score: number | null;
  limitations: string[];
};

export type PropertyResult<T> = {
  passed: boolean;
  seed: number;
  cases: number;
  counterexample?: T;
  error?: string;
};
