import { expect, test } from "bun:test";
import { z } from "zod";
import {
  CHIKU_EXTENSION_API_VERSION,
  defineExtensionTool,
} from "../../src/plugin";
import type { ToolContext } from "../../src/tool/types";

test("extension SDK exposes a versioned typed adapter to the existing tool contract", async () => {
  expect(CHIKU_EXTENSION_API_VERSION).toBe("1.0.0");
  const progress: string[] = [];
  const tool = defineExtensionTool({
    name: "example.depcheck",
    description: "Inspect declared dependencies",
    parameters: z.object({ packageName: z.string().min(1) }),
    capability: "workspace.read",
    declaredCapabilities: ["workspace.read"],
    getPermissionKey: () => ({
      capability: "read",
      target: "package.json",
      explanation: "inspect dependency metadata",
      risk: "normal",
    }),
    execute: async ({ packageName }, context) => {
      expect(context.storageNamespace).toBe("plugin:example.depcheck");
      expect(context.signal.aborted).toBe(false);
      context.reportProgress?.({ stage: "complete", completed: 1, total: 1 });
      return { packageName };
    },
  });
  expect(tool.name).toBe("example.depcheck");
  const result = await tool.execute(
    { packageName: "zod" },
    new AbortController().signal,
    {
      reportProgress: (value: { stage: string }) => progress.push(value.stage),
    } as unknown as ToolContext,
  );
  expect(result).toEqual({ packageName: "zod" });
  expect(progress).toEqual(["complete"]);
});

test("extension SDK rejects collisions, undeclared capabilities, and invalid names", () => {
  const base = {
    name: "Example.Tool" as `${string}.${string}`,
    description: "Invalid",
    parameters: z.object({}),
    capability: "workspace.read" as const,
    declaredCapabilities: ["workspace.read"] as const,
    getPermissionKey: () => undefined,
    execute: async () => null,
  };
  expect(() => defineExtensionTool(base)).toThrow("lowercase namespace.name");
  expect(() =>
    defineExtensionTool({
      ...base,
      name: "example.tool" as const,
      capability: "shell.execute",
    }),
  ).toThrow("requires declared capability");
});
