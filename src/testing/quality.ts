import type { FailureKind, PropertyResult } from "./types";

export function classifyFailure(input: {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}): FailureKind {
  if (input.timedOut) return "TIMEOUT";
  const text = `${input.stdout ?? ""}\n${input.stderr ?? ""}`.toLowerCase();
  if (
    /out of memory|resource temporarily unavailable|too many open files/.test(
      text,
    )
  )
    return "RESOURCE_FAILURE";
  if (/cannot find module|syntaxerror|compile error|ts\d{4}:/.test(text))
    return "COMPILE_FAILURE";
  if (/beforeall|beforeeach|afterall|test setup|fixture/.test(text))
    return "TEST_SETUP_FAILURE";
  if (/enoent|permission denied|command not found|environment/.test(text))
    return "ENVIRONMENT_FAILURE";
  if (
    input.exitCode !== null &&
    input.exitCode !== undefined &&
    input.exitCode !== 0
  )
    return "ASSERTION_FAILURE";
  return "UNKNOWN";
}

export function runProperty<T>(options: {
  seed: number;
  cases: number;
  generate: (random: () => number) => T;
  invariant: (value: T) => boolean;
}): PropertyResult<T> {
  let state = options.seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = 0; index < options.cases; index++) {
    const value = options.generate(random);
    try {
      if (!options.invariant(value))
        return {
          passed: false,
          seed: options.seed,
          cases: index + 1,
          counterexample: value,
        };
    } catch (error) {
      return {
        passed: false,
        seed: options.seed,
        cases: index + 1,
        counterexample: value,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { passed: true, seed: options.seed, cases: options.cases };
}

export type RepeatOutcome = "passed" | "failed" | "timeout" | "error";
export function analyzeRepeats(outcomes: readonly RepeatOutcome[]) {
  const distinct = new Set(outcomes);
  return {
    runs: outcomes.length,
    flaky: distinct.size > 1,
    evidence:
      distinct.size > 1
        ? "mixed outcomes across repeated runs"
        : outcomes.length > 1
          ? "consistent repeated outcome"
          : "insufficient repeat evidence",
  } as const;
}
