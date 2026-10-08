import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config";
import {
  EvaluationResultSchema,
  ExperimentSchema,
  type EvaluationResult,
  type Experiment,
} from "./types";

function fileFor(directory: string, prefix: string, id: string) {
  return join(directory, `${prefix}-${id}.json`);
}
async function save<T>(
  directory: string,
  prefix: string,
  id: string,
  value: T,
) {
  await mkdir(directory, { recursive: true });
  const destination = fileFor(directory, prefix, id);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "w",
  });
  await rename(temporary, destination);
}

export async function saveEvaluationResult(
  value: EvaluationResult,
  directory = PATHS.sessionsDir,
) {
  const result = EvaluationResultSchema.parse(value);
  await save(directory, "evaluation", result.evaluationId, result);
}
export async function loadEvaluationResult(
  id: string,
  directory = PATHS.sessionsDir,
) {
  return EvaluationResultSchema.parse(
    JSON.parse(await readFile(fileFor(directory, "evaluation", id), "utf8")),
  );
}
export async function listEvaluationResults(directory = PATHS.sessionsDir) {
  const files = await readdir(directory).catch(() => []);
  const results: EvaluationResult[] = [];
  for (const file of files.filter(
    (item) => item.startsWith("evaluation-") && item.endsWith(".json"),
  )) {
    try {
      results.push(
        await loadEvaluationResult(
          file.slice("evaluation-".length, -5),
          directory,
        ),
      );
    } catch {
      /* corrupted records are not returned */
    }
  }
  return results;
}
export async function saveExperiment(
  value: Experiment,
  directory = PATHS.sessionsDir,
) {
  const experiment = ExperimentSchema.parse(value);
  await save(directory, "experiment", experiment.experimentId, experiment);
}
export async function loadExperiment(
  id: string,
  directory = PATHS.sessionsDir,
) {
  return ExperimentSchema.parse(
    JSON.parse(await readFile(fileFor(directory, "experiment", id), "utf8")),
  );
}
export async function listExperiments(directory = PATHS.sessionsDir) {
  const files = await readdir(directory).catch(() => []);
  const results: Experiment[] = [];
  for (const file of files.filter(
    (item) => item.startsWith("experiment-") && item.endsWith(".json"),
  )) {
    try {
      results.push(
        await loadExperiment(file.slice("experiment-".length, -5), directory),
      );
    } catch {
      /* corrupted records are not returned */
    }
  }
  return results;
}
