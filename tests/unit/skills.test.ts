import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverSkills, loadSkill, recommendSkills } from "../../src/skill";
import { SkillLifecycle } from "../../src/skill/lifecycle";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("discovers validated metadata, reports dependencies, and recommends deterministically", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-skills-"));
  await mkdir(join(root, "secure"), { recursive: true });
  await writeFile(
    join(root, "secure", "SKILL.md"),
    "---\nname: secure-review\ndescription: Review security issues\nversion: 1.0.0\ntags: [security]\ntriggers: [audit authentication]\nrequires:\n  skills: [missing]\n---\nUse the security checklist.\n",
  );
  const discovery = await discoverSkills(root, undefined);
  expect(discovery.skills[0]?.name).toBe("secure-review");
  expect(discovery.diagnostics[0]?.error).toContain("missing skill dependency");
  expect(
    recommendSkills(discovery.skills, "security audit")[0]?.skill.name,
  ).toBe("secure-review");
});

test("loads resources progressively and records activation lifecycle", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-skills-"));
  await mkdir(join(root, "debugging", "references"), { recursive: true });
  await writeFile(
    join(root, "debugging", "SKILL.md"),
    "---\nname: debugging\ndescription: Debug failures\nversion: 1.0.0\n---\nInspect the failure.\n",
  );
  await writeFile(
    join(root, "debugging", "references", "checklist.md"),
    "check",
  );
  const discovery = await discoverSkills(root, undefined);
  const loaded = await loadSkill(discovery.skills[0]!);
  expect(loaded.instructions).toContain("Inspect");
  expect(loaded.references).toHaveLength(1);
  const lifecycle = new SkillLifecycle(undefined, {
    projectDirectory: root,
    globalDirectory: null,
  });
  const active = await lifecycle.activate("debugging");
  expect(active.metadata.name).toBe("debugging");
  expect(lifecycle.state().events[0]?.type).toBe("activated");
  lifecycle.deactivate("debugging");
  expect(lifecycle.state().active).toHaveLength(0);
});

test("does not duplicate activation events and blocks missing dependencies", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-skills-"));
  await mkdir(join(root, "blocked"), { recursive: true });
  await writeFile(
    join(root, "blocked", "SKILL.md"),
    "---\nname: blocked\ndescription: Blocked skill\nrequires:\n  skills: [missing] \n---\nNo activation.\n",
  );
  const lifecycle = new SkillLifecycle(undefined, {
    projectDirectory: root,
    globalDirectory: null,
  });
  await expect(lifecycle.activate("blocked")).rejects.toThrow(
    "missing skill dependency",
  );
  expect(lifecycle.state()).toEqual({ active: [], events: [] });

  await mkdir(join(root, "ready"), { recursive: true });
  await writeFile(
    join(root, "ready", "SKILL.md"),
    "---\nname: ready\ndescription: Ready skill\n---\nReady.\n",
  );
  await lifecycle.activate("ready");
  await lifecycle.activate("ready");
  expect(lifecycle.state().active).toEqual(["ready"]);
  expect(lifecycle.state().events).toHaveLength(1);
});
