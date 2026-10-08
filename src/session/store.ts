import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config";
import type { AgentMessage, ToolMessage } from "../provider";
import type { LoopState } from "../loop/types";
import type { Session, SessionRetention, SessionSummary } from "./types";

const SESSION_DIR = PATHS.sessionsDir;
export const SESSION_VERSION = 1;

export function createSession(title = "", name = "default"): Session {
  const now = new Date().toISOString();
  return {
    version: SESSION_VERSION,
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    title,
    state: undefined,
    status: "active",
  };
}

export function createNamedSession(name: string, title = ""): Session {
  return createSession(title, name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function validMessage(value: unknown): value is AgentMessage {
  if (
    !isRecord(value) ||
    !["user", "system", "assistant", "tool"].includes(String(value.type))
  )
    return false;
  if (typeof value.content !== "string" && value.content !== null) return false;
  if (value.type === "tool" && typeof value.toolCallId !== "string")
    return false;
  if (value.type === "assistant" && value.toolCalls !== undefined) {
    if (!Array.isArray(value.toolCalls)) return false;
    if (
      value.toolCalls.some(
        (call) =>
          !isRecord(call) ||
          typeof call.toolCallId !== "string" ||
          typeof call.name !== "string" ||
          typeof call.arguments !== "string",
      )
    )
      return false;
  }
  return true;
}

function validMessageSequence(messages: AgentMessage[]): boolean {
  const knownCalls = new Set<string>();
  const completedCalls = new Set<string>();
  for (const message of messages) {
    if (message.type === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (knownCalls.has(call.toolCallId)) return false;
        knownCalls.add(call.toolCallId);
      }
    }
    if (message.type === "tool") {
      if (
        !knownCalls.has(message.toolCallId) ||
        completedCalls.has(message.toolCallId)
      )
        return false;
      completedCalls.add(message.toolCallId);
    }
  }
  return true;
}

function recoverUnfinishedTools(state: LoopState): LoopState {
  const messages = [...state.messages];
  const completed = new Set(
    messages
      .filter((message): message is ToolMessage => message.type === "tool")
      .map((message) => message.toolCallId),
  );
  const view = [...state.view];
  for (const message of [...messages]) {
    if (message.type !== "assistant" || !message.toolCalls) continue;
    for (const call of message.toolCalls) {
      if (completed.has(call.toolCallId)) continue;
      const recovery: ToolMessage = {
        type: "tool",
        toolCallId: call.toolCallId,
        content: "Error: tool action was not replayed during session recovery",
      };
      messages.push(recovery);
      view.push(recovery);
      completed.add(call.toolCallId);
    }
  }
  return { ...state, messages, view };
}

export function validateSession(value: unknown): Session {
  if (!isRecord(value)) throw new Error("session is not an object");
  const version = value.version === 0 ? SESSION_VERSION : value.version;
  if (version !== SESSION_VERSION)
    throw new Error(`unsupported session version: ${String(value.version)}`);
  if (
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    throw new Error("session metadata is invalid");
  if (typeof value.title !== "string")
    throw new Error("session title is invalid");
  const state = value.state;
  if (state !== undefined) {
    if (
      !isRecord(state) ||
      !Array.isArray(state.messages) ||
      !Array.isArray(state.view) ||
      !state.messages.every(validMessage) ||
      !state.view.every(validMessage) ||
      !validMessageSequence(state.messages)
    )
      throw new Error("session message state is invalid");
  }
  const session: Session = {
    version: SESSION_VERSION,
    id: value.id,
    name:
      typeof value.name === "string" ? value.name : value.title || "default",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    title: value.title,
    state: state as LoopState | undefined,
    status:
      value.status === "completed" ||
      value.status === "interrupted" ||
      value.status === "failed"
        ? value.status
        : "active",
    ...(typeof value.stopReason === "string"
      ? { stopReason: value.stopReason }
      : {}),
  };
  if (session.state) session.state = recoverUnfinishedTools(session.state);
  return session;
}

function fileFor(sessionDir: string, id: string) {
  return join(sessionDir, `${id}.json`);
}

async function readCandidate(path: string): Promise<Session | undefined> {
  try {
    return validateSession(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

async function recoverInterruptedWrites(sessionDir: string, files: string[]) {
  for (const file of files.filter((item) => item.endsWith(".json.tmp"))) {
    const canonical = file.slice(0, -4);
    if (files.includes(canonical)) continue;
    const candidate = await readCandidate(join(sessionDir, file));
    if (!candidate) continue;
    await rename(join(sessionDir, file), join(sessionDir, canonical));
  }
}

export async function saveSession(
  session: Session,
  sessionDir: string = SESSION_DIR,
): Promise<void> {
  const valid = validateSession(session);
  await mkdir(sessionDir, { recursive: true });
  const savePath = fileFor(sessionDir, valid.id);
  const tmpPath = `${savePath}.tmp`;
  try {
    await writeFile(
      tmpPath,
      JSON.stringify({ ...valid, updatedAt: new Date().toISOString() }),
      { flag: "w" },
    );
    await rename(tmpPath, savePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw new Error(
      `unable to save session: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function listSessions(
  sessionDir: string = SESSION_DIR,
): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(sessionDir);
  } catch {
    return [];
  }
  await recoverInterruptedWrites(sessionDir, files);
  const current = await readdir(sessionDir);
  const sessions = (
    await Promise.all(
      current
        .filter((file) => file.endsWith(".json"))
        .map((file) => readCandidate(join(sessionDir, file))),
    )
  ).filter((session): session is Session => Boolean(session));
  return sessions
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    )
    .map(({ id, name, title, createdAt, updatedAt, status, stopReason }) => ({
      id,
      name,
      title,
      createdAt,
      updatedAt,
      status,
      ...(stopReason ? { stopReason } : {}),
    }));
}

export async function loadSession(
  idOrName: string,
  sessionDir: string = SESSION_DIR,
): Promise<Session | undefined> {
  await listSessions(sessionDir);
  const direct = await readCandidate(fileFor(sessionDir, idOrName));
  if (direct) return direct;
  const summaries = await listSessions(sessionDir);
  const found = summaries.find((session) => session.name === idOrName);
  return found ? readCandidate(fileFor(sessionDir, found.id)) : undefined;
}

export async function loadLatestSession(
  sessionDir: string = SESSION_DIR,
): Promise<Session | undefined> {
  const summaries = await listSessions(sessionDir);
  return summaries[0] ? loadSession(summaries[0].id, sessionDir) : undefined;
}

export async function deleteSession(
  idOrName: string,
  sessionDir: string = SESSION_DIR,
): Promise<boolean> {
  const session = await loadSession(idOrName, sessionDir);
  if (!session) return false;
  await rm(fileFor(sessionDir, session.id), { force: false });
  return true;
}

export async function cleanupSessions(
  retention: SessionRetention = {},
  sessionDir: string = SESSION_DIR,
): Promise<SessionSummary[]> {
  const sessions = await listSessions(sessionDir);
  const keep = sessions.filter((session, index) => {
    const ageOk =
      retention.maxAgeMs === undefined ||
      Date.now() - Date.parse(session.updatedAt) <= retention.maxAgeMs;
    const countOk =
      retention.maxSessions === undefined || index < retention.maxSessions;
    return ageOk && countOk;
  });
  const retained = new Set(keep.map((session) => session.id));
  for (const session of sessions)
    if (!retained.has(session.id)) await deleteSession(session.id, sessionDir);
  return keep;
}
