import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const files = process.argv.slice(2);
if (!files.length)
  throw new Error("usage: bun scripts/checksums.ts <artifact> [...]");
for (const input of files) {
  const path = resolve(input);
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  await writeFile(`${path}.sha256`, `${digest}  ${basename(path)}\n`);
  console.log(`${digest}  ${basename(path)}`);
}
