import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNoSymlinkRace,
  canonicalizePath,
  checkCommand,
  checkPath,
} from "../../src/permission/match";

describe("capability permission policy", () => {
  test("requires a capability-scoped grant and keeps capabilities separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "chiku-permission-"));
    const target = join(root, "notes.txt");
    await writeFile(target, "notes");
    const canonical = await canonicalizePath(target, root);
    const grants = [
      {
        capability: "read" as const,
        scope: "exact" as const,
        target: canonical.target,
      },
    ];
    expect((await checkPath(target, root, "read", grants)).decision).toBe(
      "allow",
    );
    expect((await checkPath(target, root, "modify", grants)).decision).toBe(
      "ask",
    );
  });

  test("requires approval for commands and keeps high-risk commands ask-only", () => {
    expect(checkCommand("git status", [])).toBe("ask");
    expect(
      checkCommand("git status", [
        { capability: "execute", scope: "exact", target: "git status" },
      ]),
    ).toBe("allow");
    expect(
      checkCommand("git status && git diff", [
        { capability: "execute", scope: "prefix", target: "git status" },
      ]),
    ).toBe("ask");
    expect(checkCommand("rm -rf build", [])).toBe("ask");
  });

  test("blocks sensitive files and hidden paths by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "chiku-permission-"));
    await writeFile(join(root, ".env"), "SECRET=x");
    await writeFile(join(root, ".hidden"), "hidden");
    expect(
      (await checkPath(join(root, ".env"), root, "read", [])).decision,
    ).toBe("deny");
    expect(
      (await checkPath(join(root, ".hidden"), root, "read", [])).decision,
    ).toBe("ask");
  });

  test("rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "chiku-permission-"));
    const outside = await mkdtemp(join(tmpdir(), "chiku-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "link"));
    await expect(checkPath("../secret.txt", root, "read", [])).rejects.toThrow(
      "escapes",
    );
    await expect(
      checkPath("link/secret.txt", root, "read", []),
    ).rejects.toThrow("escapes");
  });

  test("detects a target replaced by a symlink before execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "chiku-permission-"));
    const outside = await mkdtemp(join(tmpdir(), "chiku-outside-"));
    const target = join(root, "target.txt");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), target);
    await expect(assertNoSymlinkRace(target)).rejects.toThrow("symbolic link");
  });
});
