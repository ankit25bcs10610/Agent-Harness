import { z } from "zod";
import type { Tool } from "../types";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalizePath } from "../../permission/match";

export const fileWrite: Tool<
  { path: z.ZodString; content: z.ZodString },
  { written: boolean }
> = {
  name: "write_file",
  description:
    "Create a new file with the given content. Creates missing parent folders. Fails if the file already exists, use str_replace to change an existing file.",
  parameters: z.object({
    path: z.string().describe("path of the new file, relative or absolute"),
    content: z.string().describe("full content of the new file"),
  }),
  getPermissionKey: ({ path }) => ({
    capability: "create",
    target: path,
    explanation: `Create file: ${path}`,
    risk: "normal",
  }),
  execute: async ({ path, content }, _signal, context) => {
    try {
      const canonical = await canonicalizePath(
        path,
        context?.workspace?.authorizedRoot ?? process.cwd(),
      );
      if (canonical.exists) throw new Error(`File already exists: "${path}"`);
      await mkdir(dirname(canonical.target), { recursive: true });
      await writeFile(canonical.target, content, {
        encoding: "utf-8",
        flag: "wx",
      });
      return {
        written: true,
      };
    } catch (error) {
      if (error instanceof Error) {
        if ("code" in error && error.code === "EEXIST") {
          throw new Error(`File already exists: "${path}"`);
        }
        throw new Error(`Error writing file "${path}": ${error.message}`);
      }
      throw new Error(`Error writing file "${path}"`);
    }
  },
};
