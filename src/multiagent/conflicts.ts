import { WorkspaceManager } from "../workspace/manager";

export type AgentConflict = {
  workspaceIds: [string, string];
  files: string[];
  reason: "overlapping_file" | "delete_modify";
};

export async function detectAgentConflicts(
  manager: WorkspaceManager,
  workspaceIds: readonly string[],
): Promise<AgentConflict[]> {
  const diffs = await Promise.all(
    workspaceIds.map(async (workspaceId) => ({
      workspaceId,
      diff: await manager.diff(workspaceId),
    })),
  );
  const conflicts: AgentConflict[] = [];
  for (let left = 0; left < diffs.length; left++) {
    for (let right = left + 1; right < diffs.length; right++) {
      const leftFiles = new Set([
        ...diffs[left]!.diff.changedFiles,
        ...diffs[left]!.diff.untrackedFiles,
      ]);
      const rightFiles = new Set([
        ...diffs[right]!.diff.changedFiles,
        ...diffs[right]!.diff.untrackedFiles,
      ]);
      const files = [...leftFiles].filter((file) => rightFiles.has(file));
      if (!files.length) continue;
      const deletion = (value: string) =>
        value.startsWith("D ") || value.startsWith(" D");
      conflicts.push({
        workspaceIds: [diffs[left]!.workspaceId, diffs[right]!.workspaceId],
        files,
        reason:
          [...leftFiles].some(deletion) || [...rightFiles].some(deletion)
            ? "delete_modify"
            : "overlapping_file",
      });
    }
  }
  return conflicts;
}
