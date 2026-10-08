import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config";
import { AgentSessionSchema, type AgentSessionState } from "./types";

function pathFor(directory: string, sessionId: string) {
  return join(directory, `multi-agent-${sessionId}.json`);
}

export async function saveAgentSession(
  value: AgentSessionState,
  directory = PATHS.sessionsDir,
) {
  const valid = AgentSessionSchema.parse(value);
  await mkdir(directory, { recursive: true });
  const destination = pathFor(directory, valid.sessionId);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
    flag: "w",
  });
  await rename(temporary, destination);
  return destination;
}

export async function loadAgentSession(
  sessionId: string,
  directory = PATHS.sessionsDir,
) {
  const raw = await readFile(pathFor(directory, sessionId), "utf8");
  return AgentSessionSchema.parse(JSON.parse(raw)) as AgentSessionState;
}
