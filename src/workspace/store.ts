import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config";
import { WorkspaceSchema, type Workspace } from "./types";

function fileFor(directory: string, id: string) {
  return join(directory, `${id}.json`);
}

export async function saveWorkspace(
  workspace: Workspace,
  directory = PATHS.workspacesDir,
) {
  const valid = WorkspaceSchema.parse(workspace);
  await mkdir(directory, { recursive: true });
  const destination = fileFor(directory, valid.workspaceId);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(valid, null, 2) + "\n", {
    flag: "wx",
  });
  await rename(temporary, destination);
  return destination;
}

export async function loadWorkspace(
  id: string,
  directory = PATHS.workspacesDir,
) {
  try {
    return WorkspaceSchema.parse(
      JSON.parse(await readFile(fileFor(directory, id), "utf8")),
    );
  } catch {
    return undefined;
  }
}

export async function listWorkspaces(directory = PATHS.workspacesDir) {
  const files = (await readdir(directory).catch(() => [])).filter((file) =>
    file.endsWith(".json"),
  );
  const values = await Promise.all(
    files.map(async (file) => {
      try {
        return WorkspaceSchema.parse(
          JSON.parse(await readFile(join(directory, file), "utf8")),
        );
      } catch {
        return undefined;
      }
    }),
  );
  return values
    .filter((value): value is Workspace => Boolean(value))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export async function removeWorkspaceRecord(
  id: string,
  directory = PATHS.workspacesDir,
) {
  await unlink(fileFor(directory, id)).catch(() => undefined);
}
