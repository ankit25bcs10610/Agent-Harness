import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const files = [
  "README.md",
  ...(await readdir(join(root, "docs")))
    .map((file) => join("docs", file))
    .filter((file) => file.endsWith(".md")),
];
const entries = await Promise.all(
  files.map(async (source) => {
    const content = await readFile(join(root, source), "utf8");
    const title =
      content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(source, ".md");
    const excerpt = content
      .replace(/^```[\s\S]*?```/gm, "")
      .replace(/[#*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);
    return {
      title,
      path: relative(root, join(root, source)).replaceAll("\\", "/"),
      excerpt,
      content,
    };
  }),
);
await mkdir(join(root, "website"), { recursive: true });
await writeFile(
  join(root, "website/docs-index.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2) +
    "\n",
);
console.log(`Generated ${entries.length} documentation entries.`);
