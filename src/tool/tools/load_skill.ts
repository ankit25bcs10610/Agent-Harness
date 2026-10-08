import { z } from "zod";
import type { Tool } from "../types";
import { discoverSkills, loadSkill as loadDiscoveredSkill } from "../../skill";

export const loadSkill: Tool<
  { skillName: z.ZodString },
  { skillBody: string }
> = {
  name: "load_skill",
  description: "Load the body of a skill through the skill name.",
  parameters: z.object({
    skillName: z.string().describe("name of the skill to load"),
  }),
  getPermissionKey: () => undefined,
  execute: async ({ skillName }) => {
    try {
      if (
        skillName.includes(".") ||
        skillName.includes("\\") ||
        skillName.includes("/")
      )
        throw new Error("invalid skill name");
      const discovery = await discoverSkills();
      const skill = discovery.skills.find(
        (candidate) => candidate.name === skillName,
      );
      if (!skill) throw new Error(`skill not found: ${skillName}`);
      const loaded = await loadDiscoveredSkill(skill);
      return { skillBody: loaded.instructions };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Error reading skill "${skillName}": ${error.message}`);
      }
      throw new Error(`Error reading skill "${skillName}"`);
    }
  },
};
