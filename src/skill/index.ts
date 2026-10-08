import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { PATHS } from "../config";
import type { Skill } from "../context/types";

export type SkillMetadata = Skill & {
  version: string;
  category?: string;
  tags: string[];
  triggers: string[];
  requiresTools: string[];
  requiresSkills: string[];
  activation: "automatic" | "explicit";
  path: string;
  source: "project" | "global";
};
export type SkillDiagnostic = { path: string; error: string };
export type SkillDiscovery = {
  skills: SkillMetadata[];
  diagnostics: SkillDiagnostic[];
};

function parseSkill(
  content: string,
  path: string,
  source: SkillMetadata["source"],
): SkillMetadata {
  if (!content.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = content.indexOf("\n---", 3);
  if (end < 0) throw new Error("unterminated YAML frontmatter");
  const value = parse(content.slice(3, end));
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string"
  )
    throw new Error("name and description are required");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name))
    throw new Error("skill name must be lowercase kebab-case");
  const version = typeof value.version === "string" ? value.version : "0.0.0";
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("invalid skill version");
  const list = (key: string) =>
    Array.isArray(value[key]) &&
    value[key].every((item: unknown) => typeof item === "string")
      ? (value[key] as string[])
      : [];
  const activation =
    value.activation === "automatic" ? "automatic" : "explicit";
  const requires =
    value.requires && typeof value.requires === "object"
      ? (value.requires as Record<string, unknown>)
      : {};
  const requiresSkills =
    Array.isArray(requires.skills) &&
    requires.skills.every((item) => typeof item === "string")
      ? (requires.skills as string[])
      : [];
  return {
    name: value.name,
    description: value.description,
    version,
    category: typeof value.category === "string" ? value.category : undefined,
    tags: list("tags"),
    triggers: list("triggers"),
    requiresTools: list("tools"),
    requiresSkills,
    activation,
    path,
    source,
  };
}

async function scan(
  directory: string,
  source: SkillMetadata["source"],
  diagnostics: SkillDiagnostic[],
): Promise<SkillMetadata[]> {
  const result: SkillMetadata[] = [];
  try {
    await realpath(directory);
  } catch {
    return result;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    const skillPath = entry.isDirectory()
      ? join(path, "SKILL.md")
      : entry.name.endsWith(".md")
        ? path
        : undefined;
    if (!skillPath) continue;
    try {
      result.push(
        parseSkill(await readFile(skillPath, "utf8"), skillPath, source),
      );
    } catch (error) {
      diagnostics.push({
        path: skillPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function discoverSkills(
  projectDirectory = PATHS.skillsDir,
  globalDirectory = process.env.HOME
    ? join(process.env.HOME, ".chiku", "skills")
    : undefined,
): Promise<SkillDiscovery> {
  const diagnostics: SkillDiagnostic[] = [];
  const project = await scan(projectDirectory, "project", diagnostics);
  const global = globalDirectory
    ? await scan(globalDirectory, "global", diagnostics)
    : [];
  const byName = new Map<string, SkillMetadata>();
  for (const skill of [...global, ...project]) byName.set(skill.name, skill);
  for (const skill of byName.values())
    for (const dependency of skill.requiresSkills)
      if (!byName.has(dependency))
        diagnostics.push({
          path: skill.path,
          error: `missing skill dependency: ${dependency}`,
        });
  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics,
  };
}

export async function loadSkill(skill: SkillMetadata): Promise<{
  metadata: SkillMetadata;
  instructions: string;
  references: string[];
}> {
  const content = await readFile(skill.path, "utf8");
  const end = content.indexOf("\n---", 3);
  const directory = join(skill.path, "..");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const references = entries
    .filter(
      (entry) =>
        entry.isDirectory() && ["references", "examples"].includes(entry.name),
    )
    .map((entry) => join(directory, entry.name));
  return {
    metadata: skill,
    instructions: content.slice(end + 4).trim(),
    references,
  };
}

export function recommendSkills(
  skills: SkillMetadata[],
  task: string,
): { skill: SkillMetadata; score: number; reasons: string[] }[] {
  const terms = new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((term) => term.length > 2),
  );
  return skills
    .map((skill) => {
      const haystack = [
        skill.name,
        skill.description,
        ...skill.tags,
        ...skill.triggers,
      ]
        .join(" ")
        .toLowerCase();
      const matched = [...terms].filter((term) => haystack.includes(term));
      return {
        skill,
        score: matched.length,
        reasons: matched.map((term) => `matched: ${term}`),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name),
    );
}
