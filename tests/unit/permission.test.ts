import { describe, expect, test } from "bun:test";
import { checkCommand, checkEdit, checkPath } from "../../src/permission/match";

describe("permission policy", () => {
  test("requires approval for unknown commands and allows exact rules", () => {
    expect(checkCommand("git status", [])).toBe("ask");
    expect(checkCommand("git status", [/^git status$/])).toBe("allowed");
  });

  test("always asks for shell chaining and destructive commands", () => {
    expect(checkCommand("git status && git diff", [])).toBe("always-ask");
    expect(checkCommand("rm -rf build", [])).toBe("always-ask");
    expect(checkCommand("git push --force", [/^git push/])).toBe("always-ask");
  });

  test("keeps paths inside the project root", () => {
    expect(checkPath("src/index.ts", "/tmp/project")).toBe("allowed");
    expect(checkPath("../secrets.txt", "/tmp/project")).toBe("always-ask");
    expect(checkEdit("/tmp/project/src/a.ts", "/tmp/project", [])).toBe("ask");
    expect(checkEdit("/tmp/outside.ts", "/tmp/project", [])).toBe("always-ask");
  });

  test("does not treat a sibling prefix as inside the root", () => {
    expect(checkPath("/tmp/project-other/file", "/tmp/project")).toBe(
      "always-ask",
    );
  });
});
