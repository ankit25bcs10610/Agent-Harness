import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type IDEWorkspaceIdentity = {
  workspaceId: string;
  canonicalRoot: string;
  sessionId?: string;
};

function within(root: string, target: string) {
  const distance = relative(root, target);
  return (
    distance === "" || (!distance.startsWith("..") && !isAbsolute(distance))
  );
}

export async function registerIDEWorkspace(input: {
  workspaceRoot: string;
  authorizedRoot?: string;
  sessionId?: string;
}): Promise<IDEWorkspaceIdentity> {
  const canonicalRoot = await realpath(resolve(input.workspaceRoot));
  if (input.authorizedRoot) {
    const canonicalAuthorizedRoot = await realpath(
      resolve(input.authorizedRoot),
    );
    if (!within(canonicalAuthorizedRoot, canonicalRoot))
      throw new Error("IDE workspace is outside the authorized root");
  }
  return {
    workspaceId: randomUUID(),
    canonicalRoot,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

export async function assertIDEPathWithinWorkspace(
  identity: IDEWorkspaceIdentity,
  path: string,
) {
  const candidate = resolve(identity.canonicalRoot, path);
  let canonicalPath: string;
  try {
    // Existing symlinks must be resolved before authorization so they cannot
    // redirect an editor operation outside the registered workspace.
    canonicalPath = await realpath(candidate);
  } catch (error) {
    // A new editor buffer/file has no realpath yet. Permit it only when its
    // lexical destination is already inside the canonical workspace. Other
    // filesystem errors are preserved instead of being treated as safe.
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      (error as NodeJS.ErrnoException).code !== "ENOTDIR"
    )
      throw error;
    canonicalPath = candidate;
  }
  if (!within(identity.canonicalRoot, canonicalPath))
    throw new Error("IDE path is outside the registered workspace");
  return canonicalPath;
}
