import type { EvaluationResult, Experiment } from "./types";

export function evaluationJson(result: EvaluationResult) {
  return JSON.stringify(result, null, 2);
}
export function evaluationMarkdown(result: EvaluationResult) {
  const lines = [
    `# Evaluation ${result.evaluationId}`,
    "",
    `- Status: **${result.status}**`,
    `- Task: \`${result.taskId}\``,
    `- Duration: ${result.metrics.efficiency.durationMs} ms`,
    `- Changed files: ${result.metrics.correctness.changedFiles}`,
    "",
    "## Graders",
    ...result.grades.map(
      (grade) =>
        `- **${grade.grader}**: ${grade.outcome} — ${grade.evidence.join(" ")}`,
    ),
    "",
    "## Integrity",
    `- Grader tampered: ${result.integrity.graderTampered}`,
    `- Outside allowed paths: ${result.integrity.changedOutsideAllowedPaths.join(", ") || "none"}`,
  ];
  return lines.join("\n");
}
export function experimentMarkdown(experiment: Experiment) {
  return [
    `# Experiment ${experiment.name}`,
    "",
    `- Status: **${experiment.status}**`,
    `- Trials: ${experiment.trialCount}`,
    `- Results: ${experiment.results.length}`,
  ].join("\n");
}
