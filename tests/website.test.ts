import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("website source", () => {
  test("has working primary destinations and documentation search", async () => {
    const html = await readFile("website/index.html", "utf8");
    const docs = await readFile("website/docs.html", "utf8");
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="#docs"');
    expect(docs).toContain('id="docs-search"');
    expect(docs).toContain('src="/docs.js"');
  });
});
