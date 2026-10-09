# Recovery Runbook

## Provider failure

1. Read the reported provider failure category and request ID.
2. Do not manually replay a tool call that may have had side effects.
3. Resume with bun run dev -- --continue.
4. Re-run verification before accepting any change.

## Interrupted agent run

1. Stop the process with Ctrl-C if it is still active.
2. Inspect the session checkpoint with the session inspection commands.
3. Resume only after reviewing unfinished tool-call markers.
4. Uncertain side-effecting operations require reconciliation, not automatic replay.

## Patch conflict

1. Preserve the current user file.
2. Inspect the returned conflict and current diff.
3. Rebuild the patch from current content.
4. Use dry-run first, then approve each affected target.
5. Do not force undo over independently modified content.

## MCP disconnect

1. Treat an interrupted write as uncertain.
2. Do not retry destructive or side-effecting calls automatically.
3. Reconnect only to an explicitly configured and authorized server.
4. Rediscover tools and revalidate permissions after reconnect.

## Workspace recovery

1. Inspect workspace status and lock state.
2. Preserve the worktree for manual reconciliation if its state is uncertain.
3. Do not delete a missing or dirty workspace as an automatic repair.
4. Re-run verification after recovery.

## Sandbox limitation

The current repository has no registered OS/container/VM isolation backend. For untrusted repositories, do not enable unattended execution. requireIsolation fails closed when requested, but it does not provide isolation by itself.
