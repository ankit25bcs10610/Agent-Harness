import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import type { MutationCase, MutationOperator, MutationReport } from "./types";

type Candidate = {
  operator: MutationOperator;
  offset: number;
  replacement: string;
  line: number;
};
type MutationRunner = (
  workspace: string,
  mutant: MutationCase,
  signal: AbortSignal,
) => Promise<"killed" | "survived" | "timeout" | "error">;

function candidates(source: string, file: string): Candidate[] {
  const result: Candidate[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const line = (offset: number) => source.slice(0, offset).split("\n").length;
  for (const match of source.matchAll(/===|!==|>=|<=|>|</g))
    result.push({
      operator: "comparison-boundary",
      offset: match.index!,
      replacement:
        match[0] === "==="
          ? "!=="
          : match[0] === "!=="
            ? "==="
            : match[0] === ">"
              ? ">="
              : match[0] === ">="
                ? ">"
                : match[0] === "<"
                  ? "<="
                  : "<",
      line: line(match.index!),
    });
  for (const match of source.matchAll(/\b(true|false)\b/g))
    result.push({
      operator: "boolean-negation",
      offset: match.index!,
      replacement: match[1] === "true" ? "false" : "true",
      line: line(match.index!),
    });
  if (
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    }).diagnostics?.length
  )
    return [];
  return result;
}

export async function runMutationAnalysis(options: {
  root: string;
  files: readonly string[];
  maxMutants: number;
  timeoutMs: number;
  run: MutationRunner;
  signal?: AbortSignal;
}): Promise<MutationReport> {
  const workspace = await mkdtemp(join(tmpdir(), "chiku-mutants-"));
  const cases: MutationCase[] = [];
  try {
    for (const file of options.files) {
      if (cases.length >= options.maxMutants) break;
      const sourcePath = join(options.root, file);
      const source = await readFile(sourcePath, "utf8").catch(() => "");
      if (!source) continue;
      const fileCandidates = candidates(source, file);
      for (const candidate of fileCandidates) {
        if (cases.length >= options.maxMutants) break;
        if (options.signal?.aborted)
          throw new Error("mutation analysis cancelled");
        const id = `mutant-${cases.length + 1}`;
        const mutated = `${source.slice(0, candidate.offset)}${candidate.replacement}${source.slice(candidate.offset + (candidate.operator === "comparison-boundary" && source[candidate.offset] === ">" && source.slice(candidate.offset, candidate.offset + 2) === ">=" ? 2 : source.slice(candidate.offset, candidate.offset + 3) === "===" || source.slice(candidate.offset, candidate.offset + 3) === "!==" ? 3 : 1))}`;
        const target = join(workspace, file);
        await mkdirFor(target);
        await writeFile(target, mutated);
        const mutant: MutationCase = {
          id,
          file,
          operator: candidate.operator,
          line: candidate.line,
          status: "UNKNOWN",
        };
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), options.timeoutMs);
          const result = await options.run(
            workspace,
            mutant,
            controller.signal,
          );
          clearTimeout(timer);
          mutant.status =
            result === "killed"
              ? "KILLED"
              : result === "survived"
                ? "SURVIVED"
                : result === "timeout"
                  ? "TIMEOUT"
                  : "UNKNOWN";
        } catch (error) {
          mutant.status =
            error instanceof Error && /unsupported/i.test(error.message)
              ? "UNSUPPORTED"
              : "UNKNOWN";
          mutant.reason =
            error instanceof Error ? error.message : String(error);
        }
        cases.push(mutant);
        await rm(target, { force: true }).catch(() => undefined);
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  const valid = cases.filter((item) =>
    ["KILLED", "SURVIVED", "TIMEOUT"].includes(item.status),
  );
  const killedCount = cases.filter((item) => item.status === "KILLED").length;
  return {
    cases,
    validCount: valid.length,
    killedCount,
    score: valid.length ? killedCount / valid.length : null,
    limitations: [
      "Only comparison and boolean operators are currently supported",
      "Survivors require human review; they are not automatically defects",
    ],
  };
}

async function mkdirFor(path: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
}
