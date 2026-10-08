import { z } from "zod";
import { discoverSkills, recommendSkills } from "../../skill";
import type { Tool } from "../types";

export const listSkills: Tool<any, unknown> = {
  name: "list_skills",
  description:
    "List discoverable skill metadata without loading full instructions.",
  parameters: z.object({}),
  getPermissionKey: () => undefined,
  execute: async () => {
    const discovery = await discoverSkills();
    return {
      skills: discovery.skills.map(
        ({
          name,
          description,
          version,
          category,
          tags,
          activation,
          source,
        }) => ({
          name,
          description,
          version,
          category,
          tags,
          activation,
          source,
        }),
      ),
      diagnostics: discovery.diagnostics,
    };
  },
};
export const recommendSkill: Tool<any, unknown> = {
  name: "recommend_skills",
  description:
    "Recommend relevant skills using deterministic metadata matching.",
  parameters: z.object({
    task: z.string().min(1),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  getPermissionKey: () => undefined,
  execute: async (args: any) => {
    const discovery = await discoverSkills();
    return recommendSkills(discovery.skills, args.task)
      .slice(0, args.limit ?? 5)
      .map(({ skill, score, reasons }) => ({
        name: skill.name,
        description: skill.description,
        score,
        reasons,
      }));
  },
};
