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
    liveRef.current = "";
    setLiveText("");
    setLiveReasoning("");
    setRunning(true);

    const localTools: Record<string, string> = {
      "/index": "rebuild_index",
      "/repo": "repo_overview",
      "/symbols": "retrieve_code_context",
      "/impact": "analyze_change_impact",
    };
    const localCommand = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
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
      };
      const workflow = config.workflow
        ? createWorkflowController(config.workflow, toolContext, {
            onPhase: (phase) => setLiveReasoning(`workflow: ${phase}`),
          })
        : undefined;
      const result = await runLoop({
        messages: [{ type: "user", content: request }],
        state: sessionRef.current.state,
        complete: completeStream,
        systemPrompt,
        config,
        ctx: toolContext,
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

    if (key.ctrl && char === "c") {
      if (running) abortRef.current?.abort();
      else exit();
      return;
    }
    if (running) return;
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

  return (
    <>
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
