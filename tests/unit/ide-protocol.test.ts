import { expect, test } from "bun:test";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDE_PROTOCOL_VERSION,
  parseIDERequest,
  registerIDEWorkspace,
  validateIDEHandshake,
  assertIDEPathWithinWorkspace,
} from "../../src/ide";

test("IDE protocol validates authenticated versioned handshakes and requests", () => {
  const requestId = crypto.randomUUID();
  expect(
    validateIDEHandshake(
      {
        protocol: IDE_PROTOCOL_VERSION,
        requestId,
        clientId: "client-1",
        clientKind: "vscode",
        clientVersion: "1.0.0",
        authToken: "0123456789abcdef",
        capabilities: ["selection"],
      },
      "0123456789abcdef",
    ).clientKind,
  ).toBe("vscode");
  expect(() =>
    validateIDEHandshake(
      {
        protocol: 2,
        requestId,
        clientId: "client-1",
        clientKind: "vscode",
        clientVersion: "1.0.0",
        authToken: "0123456789abcdef",
        capabilities: [],
      },
      "0123456789abcdef",
    ),
  ).toThrow();
  expect(() => parseIDERequest({ protocol: 1, type: "unknown" })).toThrow();
  expect(() =>
    parseIDERequest({
      protocol: 1,
      requestId,
      type: "cancel_task",
      taskId: "task-1",
      unexpected: true,
    }),
  ).toThrow();
});

test("IDE workspace identity canonicalizes roots and blocks traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "chiku-ide-"));
  await writeFile(join(root, "main.ts"), "export {}\n");
  const identity = await registerIDEWorkspace({ workspaceRoot: root });
  expect(await assertIDEPathWithinWorkspace(identity, "main.ts")).toBe(
    join(identity.canonicalRoot, "main.ts"),
  );
  expect(await assertIDEPathWithinWorkspace(identity, "new-file.ts")).toBe(
    join(identity.canonicalRoot, "new-file.ts"),
  );
  await expect(
    assertIDEPathWithinWorkspace(identity, "../outside.ts"),
  ).rejects.toThrow("outside the registered workspace");

  const outside = await mkdtemp(join(tmpdir(), "chiku-ide-outside-"));
  await writeFile(join(outside, "secret.txt"), "not editor context\n");
  await symlink(join(outside, "secret.txt"), join(root, "linked-secret.txt"));
  await expect(
    assertIDEPathWithinWorkspace(identity, "linked-secret.txt"),
  ).rejects.toThrow("outside the registered workspace");
});
