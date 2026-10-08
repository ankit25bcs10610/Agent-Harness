import { chmod, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const target =
  process.env.CHIKU_TARGET ?? `bun-${process.platform}-${process.arch}`;
const artifact = process.env.CHIKU_OUTPUT ?? `chiku-${target}`;
const output = resolve("dist", artifact);
const version = (
  JSON.parse(await readFile("package.json", "utf8")) as { version: string }
).version;
await mkdir(resolve("dist"), { recursive: true });
const child = Bun.spawn(
  [
    "bun",
    "build",
    "src/index.tsx",
    "--compile",
    `--target=${target}`,
    `--outfile=${output}`,
    "--define",
    `process.env.CHIKU_VERSION=${JSON.stringify(version)}`,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const code = await child.exited;
if (code !== 0) process.exit(code);
await chmod(output, 0o755);
console.log(`built ${join("dist", artifact)} for ${target}`);
