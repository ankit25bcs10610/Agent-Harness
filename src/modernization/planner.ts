import {
  MigrationSpecSchema,
  type MigrationPlan,
  type MigrationRisk,
  type MigrationSpec,
  type ProjectInventory,
  type MigrationStep,
} from "./types";

export function validateMigrationSpec(value: unknown): MigrationSpec {
  return MigrationSpecSchema.parse(value);
}

export function assessMigrationRisk(
  spec: MigrationSpec,
  inventory: ProjectInventory,
): MigrationRisk {
  const reasons: string[] = [];
  if (spec.source.technology !== spec.target.technology)
    reasons.push("source and target technologies differ");
  if (spec.breakingChangeTolerance === "allowed")
    reasons.push("breaking changes are allowed by the request");
  if (inventory.dependencies.length > 25)
    reasons.push("large dependency surface");
  if (inventory.evidence.some((item) => item.name === "git-dirty-worktree"))
    reasons.push("baseline has uncommitted changes");
  if (!inventory.lockfile && inventory.dependencies.length > 0)
    reasons.push("dependencies have no detected lockfile");
  const level = reasons.some((reason) => reason.includes("differ"))
    ? "HIGH"
    : reasons.length >= 3
      ? "MODERATE"
      : reasons.length
        ? "LOW"
        : "UNKNOWN";
  return {
    level,
    reasons: reasons.length
      ? reasons
      : ["no compatibility evidence beyond the local repository was supplied"],
    affectedFiles: [...inventory.sourceFiles, "package.json"],
  };
}

export function createMigrationPlan(
  value: unknown,
  inventory: ProjectInventory,
): MigrationPlan {
  const spec = validateMigrationSpec(value);
  const uncertain: string[] = [];
  if (spec.target.technology !== spec.source.technology)
    uncertain.push(
      "cross-technology compatibility requires an authorized reference or human review",
    );
  if (!inventory.lockfile && inventory.dependencies.length)
    uncertain.push(
      "resolved dependency versions are unavailable without a lockfile",
    );
  const steps: MigrationStep[] = [
    {
      id: "inventory",
      description: "Capture repository and dependency evidence",
      dependsOn: [],
      requiresApproval: false,
      verification: [],
    },
    {
      id: "baseline",
      description:
        "Record Git revision, dirty state, and verification baseline",
      dependsOn: ["inventory"],
      requiresApproval: false,
      verification: inventory.verificationCommands.map(
        (check) => check.command,
      ),
    },
    {
      id: "transform",
      description: `Apply approved ${spec.source.technology} to ${spec.target.technology} transformations`,
      dependsOn: ["baseline"],
      requiresApproval: spec.humanApprovalRequired,
      verification: spec.requiredChecks,
    },
    {
      id: "verify",
      description: "Run independent build and behavior checks",
      dependsOn: ["transform"],
      requiresApproval: false,
      verification: [
        ...spec.requiredChecks,
        ...inventory.verificationCommands.map((check) => check.command),
      ],
    },
    {
      id: "review",
      description: "Review the actual diff and remaining compatibility risks",
      dependsOn: ["verify"],
      requiresApproval: true,
      verification: [],
    },
  ];
  return { spec, steps, risk: assessMigrationRisk(spec, inventory), uncertain };
}

export function topologicalPlan(plan: MigrationPlan): MigrationStep[] {
  const remaining = new Map(plan.steps.map((step) => [step.id, step]));
  const ordered: MigrationStep[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((step) =>
      step.dependsOn.every((id) => ordered.some((done) => done.id === id)),
    );
    if (!ready.length)
      throw new Error(
        "migration plan contains a dependency cycle or unknown prerequisite",
      );
    for (const step of ready) {
      ordered.push(step);
      remaining.delete(step.id);
    }
  }
  return ordered;
}
