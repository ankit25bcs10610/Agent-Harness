import z from "zod";
import { applyPatch, undoPatch } from "../../patch/engine";
import type { Tool } from "../types";

export const applyPatchTool: Tool<any, unknown> = {
  name: "apply_patch",
  description:
    "Validate, preview, and atomically apply multi-file unified patches. Use dryRun first for risky edits; stale context, conflicts, concurrent changes, symlink escapes, binary files, and malformed patches are rejected. Set mode=undo with a prior undoToken to restore verified agent-owned changes.",
  parameters: z
    .object({
      patch: z
        .string()
        .optional()
        .describe("unified diff or structured *** Update File patch"),
      dryRun: z.boolean().optional().default(false),
      includeDiff: z.boolean().optional().default(false),
      mode: z.enum(["apply", "undo"]).optional().default("apply"),
      undoToken: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.mode === "apply" && !value.patch)
        ctx.addIssue({
          code: "custom",
          message: "patch is required in apply mode",
        });
      if (value.mode === "undo" && !value.undoToken)
        ctx.addIssue({
          code: "custom",
          message: "undoToken is required in undo mode",
        });
    }),
  getPermissionKey: (args: any) => ({
    capability: "modify",
    target: ".",
    explanation:
      args.mode === "undo"
        ? "Undo verified agent-owned patch changes in the workspace"
        : `${args.dryRun ? "Preview" : "Apply"} a multi-file patch in the workspace`,
    risk: "high",
  }),
  execute: async (args: any, signal) => {
    if (args.mode === "undo") return undoPatch(args.undoToken, signal);
    const result = await applyPatch(process.cwd(), args.patch, {
      dryRun: args.dryRun,
      signal,
    });
    return {
      applied: result.applied,
      dryRun: result.dryRun,
      undoToken: result.undoToken,
      rolledBack: result.rolledBack,
      files: result.files.map((file) => ({
        path: file.path,
        changed: file.changed,
        originalHash: file.originalHash,
        ...(args.includeDiff ? { diff: file.diff } : {}),
      })),
    };
  },
};
