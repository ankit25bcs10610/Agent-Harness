import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepositoryIndex, retrieve } from "../src/intelligence";

const root = await mkdtemp(join(tmpdir(), "chiku-intelligence-benchmark-"));
try {
  const files = Number(process.env.CHIKU_BENCHMARK_FILES ?? "100");
  for (let index = 0; index < files; index++)
    await writeFile(
      join(root, `module-${index}.ts`),
      `export function feature${index}() { return ${index}; }\n`,
    );
  const started = performance.now();
  const index = await buildRepositoryIndex(
    { root },
    new AbortController().signal,
  );
  const indexedAt = performance.now();
  const retrieved = retrieve(index, "feature", 20);
  const completed = performance.now();
  console.log(
    JSON.stringify({
      files: index.files.length,
      symbols: index.symbols.length,
      indexedMs: Math.round(indexedAt - started),
      retrievalMs: Math.round(completed - indexedAt),
      results: retrieved.length,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
