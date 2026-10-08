import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  loadLatestSession,
  saveSession,
} from "../../src/session/store";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("session persistence", () => {
  test("saves and resumes the newest compatible session", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    const first = createSession("first");
    first.id = "2026-01-01T00:00:00.000Z";
    const second = createSession("second");
    second.id = "2026-01-02T00:00:00.000Z";
    await saveSession(first, directory);
    await saveSession(second, directory);
    expect((await loadLatestSession(directory))?.title).toBe("second");
  });

  test("ignores invalid JSON and missing directories", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    await writeFile(join(directory, "2026-01-03.json"), "{bad");
    expect(await loadLatestSession(directory)).toBeUndefined();
    expect(await loadLatestSession(join(directory, "missing"))).toBeUndefined();
  });

  test("reports filesystem errors while saving", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    const filePath = join(directory, "not-a-directory");
    await writeFile(filePath, "occupied");
    await expect(
      saveSession(createSession("broken"), filePath),
    ).rejects.toThrow("EEXIST");
  });
});
