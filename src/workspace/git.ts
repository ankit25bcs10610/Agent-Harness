import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RepositoryMetadata } from "./types";

export class GitRepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "git_missing"
      | "not_repository"
      | "invalid_repository"
      | "permission_denied"
      | "command_failed",
  ) {
    super(message);
    this.name = "GitRepositoryError";
  }
}

export async function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("git operation cancelled");
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (signal?.aborted) throw new Error("git operation cancelled");
    if (code !== 0)
      throw new GitRepositoryError(
        stderr.trim() || `git exited with ${code}`,
        "command_failed",
      );
    return stdout.trim();
  } catch (error) {
    if (error instanceof GitRepositoryError) throw error;
    if (error instanceof Error && /ENOENT/.test(error.message))
      throw new GitRepositoryError(
        "git executable was not found",
        "git_missing",
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function lines(value: string) {
  return value ? value.split("\n").filter(Boolean) : [];
}

export async function discoverRepository(
  start = process.cwd(),
): Promise<RepositoryMetadata> {
  const location = await realpath(resolve(start)).catch(() => resolve(start));
  let root: string;
  try {
    root = await realpath(
      await runGit(location, ["rev-parse", "--show-toplevel"]),
    );
  } catch (error) {
    if (
      error instanceof GitRepositoryError &&
      error.code === "command_failed"
    ) {
      const bare = await runGit(location, [
        "rev-parse",
        "--is-bare-repository",
      ]).catch(() => "false");
      if (bare === "true") {
        const head = await runGit(location, ["rev-parse", "HEAD"]).catch(
          () => undefined,
        );
        return {
          isRepository: true,
          root: location,
          commonDirectory: location,
          branch: "HEAD (bare)",
          ...(head ? { head } : {}),
          dirty: false,
          untracked: [],
          worktrees: [],
          ...(await runGit(location, ["--version"])
            .then((gitVersion) => ({ gitVersion }))
            .catch(() => ({}))),
          capabilities: ["worktree", "diff", "status", "rev-parse"],
          identity: location,
        };
      }
      return {
        isRepository: false,
        root: location,
        dirty: false,
        untracked: [],
        worktrees: [],
        capabilities: [],
        identity: location,
      };
    }
    throw error;
  }
  const [
    bare,
    commonDirectory,
    currentWorktree,
    branch,
    status,
    worktreeList,
    version,
    identity,
  ] = await Promise.all([
    runGit(root, ["rev-parse", "--is-bare-repository"]),
    runGit(root, ["rev-parse", "--git-common-dir"]),
    runGit(root, ["rev-parse", "--show-toplevel"]),
    runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
      () => "HEAD (detached)",
    ),
    runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    runGit(root, ["worktree", "list", "--porcelain"]),
    runGit(root, ["--version"]),
    runGit(root, ["remote", "get-url", "origin"]).catch(() => root),
  ]);
  const head = await runGit(root, ["rev-parse", "HEAD"]).catch(() => undefined);
  const untracked = lines(status)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const parsedWorktrees: RepositoryMetadata["worktrees"] = [];
  let current: RepositoryMetadata["worktrees"] extends (infer T)[]
    ? T | undefined
    : never;
  for (const line of lines(worktreeList)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), bare: false };
      parsedWorktrees.push(current);
    } else if (line.startsWith("HEAD ") && current)
      current.head = line.slice(5);
    else if (line.startsWith("branch ") && current)
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare" && current) current.bare = true;
  }
  return {
    isRepository: bare !== "true",
    root,
    commonDirectory: resolve(root, commonDirectory),
    currentWorktree,
    branch,
    ...(head ? { head } : {}),
    dirty: status.length > 0,
    untracked,
    worktrees: parsedWorktrees,
    gitVersion: version,
    capabilities: ["worktree", "diff", "status", "rev-parse"],
    identity,
  };
}
