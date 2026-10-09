import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import type { Item } from "./types";
import type { SystemMessage } from "../provider";
import { completeStream } from "../provider";
import { runLoop } from "../loop/loop";
import { isToolError, summarizeArgs } from "./summarize";
import { ItemView } from "./ItemView";
import {
  optionsFor,
  PermissionPrompt,
  type AskRequest,
} from "./PermissionPrompt";
import type { UserDecision, Asker, PermSession } from "../permission/types";
import { saveSession } from "../session/store";
import type { Session } from "../session";
import { messagesToItems } from "./history";
import { TOOLS, UI } from "../config";
import type { LoopConfig } from "../loop/types";
import { StatusBar } from "./StatusBar";
import { createWorkflowController } from "../workflow/verify";
import { runTool } from "../tool/registry";
import type { ContextDiagnostics } from "../context/types";
import { Header } from "./Header";
import { SkillLifecycle } from "../skill/lifecycle";
import { PATHS } from "../config";
import { WorkspaceManager, type WorkspaceExecutionContext } from "../workspace";
import {
  createDefaultAgentRegistry,
  MultiAgentCoordinator,
} from "../multiagent";
import {
  EvaluationEngine,
  compareResults,
  listExperiments,
  proposeImprovements,
} from "../evaluation";
import { McpClientManager } from "../mcp";
import { diagnostics } from "../cli";
import { listIncidents } from "../maintenance/incidents";

const permissions: PermSession = {
  projectRoot: process.cwd(),
  grants: [],
  audit: [],
};

type Props = {
  systemPrompt: SystemMessage;
  session: Session;
  config: LoopConfig;
};
type LiveTool = { name: string; summary: string };

let nextId = 1;

const COMMANDS: Record<string, string> = {
  "/status": "Run git status and summarize the current repository state.",
  "/diff": "Inspect the current git diff and explain every meaningful change.",
  "/tree":
    "Show a concise project tree, excluding dependencies and build output.",
  "/typecheck":
    "Run the project's TypeScript type check and explain any errors.",
  "/test": "Find and run the project's test suite, then report the result.",
  "/lint": "Find and run the project's lint command, then explain any issues.",
  "/format":
    "Check the project formatting and format files only when necessary.",
  "/build": "Find and run the project's build command, then report the result.",
  "/audit":
    "Audit project dependencies for outdated or vulnerable packages and summarize the findings.",
  "/review":
    "Review the current changes for bugs, security problems, and missing validation. Do not edit files.",
  "/start":
    "Find the development server command and start it only after explaining the command and asking for approval if needed.",
  "/stop":
    "Find the development server process started for this project and stop it only after asking for approval.",
  "/commit":
    "Review the current diff, propose a concise commit message, and create a commit only after explicit approval.",
  "/deploy":
    "Inspect the deployment configuration and explain the deployment steps. Do not deploy without explicit approval.",
  "/index":
    "Rebuild the repository intelligence index and report indexed files, symbols, and errors.",
  "/repo": "Show a concise repository intelligence overview.",
  "/symbols": "Find important repository symbols relevant to the request.",
  "/impact": "Analyze likely dependent files affected by the current changes.",
  "/contracts": "List persisted change contracts and their current status.",
  "/workspaces": "List managed Git workspaces.",
  "/workspace": "Manage workspaces: list, create, show, use, status, or diff.",
  "/agents": "List registered agent roles and their capability policies.",
  "/agent": "Inspect a registered agent or its current executions.",
  "/team": "Inspect the multi-agent task graph and execution state.",
  "/parallel": "Inspect or change the bounded parallel-agent limit.",
  "/eval": "Inspect evaluation runs and benchmark results.",
  "/benchmark": "Inspect registered benchmark suites.",
  "/experiments": "Inspect persisted evaluation experiments.",
  "/improve": "Inspect evidence-backed improvement candidates.",
  "/mcp": "Manage explicitly configured MCP servers and discovered tools.",
  "/skill":
    "Activate a skill by name, or deactivate it with /skill off <name>.",
  "/health":
    "Show local runtime, workspace, storage, and credential configuration health.",
  "/incidents":
    "Inspect locally persisted crash incidents. No external report is submitted.",
};

function resolveCommand(text: string): string {
  const [firstWord = ""] = text.trim().split(/\s+/);
  const command = firstWord.toLowerCase();
  if (command === "/help") {
    return `Available commands: ${Object.keys(COMMANDS).join(", ")}. You can also type any natural-language request.`;
  }
  return COMMANDS[command] ?? text;
}

export function App({ systemPrompt, session, config }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [resizeKey, setResizeKey] = useState(0); // new key remounts <Static>, reprinting every item
  const [items, setItems] = useState<Item[]>(() => [
    { id: 0, kind: "banner" },
    ...messagesToItems(session.state?.messages ?? [], () => nextId++),
  ]); // static items
  const [input, setInput] = useState("");
  const [liveText, setLiveText] = useState("");
  const [liveReasoning, setLiveReasoning] = useState("");
  const [liveTool, setLiveTool] = useState<LiveTool | null>(null);
  const [running, setRunning] = useState(false);
  const [contextDiagnostics, setContextDiagnostics] =
    useState<ContextDiagnostics>();
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // finished items are printed once at the current width; after a resize, clear and reprint them
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stdout.write("\x1b[2J\x1b[3J\x1b[H"); // clear screen and scrollback, cursor home
        setResizeKey((k) => k + 1);
      }, UI.resizeDebounceMs);
    };
    stdout.on("resize", onResize);
    return () => {
      clearTimeout(timer);
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef("");
  const [ask, setAsk] = useState<AskRequest | null>(null);
  const [selected, setSelected] = useState(0);
  const sessionRef = useRef(session);
  const skillLifecycleRef = useRef(
    new SkillLifecycle(session.skills ?? session.state?.skills, {
      projectDirectory: PATHS.skillsDir,
    }),
  );
  const workspaceManagerRef = useRef(
    new WorkspaceManager({ repositoryRoot: process.cwd() }),
  );
  const activeWorkspaceRef = useRef<WorkspaceExecutionContext | undefined>(
    undefined,
  );
  const agentRegistryRef = useRef(createDefaultAgentRegistry());
  const coordinatorRef = useRef(
    new MultiAgentCoordinator(agentRegistryRef.current, {
      maxActiveAgents: 2,
    }),
  );
  const evaluationRef = useRef(new EvaluationEngine());
  const mcpRef = useRef(new McpClientManager());

  function push(kind: "user" | "assistant" | "error", text: string) {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind, text }]);
  }

  function pushTool(name: string, summary: string, ok: boolean) {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind: "tool", name, summary, ok }]);
  }

  function flushText() {
    const text = liveRef.current.trim();
    liveRef.current = "";
    setLiveText("");
    if (text) push("assistant", text);
  }

  const asker: Asker = (key, decision) =>
    new Promise<UserDecision>((resolve) => {
      setSelected(0);
      setAsk({ key, decision, resolve });
    });

  function answer(decision: UserDecision) {
    ask?.resolve(decision);
    setAsk(null);
  }

  async function submit(text: string) {
    // submits the user query to runLoop
    const request = resolveCommand(text);
    const controller = new AbortController();
    abortRef.current = controller;
    push("user", text);
    setInput("");
    setHistory((previous) => [...previous.slice(-49), text]);
    setHistoryIndex(-1);
    liveRef.current = "";
    setLiveText("");
    setLiveReasoning("");
    setRunning(true);

    const localTools: Record<string, string> = {
      "/index": "rebuild_index",
      "/repo": "repo_overview",
      "/symbols": "retrieve_code_context",
      "/impact": "analyze_change_impact",
      "/contracts": "list_change_contracts",
    };
    const localCommand = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (localCommand === "/health") {
      const checks = diagnostics(
        activeWorkspaceRef.current?.authorizedRoot ?? process.cwd(),
      );
      const remainder = text
        .trim()
        .slice(localCommand.length)
        .trim()
        .toLowerCase();
      const selected = checks;
      const failures = selected.filter(
        (check) => check.status === "FAIL",
      ).length;
      const payload =
        remainder === "status"
          ? {
              scope: "local-runtime",
              status: failures > 0 ? "DEGRADED" : "HEALTHY",
              failures,
              total: selected.length,
            }
          : remainder === "components" || remainder === "report" || !remainder
            ? {
                scope: "local-runtime",
                status: failures > 0 ? "DEGRADED" : "HEALTHY",
                checks: selected,
              }
            : {
                error: `unknown /health mode: ${remainder}`,
                supported: ["status", "components", "report"],
              };
      push(
        failures > 0 ? "error" : "assistant",
        JSON.stringify(payload, null, 2),
      );
      setRunning(false);
      abortRef.current = null;
      return;
    }
    if (localCommand === "/incidents") {
      try {
        const incidents = await listIncidents();
        push(
          "assistant",
          JSON.stringify(
            {
              scope: "local-crash-reports",
              count: incidents.length,
              incidents,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (localCommand === "/workspaces" || localCommand === "/workspace") {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const [operation = "list", value] = remainder.split(/\s+/, 2);
        if (localCommand === "/workspaces" || operation === "list") {
          const workspaces = await workspaceManagerRef.current.list();
          push("assistant", JSON.stringify(workspaces, null, 2));
        } else if (operation === "create") {
          const workspace = await workspaceManagerRef.current.create({
            taskId: value || `task-${Date.now()}`,
            sessionId: sessionRef.current.id,
          });
          push(
            "assistant",
            `Workspace created: ${workspace.workspaceId}\n${workspace.worktreePath}`,
          );
        } else if (operation === "use") {
          if (!value) throw new Error("usage: /workspace use <id>");
          const selectedWorkspace =
            await workspaceManagerRef.current.require(value);
          const controller = new AbortController();
          activeWorkspaceRef.current =
            await workspaceManagerRef.current.executionContext(
              value,
              controller.signal,
            );
          permissions.projectRoot = activeWorkspaceRef.current.authorizedRoot;
          push(
            "assistant",
            `Active workspace: ${selectedWorkspace.workspaceId}\n${selectedWorkspace.worktreePath}`,
          );
        } else if (operation === "reconcile") {
          push(
            "assistant",
            JSON.stringify(
              await workspaceManagerRef.current.reconcile(),
              null,
              2,
            ),
          );
        } else if (["show", "status", "diff"].includes(operation)) {
          if (!value) throw new Error(`usage: /workspace ${operation} <id>`);
          if (operation === "show" || operation === "status")
            push(
              "assistant",
              JSON.stringify(
                await workspaceManagerRef.current.require(value),
                null,
                2,
              ),
            );
          else
            push(
              "assistant",
              JSON.stringify(
                await workspaceManagerRef.current.diff(value),
                null,
                2,
              ),
            );
        } else {
          throw new Error(
            "supported workspace commands: list, create, show, use, status, diff, reconcile",
          );
        }
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (localCommand === "/mcp") {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const [operation = "list", value] = remainder.split(/\s+/, 2);
        if (operation === "list") {
          push("assistant", JSON.stringify(mcpRef.current.list(), null, 2));
        } else if (operation === "connect") {
          const configured = await mcpRef.current.loadConfigured(value);
          if (!configured.length) throw new Error("no MCP servers configured");
          const connected: string[] = [];
          for (const server of configured) {
            const decision = await asker(
              {
                capability: "external",
                target: `mcp-server:${server.id}`,
                explanation: `Connect to external MCP server ${server.id}`,
                risk: "normal",
              },
              "ask",
            );
            if (decision === "deny") continue;
            await mcpRef.current.connect(server, controller.signal);
            connected.push(server.id);
            sessionRef.current.mcpServers = mcpRef.current.configs();
            sessionRef.current.updatedAt = Date.now().toString();
            await saveSession(sessionRef.current);
          }
          push("assistant", JSON.stringify({ connected }, null, 2));
        } else if (operation === "tools") {
          if (!value) throw new Error("usage: /mcp tools <server-id>");
          push(
            "assistant",
            JSON.stringify(mcpRef.current.get(value).tools(), null, 2),
          );
        } else if (operation === "disconnect") {
          if (!value) throw new Error("usage: /mcp disconnect <server-id>");
          await mcpRef.current.disconnect(value);
          push("assistant", `Disconnected MCP server: ${value}`);
        } else {
          throw new Error(
            "supported commands: /mcp list|connect [config]|tools <server-id>|disconnect <server-id>",
          );
        }
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (
      localCommand === "/agents" ||
      localCommand === "/agent" ||
      localCommand === "/team" ||
      localCommand === "/parallel"
    ) {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const [operation = "list", value] = remainder.split(/\s+/, 2);
        if (
          localCommand === "/agents" ||
          (localCommand === "/agent" && operation === "list")
        ) {
          push(
            "assistant",
            JSON.stringify(agentRegistryRef.current.list(), null, 2),
          );
        } else if (localCommand === "/agent" && operation === "info") {
          if (!value) throw new Error("usage: /agent info <id>");
          push(
            "assistant",
            JSON.stringify(agentRegistryRef.current.get(value), null, 2),
          );
        } else if (localCommand === "/agent" && operation === "status") {
          if (!value) throw new Error("usage: /agent status <id>");
          push(
            "assistant",
            JSON.stringify(
              coordinatorRef.current
                .executionSnapshot()
                .filter((item) => item.agentId === value),
              null,
              2,
            ),
          );
        } else if (localCommand === "/team") {
          const valueToShow =
            operation === "status"
              ? coordinatorRef.current.executionSnapshot()
              : coordinatorRef.current.graphSnapshot();
          push("assistant", JSON.stringify(valueToShow, null, 2));
        } else if (localCommand === "/parallel" && operation === "status") {
          push(
            "assistant",
            JSON.stringify(coordinatorRef.current.schedulerSnapshot(), null, 2),
          );
        } else if (localCommand === "/parallel" && operation === "limit") {
          const limit = Number(value);
          if (!Number.isInteger(limit) || limit < 1)
            throw new Error("usage: /parallel limit <positive integer>");
          coordinatorRef.current.setParallelLimit(limit);
          push("assistant", `Parallel agent limit set to ${limit}`);
        } else {
          throw new Error(
            "supported commands: /agents, /agent list|info|status, /team status|tasks|graph, /parallel status|limit",
          );
        }
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (
      localCommand === "/eval" ||
      localCommand === "/benchmark" ||
      localCommand === "/experiments" ||
      localCommand === "/improve"
    ) {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const [operation = "list", value, secondValue] = remainder.split(
          /\s+/,
          3,
        );
        const engine = evaluationRef.current;
        await engine.hydrate();
        if (localCommand === "/benchmark") {
          push("assistant", JSON.stringify(engine.benchmarks.list(), null, 2));
        } else if (localCommand === "/experiments") {
          push("assistant", JSON.stringify(await listExperiments(), null, 2));
        } else if (localCommand === "/improve") {
          const results = engine.listResults();
          push(
            "assistant",
            JSON.stringify(proposeImprovements(results), null, 2),
          );
        } else if (operation === "list") {
          push("assistant", JSON.stringify(engine.listResults(), null, 2));
        } else if (operation === "security") {
          push(
            "assistant",
            JSON.stringify(
              engine.listResults().map((result) => ({
                evaluationId: result.evaluationId,
                taskId: result.taskId,
                status: result.status,
                safety: result.metrics.safety,
                integrity: result.integrity,
              })),
              null,
              2,
            ),
          );
        } else if (operation === "compare") {
          if (!value || !secondValue)
            throw new Error("usage: /eval compare <before-id> <after-id>");
          push(
            "assistant",
            JSON.stringify(
              compareResults(
                [engine.result(value)],
                [engine.result(secondValue)],
              ),
              null,
              2,
            ),
          );
        } else {
          if (!value)
            throw new Error(`usage: /eval ${operation} <evaluation-id>`);
          const result = engine.result(value);
          if (operation === "trace")
            push("assistant", JSON.stringify(result.trace, null, 2));
          else if (operation === "failures")
            push(
              "assistant",
              JSON.stringify(
                result.grades.filter((grade) => grade.outcome !== "PASS"),
                null,
                2,
              ),
            );
          else push("assistant", JSON.stringify(result, null, 2));
        }
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (localCommand === "/skill") {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const [operation, name] = remainder.split(/\s+/, 2);
        if (!name && operation !== "off")
          throw new Error("usage: /skill <name> or /skill off <name>");
        if (operation === "off") {
          if (!name) throw new Error("usage: /skill off <name>");
          skillLifecycleRef.current.deactivate(name);
          push("assistant", `Skill deactivated: ${name}`);
        } else {
          const loaded = await skillLifecycleRef.current.activate(
            operation ?? "",
          );
          push(
            "assistant",
            `Skill activated: ${loaded.metadata.name} v${loaded.metadata.version}`,
          );
        }
        sessionRef.current.skills = skillLifecycleRef.current.state();
        if (sessionRef.current.state)
          sessionRef.current.state = {
            ...sessionRef.current.state,
            skills: skillLifecycleRef.current.state(),
          };
        sessionRef.current.updatedAt = Date.now().toString();
        await saveSession(sessionRef.current);
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }
    if (localCommand && localTools[localCommand]) {
      try {
        const remainder = text.trim().slice(localCommand.length).trim();
        const args =
          localCommand === "/symbols"
            ? JSON.stringify({ query: remainder || "repository" })
            : localCommand === "/impact"
              ? remainder
                ? JSON.stringify({ paths: remainder.split(/\s+/) })
                : JSON.stringify({ paths: [] })
              : "{}";
        const result = await runTool(localTools[localCommand], args, {
          asker,
          signal: controller.signal,
          maxOutputChars: TOOLS.maxOutputChars,
          permissions,
          ...(activeWorkspaceRef.current
            ? { workspace: activeWorkspaceRef.current }
            : {}),
        });
        push("assistant", result);
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
      return;
    }

    try {
      const toolContext = {
        asker,
        signal: controller.signal,
        maxOutputChars: TOOLS.maxOutputChars,
        permissions,
        ...(activeWorkspaceRef.current
          ? { workspace: activeWorkspaceRef.current }
          : {}),
      };
      const workflow = config.workflow
        ? createWorkflowController(
            activeWorkspaceRef.current
              ? {
                  ...config.workflow,
                  root: activeWorkspaceRef.current.authorizedRoot,
                }
              : config.workflow,
            toolContext,
            {
              onPhase: (phase) => setLiveReasoning(`workflow: ${phase}`),
            },
          )
        : undefined;
      const result = await runLoop({
        messages: [{ type: "user", content: request }],
        state: sessionRef.current.state,
        complete: completeStream,
        systemPrompt,
        config,
        ctx: toolContext,
        skills: skillLifecycleRef.current,
        events: {
          onText: (c) => {
            liveRef.current += c;
            setLiveText(liveRef.current);
          },
          onReasoning: (c) => setLiveReasoning((p) => p + c),
          onToolStart: (call) => {
            flushText();
            setLiveReasoning("");
            setLiveTool({
              name: call.name,
              summary: summarizeArgs(call.arguments),
            });
          },
          onToolResult: (call, result) => {
            setLiveTool(null);
            pushTool(
              call.name,
              summarizeArgs(call.arguments),
              !isToolError(result),
            );
          },
        },
        checkpoint: async (state) => {
          sessionRef.current.state = state;
          sessionRef.current.status = "active";
          sessionRef.current.updatedAt = Date.now().toString();
          await saveSession(sessionRef.current);
        },
        ...(workflow ? { workflow } : {}),
      });

      sessionRef.current.state = result.state;
      setContextDiagnostics(result.context);
      sessionRef.current.updatedAt = Date.now().toString();
      sessionRef.current.status =
        result.stopReason === "stop"
          ? "completed"
          : result.stopReason === "interrupted"
            ? "interrupted"
            : "failed";
      sessionRef.current.stopReason = result.stopReason;
      if (sessionRef.current.title === "") {
        sessionRef.current.title = text.slice(0, UI.titleMaxChars);
      }

      try {
        await saveSession(sessionRef.current);
      } catch (error) {
        push("error", "cant save session: " + error);
      }

      flushText(); // final answer

      if (result.stopReason !== "stop") {
        push("error", `stopped: ${result.stopReason}`);
      }
      if (result.verification && !result.verification.passed) {
        push(
          "error",
          `verification incomplete: ${result.verification.checks.map((check) => `${check.name}:${check.status}`).join(", ")}`,
        );
      }
    } catch (e) {
      push("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLiveText("");
      setLiveReasoning("");
      setLiveTool(null);
      setRunning(false);
      abortRef.current = null;
    }
  }

  useInput((char, key) => {
    if (ask) {
      const options = optionsFor(ask.key, ask.decision);
      if (key.ctrl && char === "c") {
        answer("deny"); // free the awaiting promise first
        abortRef.current?.abort();
        return;
      }
      if (key.upArrow) {
        setSelected((s) => (s - 1 + options.length) % options.length);
      } else if (key.downArrow) {
        setSelected((s) => (s + 1) % options.length);
      } else if (key.return) {
        const chosen = options[selected];
        if (chosen) answer(chosen.value);
      } else if (key.escape) {
        answer("deny");
      }
      return;
    }

    if (key.upArrow && !running && history.length) {
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setInput(history[history.length - 1 - next] ?? "");
      return;
    }
    if (key.downArrow && !running && historyIndex >= 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setInput(next < 0 ? "" : (history[history.length - 1 - next] ?? ""));
      return;
    }

    if (key.ctrl && char === "c") {
      if (running) abortRef.current?.abort();
      else exit();
      return;
    }
    if (running) return;
    if (key.ctrl && char === "u") {
      setInput("");
      return;
    }
    if (key.shift && key.return) {
      setInput((previous) => `${previous}\n`);
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (text) void submit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (char) setInput((prev) => prev + char);
  });

  const lastPromptTokens = sessionRef.current.state?.lastPromptTokens ?? 0;
  const contextPercent = Math.round(
    (lastPromptTokens / config.contextWindow) * 100,
  );
  const status = ask ? "waiting for permission" : running ? "running" : "idle";
  const suggestions = input.startsWith("/")
    ? Object.keys(COMMANDS)
        .filter((command) => command.startsWith(input.split(/\s/, 1)[0] ?? ""))
        .slice(0, 6)
    : [];

  return (
    <>
      <Header
        model={config.loopModel}
        session={sessionRef.current.title}
        workspace={process.cwd()}
        status={status}
      />
      <Static key={resizeKey} items={items}>
        {(item) => (
          // Static lays items out without a width limit, so give each one the terminal width
          <Box key={item.id} width={stdout.columns || 80}>
            <ItemView item={item} />
          </Box>
        )}
      </Static>

      {running && (
        <Box flexDirection="column">
          {liveReasoning ? (
            <Text dimColor>{liveReasoning.slice(-UI.reasoningTailChars)}</Text>
          ) : null}
          {liveText ? <Text>{liveText}</Text> : null}
          {liveTool ? (
            <Text dimColor>
              {"  "}running {liveTool.name} {liveTool.summary}...
            </Text>
          ) : null}
          {!liveText && !liveReasoning && !liveTool ? (
            <Text dimColor>thinking... (ctrl-c to stop)</Text>
          ) : null}
        </Box>
      )}

      {ask && <PermissionPrompt request={ask} selected={selected} />}

      <Box>
        <Box flexShrink={0} marginRight={1}>
          <Text color={running ? "gray" : "cyan"}>{">"}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text>
            {input}
            <Text inverse>{"\u00a0"}</Text>
          </Text>
        </Box>
      </Box>
      {suggestions.length > 0 ? (
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>commands</Text>
          {suggestions.map((command) => (
            <Text key={command} color="gray">
              {command} — {COMMANDS[command]}
            </Text>
          ))}
        </Box>
      ) : null}

      <StatusBar
        model={config.loopModel}
        contextTokens={lastPromptTokens}
        contextWindow={config.contextWindow}
        contextPercent={contextPercent}
        warnAt={Math.round(config.pruneRatio * 100)}
        dangerAt={Math.round(config.compactionRatio * 100)}
        title={sessionRef.current.title}
        status={status}
        retainedMessages={contextDiagnostics?.retainedMessages}
        prunedMessages={contextDiagnostics?.prunedMessages}
      />
    </>
  );
}
