import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillLifecycleState } from "../../src/skill/lifecycle";
import {
  createSession,
  loadLatestSession,
  loadSession,
  listSessions,
  saveSession,
  validateSession,
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

  test("rejects incompatible schemas and recovers a valid interrupted write", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    const session = createSession("recoverable");
    await writeFile(
      join(directory, `${session.id}.json.tmp`),
      JSON.stringify(session),
    );
    expect((await loadSession(session.id, directory))?.name).toBe("default");
    await writeFile(
      join(directory, "unsupported.json"),
      JSON.stringify({ ...session, version: 99 }),
    );
    expect(
      (await listSessions(directory)).some((item) => item.id === session.id),
    ).toBe(true);
    expect(() => validateSession({ ...session, version: 99 })).toThrow(
      "unsupported session version",
    );
  });

  test("repairs unfinished tool calls without replaying them", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    const session = createSession("recovery");
    session.state = {
      messages: [
        { type: "user", content: "run" },
        {
          type: "assistant",
          content: null,
          toolCalls: [{ toolCallId: "call-1", name: "bash", arguments: "{}" }],
        },
      ],
      view: [],
      summary: { type: "assistant", content: "" },
      summarizedUpTo: -1,
      lastPromptTokens: 0,
    };
    await saveSession(session, directory);
    const recovered = await loadSession(session.id, directory);
    expect(recovered?.state?.messages.at(-1)).toEqual({
      type: "tool",
      toolCallId: "call-1",
      content: "Error: tool action was not replayed during session recovery",
    });
  });

  test("lists named sessions without deleting them", async () => {
    directory = await mkdtemp(join(tmpdir(), "chiku-session-"));
    const first = createSession("first", "alpha");
    const second = createSession("second", "beta");
    await saveSession(first, directory);
    await saveSession(second, directory);
    expect(
      (await listSessions(directory)).map((item) => item.name).sort(),
    ).toEqual(["alpha", "beta"]);
  });

  test("preserves skill activation lifecycle state", () => {
    const session = createSession("skills");
    const skills: SkillLifecycleState = {
      active: ["debugging"],
      events: [{ type: "activated", skill: "debugging", at: 123 }],
    };
    const recovered = validateSession({ ...session, skills });
    expect(recovered.skills).toEqual(skills);
  });
});
