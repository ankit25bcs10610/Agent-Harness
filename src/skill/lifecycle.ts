import { discoverSkills, loadSkill } from "./index";
import type { SkillMetadata } from "./index";
import { PATHS } from "../config";
import { join } from "node:path";

export type SkillLifecycleEvent = {
  type: "activated" | "deactivated";
  skill: string;
  at: number;
};
export type SkillLifecycleState = {
  active: string[];
  events: SkillLifecycleEvent[];
};

export type SkillLifecycleOptions = {
  projectDirectory?: string;
  globalDirectory?: string | null;
};

export class SkillLifecycle {
  private active = new Set<string>();
  private events: SkillLifecycleEvent[] = [];
  private readonly options: {
    projectDirectory: string;
    globalDirectory?: string;
  };

  constructor(
    state?: SkillLifecycleState,
    options: SkillLifecycleOptions = {},
  ) {
    this.options = {
      projectDirectory: options.projectDirectory ?? PATHS.skillsDir,
    };
    const globalDirectory =
      options.globalDirectory === null
        ? undefined
        : (options.globalDirectory ??
          (process.env.HOME
            ? join(process.env.HOME, ".chiku", "skills")
            : undefined));
    if (globalDirectory) this.options.globalDirectory = globalDirectory;
    for (const name of state?.active ?? []) this.active.add(name);
    this.events = [...(state?.events ?? [])];
  }

  async activate(name: string): Promise<{
    metadata: SkillMetadata;
    instructions: string;
    references: string[];
  }> {
    const discovery = await discoverSkills(
      this.options.projectDirectory,
      this.options.globalDirectory,
    );
    const skill = discovery.skills.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`skill not found: ${name}`);
    for (const dependency of skill.requiresSkills)
      if (!discovery.skills.some((candidate) => candidate.name === dependency))
        throw new Error(`missing skill dependency: ${dependency}`);
    const loaded = await loadSkill(skill);
    if (!this.active.has(name)) {
      this.active.add(name);
      this.events.push({ type: "activated", skill: name, at: Date.now() });
    }
    return loaded;
  }

  deactivate(name: string): void {
    if (this.active.delete(name))
      this.events.push({ type: "deactivated", skill: name, at: Date.now() });
  }

  state(): SkillLifecycleState {
    return { active: [...this.active].sort(), events: [...this.events] };
  }
}
