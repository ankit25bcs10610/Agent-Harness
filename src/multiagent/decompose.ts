import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TaskGraph } from "./graph";
import type { AgentRole, AgentTask } from "./types";

const ProposedTaskSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  objective: z.string().min(1),
  role: z.enum([
    "coordinator",
    "explorer",
    "planner",
    "implementer",
    "tester",
    "reviewer",
  ]),
  dependsOn: z.array(z.string()).max(20),
  inputRequirements: z.array(z.string()).max(30),
  expectedOutput: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).min(1).max(30),
  risk: z.enum(["low", "normal", "high"]),
  requiredCapabilities: z.array(z.string()).max(30),
  workspaceRequired: z.boolean(),
  contractId: z.string().uuid().nullable().optional(),
});
export const DecompositionProposalSchema = z.object({
  tasks: z.array(ProposedTaskSchema).min(1).max(32),
});
export type DecompositionProposal = z.infer<typeof DecompositionProposalSchema>;

export type DecompositionLimits = {
  maxTasks: number;
  maxDepth: number;
  defaultBudget: AgentTask["budget"];
};

export class TaskDecomposer {
  constructor(
    private readonly propose: (
      input: string,
      signal: AbortSignal,
    ) => Promise<unknown>,
    private readonly limits: DecompositionLimits,
  ) {}

  async decompose(input: string, signal: AbortSignal) {
    const proposal = DecompositionProposalSchema.parse(
      await this.propose(input, signal),
    );
    if (proposal.tasks.length > this.limits.maxTasks)
      throw new Error(
        `task decomposition exceeds maximum of ${this.limits.maxTasks} tasks`,
      );
    const keys = new Set(proposal.tasks.map((task) => task.key));
    for (const task of proposal.tasks)
      for (const dependency of task.dependsOn)
        if (!keys.has(dependency))
          throw new Error(`unknown task dependency key: ${dependency}`);

    const depth = (key: string, trail = new Set<string>()): number => {
      if (trail.has(key))
        throw new Error("task decomposition contains a cycle");
      const task = proposal.tasks.find((item) => item.key === key);
      if (!task) throw new Error(`task not found: ${key}`);
      if (!task.dependsOn.length) return 1;
      const next = new Set(trail).add(key);
      return (
        1 +
        Math.max(...task.dependsOn.map((dependency) => depth(dependency, next)))
      );
    };
    const maxDepth = Math.max(...proposal.tasks.map((task) => depth(task.key)));
    if (maxDepth > this.limits.maxDepth)
      throw new Error(
        `task decomposition exceeds maximum depth of ${this.limits.maxDepth}`,
      );

    const ids = new Map(proposal.tasks.map((task) => [task.key, randomUUID()]));
    const now = new Date().toISOString();
    const graph = new TaskGraph();
    for (const task of proposal.tasks) {
      graph.add({
        id: ids.get(task.key)!,
        parentTaskId: null,
        objective: task.objective,
        role: task.role as AgentRole,
        dependencies: [],
        inputRequirements: task.inputRequirements,
        expectedOutput: task.expectedOutput,
        acceptanceCriteria: task.acceptanceCriteria,
        risk: task.risk,
        requiredCapabilities: task.requiredCapabilities,
        workspaceRequired: task.workspaceRequired,
        contractId: task.contractId ?? null,
        budget: this.limits.defaultBudget,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const task of proposal.tasks)
      for (const dependency of task.dependsOn)
        graph.addDependency(ids.get(task.key)!, ids.get(dependency)!);
    return graph;
  }
}
