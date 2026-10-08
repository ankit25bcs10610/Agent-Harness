# Multi-agent orchestration

Prompt 17 adds a bounded orchestration core under `src/multiagent/`. It reuses
Chiku's existing model loop, tool registry, permission engine, workspaces, and
session directory; it does not create a second LLM execution loop.

## Runtime model

`AgentRegistry` validates role definitions and their model, tool, workspace,
delegation, and budget policy. `TaskDecomposer` validates a model-produced
proposal, limits task count/depth, resolves dependency keys, and builds a
cycle-checked `TaskGraph`. `MultiAgentScheduler` starts only dependency-ready
tasks within global and per-role limits. A configured `AgentWorkspaceAllocator`
creates a dedicated Git worktree for workspace-required tasks. Each task receives an independent
`AgentRuntime` invocation and a copied `ToolContext` with an explicit
`allowedTools` boundary.

The communication bus carries validated, versioned messages such as
`TASK_ASSIGNED`, `FINDINGS_READY`, `PLAN_READY`, `PATCH_PROPOSED`,
`VERIFICATION_RESULT`, and `REVIEW_FINDINGS`. Message payloads are untrusted
data and never grant permissions.

## Roles

The default registry supplies coordinator, explorer, planner, implementer,
tester, and reviewer definitions. Read-only roles receive repository inspection
tools only. Implementers receive file-editing tools but require a write-capable
workspace. No role can approve its own privileged operation.

Models are injected through `createDefaultAgentRegistry(models)`. The registry
does not silently switch providers or send repository content to an external
provider; the caller must provide an approved model configuration and a
`CompleteStreamFunc`.

## Persistence and recovery

`saveAgentSession` atomically persists the validated task graph, agent
definitions, executions, communication messages, and timestamps under the
existing session directory. `restore()` converts an uncertain `running` task
to `blocked`; it never blindly repeats a potentially side-effecting task.
Workspace reconciliation remains the source of truth for worktree identity.

## Terminal diagnostics

The following commands call runtime services directly:

```text
/agents
/agent list
/agent info <id>
/agent status <id>
/team status
/team tasks
/team graph
/parallel status
/parallel limit <count>
```

These commands inspect the registered runtime and do not ask a model to
simulate administrative state. Full end-to-end delegation from an arbitrary
natural-language request is intentionally not enabled until a provider/model
factory and explicit approval flow are supplied by the application.

## Security limitations

The scheduler and worktrees provide application-level isolation and bounded
coordination, not an OS sandbox. Approved processes may still access the
network or invoke other programs. Conflict resolution and integration remain
explicit operations; the orchestrator never silently chooses between
conflicting agent patches.
