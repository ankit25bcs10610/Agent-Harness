import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const output = resolve("dist/chiku.js");
const version = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;
await mkdir(dirname(output), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve("src/index.tsx")],
  outdir: resolve("dist"),
  target: "bun",
  naming: "chiku.js",
  sourcemap: "external",
  minify: false,
  define: { "process.env.CHIKU_VERSION": JSON.stringify(version) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  const bundled = await readFile(output, "utf8");
  await writeFile(output, `#!/usr/bin/env bun\n${bundled}`);
  await chmod(output, 0o755);
  await writeFile(
    resolve("dist/build-metadata.json"),
    `${JSON.stringify({ runtime: Bun.version, builtAt: new Date().toISOString(), entrypoint: "src/index.tsx" }, null, 2)}\n`,
  );
}
