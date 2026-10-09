import { discoverRepository, runGit } from "../workspace/git";
import { inspectProject } from "./inspect";
import type { MigrationBaseline, ProjectInventory } from "./types";

export type BaselineCheckRunner = (check: {
  name: string;
  command: string;
}) => Promise<{
  status: "passed" | "failed" | "untested";
  reason?: string;
}>;

/**
 * Capture facts before a migration. Checks are never executed implicitly;
 * callers must provide an authorized runner for commands discovered locally.
 */
export async function captureBaseline(
  root: string,
  runCheck?: BaselineCheckRunner,
): Promise<{ baseline: MigrationBaseline; inventory: ProjectInventory }> {
  const [inventory, repository] = await Promise.all([
    inspectProject(root),
    discoverRepository(root).catch(() => undefined),
  ]);
  const status = repository
    ? await runGit(root, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]).catch(() => "")
    : "";
  const changedFiles = status
    .split("\n")
    .filter(Boolean)
    .map((line) => (line.length > 3 ? line.slice(3).trim() : line.trim()));
  const checks = runCheck
    ? await Promise.all(
        inventory.verificationCommands.map(async (check) => ({
          ...check,
          ...(await runCheck(check)),
        })),
      )
    : inventory.verificationCommands.map((check) => ({
        ...check,
        status: "untested" as const,
        reason:
          "verification command discovered but no authorized check runner was supplied",
      }));
  return {
    inventory,
    baseline: {
      capturedAt: new Date().toISOString(),
      root,
      revision: repository?.head ?? null,
      dirty: repository?.dirty ?? false,
      changedFiles,
      lockfile: inventory.lockfile,
      checks,
    },
  };
}
