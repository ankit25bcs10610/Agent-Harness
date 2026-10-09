import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(path).text();

test("contributor documentation exposes executable local validation", async () => {
  const contributing = await read("CONTRIBUTING.md");
  expect(contributing).toContain("bun install --frozen-lockfile");
  expect(contributing).toContain("bun run typecheck");
  expect(contributing).toContain("bun test");
  expect(contributing).toContain("bun run security:check");
  expect(contributing).toContain("Maintainers make the final review");
});

test("community templates route security reports away from public issues", async () => {
  const securityRoute = await read(".github/ISSUE_TEMPLATE/config.yml");
  const docsTemplate = await read(".github/ISSUE_TEMPLATE/documentation.yml");
  expect(securityRoute).toContain("security/advisories/new");
  expect(securityRoute).toContain("Do not post vulnerability details publicly");
  expect(docsTemplate).toContain("Documentation location");
  expect(docsTemplate).toContain("Chiku version or commit");
});

test("CI is read-only and does not expose release credentials", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).not.toContain("secrets.NPM_TOKEN");
  expect(workflow).not.toContain("secrets.GITHUB_TOKEN");
});

test("README does not describe the current test and CI system as placeholders", async () => {
  const readme = await read("README.md");
  expect(readme).toContain("bun test");
  expect(readme).toContain("cross-platform CI workflow");
  expect(readme).not.toContain("currently a failing placeholder");
});
