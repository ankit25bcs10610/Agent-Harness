import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { platform } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  IsolationBackend,
  ProcessRequest,
  PreparedProcess,
} from "./types";

function profileLiteral(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * macOS Seatbelt backend. It is deliberately registered only when the host
 * provides sandbox-exec. The profile denies network and all filesystem access
 * outside the canonical workspace (plus the minimal runtime paths needed to
 * launch a process). This is containment, not a privilege drop.
 */
export class MacosSandboxBackend implements IsolationBackend {
  readonly name = "macos-seatbelt";

  async prepare(request: ProcessRequest): Promise<PreparedProcess> {
    if (platform() !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
      throw new Error("macOS sandbox-exec is unavailable");
    }
    const root = await realpath(
      request.isolation?.workspace ?? request.workspaceRoot ?? process.cwd(),
    );
    const requestedCwd = request.cwd
      ? await realpath(
          isAbsolute(request.cwd) ? request.cwd : resolve(root, request.cwd),
        )
      : root;
    if (!inside(root, requestedCwd))
      throw new Error("sandbox cwd must be inside workspace");

    const direct =
      request.shell === true
        ? (["/bin/sh", ["-lc", request.command]] as const)
        : undefined;
    const command =
      direct ??
      (() => {
        const [file, ...args] = request.command.trim().split(/\s+/);
        if (!file) throw new Error("command is empty");
        return [file, args] as const;
      })();
    const profile = [
      "(version 1)",
      "(deny default)",
      "(allow process*)",
      "(allow process-exec)",
      `(allow file-read* (subpath ${profileLiteral(root)}))`,
      `(allow file-write* (subpath ${profileLiteral(root)}))`,
      '(allow file-read* (literal "/dev/null"))',
      '(allow file-read* (literal "/dev/urandom"))',
      '(allow file-read* (literal "/dev/random"))',
      "(deny network*)",
    ].join(" ");
    return {
      file: "/usr/bin/sandbox-exec",
      args: ["-p", profile, "--", command[0], ...command[1]],
      cwd: requestedCwd,
      shell: false,
      isolated: true,
    };
  }
}
