import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentRole,
  type AgentTask,
} from "./types";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly disabled = new Set<string>();

  register(value: AgentDefinition) {
    const definition = AgentDefinitionSchema.parse(value);
    if (this.agents.has(definition.id))
      throw new Error(`agent already registered: ${definition.id}`);
    this.agents.set(definition.id, definition);
    return definition;
  }

  disable(id: string) {
    this.require(id);
    this.disabled.add(id);
  }

  activate(id: string) {
    this.require(id);
    this.disabled.delete(id);
  }

  get(id: string) {
    const value = this.agents.get(id);
    if (!value) throw new Error(`agent not found: ${id}`);
    return value;
  }

  list() {
    return [...this.agents.values()].map((agent) => ({
      ...agent,
      active: !this.disabled.has(agent.id),
    }));
  }

  select(task: AgentTask) {
    const candidates = this.list().filter(
      (agent) =>
        agent.active &&
        agent.role === task.role &&
        task.requiredCapabilities.every(
          (capability) => !agent.deniedCapabilities.includes(capability),
        ) &&
        (!task.workspaceRequired || agent.workspacePolicy !== "none"),
    );
    const selected = candidates[0];
    if (!selected)
      throw new Error(`no active compatible agent for role ${task.role}`);
    return selected;
  }

  private require(id: string) {
    return this.get(id);
  }
}

type ModelSelection = Partial<
  Record<
    AgentRole,
    {
      id: string;
      provider: string;
      contextWindow: number;
      supportsTools: boolean;
      externalApproved?: boolean;
    }
  >
>;

const readTools = [
  "read_file",
  "list_files",
  "search_files",
  "search_symbols",
  "repo_overview",
  "index_status",
  "find_symbol",
  "find_dependencies",
  "find_dependents",
  "retrieve_code_context",
  "analyze_change_impact",
];
const verificationTools = ["bash", "read_file", "list_files", "search_files"];
const writeTools = [...readTools, "write_file", "str_replace", "apply_patch"];

export function createDefaultAgentRegistry(models: ModelSelection = {}) {
  const registry = new AgentRegistry();
  const roles: Array<{
    id: string;
    role: AgentRole;
    description: string;
    allowedTools: string[];
    workspacePolicy: "none" | "read" | "write";
    canDelegate: boolean;
  }> = [
    {
      id: "coordinator",
      role: "coordinator",
      description:
        "Coordinates bounded delegated work and consolidates evidence.",
      allowedTools: readTools,
      workspacePolicy: "read",
      canDelegate: true,
    },
    {
      id: "explorer",
      role: "explorer",
      description:
        "Collects grounded repository structure and dependency evidence.",
      allowedTools: readTools,
      workspacePolicy: "read",
      canDelegate: false,
    },
    {
      id: "planner",
      role: "planner",
      description:
        "Produces a validated implementation plan from repository evidence.",
      allowedTools: readTools,
      workspacePolicy: "read",
      canDelegate: false,
    },
    {
      id: "implementer",
      role: "implementer",
      description: "Applies authorized changes in a dedicated workspace.",
      allowedTools: writeTools,
      workspacePolicy: "write",
      canDelegate: false,
    },
    {
      id: "tester",
      role: "tester",
      description: "Runs bounded verification and records actual evidence.",
      allowedTools: verificationTools,
      workspacePolicy: "read",
      canDelegate: false,
    },
    {
      id: "reviewer",
      role: "reviewer",
      description:
        "Reviews diffs and evidence without modifying the workspace.",
      allowedTools: [...readTools, "index_status"],
      workspacePolicy: "read",
      canDelegate: false,
    },
  ];
  for (const role of roles) {
    const model = models[role.role] ?? {
      id: "configured-by-caller",
      provider: "injected",
      contextWindow: 128_000,
      supportsTools: true,
      externalApproved: false,
    };
    registry.register({
      ...role,
      model: { ...model, externalApproved: model.externalApproved ?? false },
      deniedCapabilities:
        role.workspacePolicy === "read" ? ["create", "modify", "delete"] : [],
      requiredSkills: [],
      context: { maxMessages: 80, maxArtifactChars: 20_000 },
      budget: {
        maxIterations: 12,
        maxTokens: 40_000,
        wallClockMs: 120_000,
        maxToolCalls: 40,
      },
      retry: { maxAttempts: 1 },
    });
  }
  return registry;
}
