import { describe, expect, test } from "bun:test";
import { runTool } from "../../src/tool/registry";

const context = (root = process.cwd()) => ({
  permissions: { projectRoot: root, allowList: [/^echo /] },
  asker: async () => "allow-once" as const,
  signal: new AbortController().signal,
  maxOutputChars: 20,
});

describe("tool registry", () => {
  test("rejects unknown tools and malformed JSON", async () => {
    expect(await runTool("missing", "{}", context())).toContain("unknown tool");
    expect(await runTool("bash", "{", context())).toContain("malformed JSON");
  });

  test("validates arguments before execution", async () => {
    expect(
      await runTool("read_file", '{"limit":"wrong"}', context()),
    ).toContain("invalid arguments");
  });

  test("executes an allowed command and truncates output", async () => {
    const result = await runTool(
      "bash",
      JSON.stringify({ command: "echo 12345678901234567890" }),
      context(),
    );
    const parsed = JSON.parse(result) as { stdout: string };
    expect(parsed.stdout).toStartWith("12345678901234567890");
    expect(parsed.stdout).toContain("[truncated:");
    expect(parsed.stdout).toContain("123456");
  });

  test("returns execution failures as tool errors", async () => {
    const result = await runTool(
      "bash",
      JSON.stringify({ command: "command-that-does-not-exist" }),
      context(process.cwd()),
    );
    expect(result).toContain('Error: tool "bash"');
  });
});
