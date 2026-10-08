import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../config";

export type WorkspaceLock = {
  key: string;
  owner: string;
  path: string;
  acquiredAt: string;
};

export async function acquireWorkspaceLock(
  key: string,
  directory = PATHS.workspaceLocksDir,
): Promise<WorkspaceLock> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.lock`);
  const lock = {
    key,
    owner: randomUUID(),
    path,
    acquiredAt: new Date().toISOString(),
  };
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(JSON.stringify(lock));
    await handle.close();
    return lock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`workspace lock is already held: ${key}`);
    throw error;
  }
}

export async function releaseWorkspaceLock(lock: WorkspaceLock) {
  const current = JSON.parse(
    await readFile(lock.path, "utf8"),
  ) as WorkspaceLock;
  if (current.owner !== lock.owner)
    throw new Error("workspace lock ownership changed");
  await rm(lock.path);
}

export async function inspectWorkspaceLock(
  key: string,
  directory = PATHS.workspaceLocksDir,
) {
  const path = join(directory, `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.lock`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as WorkspaceLock;
  } catch {
    return undefined;
  }
}
