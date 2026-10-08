# Isolated workspace execution

Chiku can run a task in an isolated Git worktree instead of the checkout that
started the terminal session. Workspace records are stored atomically under
`.chiku/workspaces/` (or `CHIKU_DIR/workspaces` when configured) and contain
the repository identity, base commit, worktree path, branch, lifecycle state,
contract references, and verification metadata.

## Lifecycle

`CREATING -> READY -> QUEUED -> RUNNING -> COMPLETED` is the normal path.
Failures move to `FAILED` or `RECOVERY_REQUIRED`. Integration is explicit:
`COMPLETED -> INTEGRATING -> INTEGRATED`, with `CONFLICTED` as the safe result
when the target is dirty, advanced beyond the recorded base, contains source
untracked files, or rejects the preflight patch.

## Isolation boundary

The active workspace root is passed through `ToolContext`. File, search,
repository-intelligence, patch, and shell tools resolve paths against that
root. The central permission engine still decides whether a capability is
allowed. The process executor validates its working directory and applies the
configured timeout, cancellation, output, and environment policy.

This is workspace isolation, not an operating-system sandbox. An approved
process may still access the network or invoke programs that escape the
workspace. There is no syscall, container, namespace, or descriptor-based
guarantee yet.

## Integration safety

Integration requires explicit approval and uses a binary-capable Git patch
after `git apply --check`. It never silently includes untracked source files or
applies over a dirty/advanced target. The `.chiku` metadata directory is
excluded from these checks. If the worktree disappears or changes repository
identity, `WorkspaceManager.reconcile()` marks the record
`RECOVERY_REQUIRED` rather than recreating it or repeating actions.

## Terminal commands

Use `/workspaces` or `/workspace list` to inspect records. The supported
operations are:

```text
/workspace create <task-name>
/workspace show <workspace-id>
/workspace status <workspace-id>
/workspace diff <workspace-id>
/workspace use <workspace-id>
/workspace reconcile
```

After `/workspace use`, subsequent tools and verification commands are routed
to that worktree for the active session.
