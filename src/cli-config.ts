import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CliConfigSchema = z.object({
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  sessionDirectory: z.string().min(1).optional(),
  noColor: z.boolean().optional(),
});
export type CliConfig = z.infer<typeof CliConfigSchema>;

async function readConfig(path: string) {
  try {
    await access(path, constants.R_OK);
    return CliConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    throw new Error(
      `invalid Chiku config ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadCliConfig(explicitPath?: string): Promise<CliConfig> {
  const paths = explicitPath
    ? [explicitPath]
    : [
        join(homedir(), ".chiku", "config.json"),
        join(process.cwd(), ".chiku", "config.json"),
      ];
  let result: CliConfig = {};
  for (const path of paths) result = { ...result, ...(await readConfig(path)) };
  return {
    ...result,
    ...(process.env.CHIKU_MODEL ? { model: process.env.CHIKU_MODEL } : {}),
    ...(process.env.CHIKU_PROVIDER
      ? { provider: process.env.CHIKU_PROVIDER }
      : {}),
  };
}
