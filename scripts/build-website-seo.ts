import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const origin = process.env.PUBLIC_SITE_ORIGIN?.replace(/\/$/, "");
if (origin && !/^https:\/\//.test(origin))
  throw new Error("PUBLIC_SITE_ORIGIN must use https://");
await mkdir("website", { recursive: true });
await writeFile("website/robots.txt", "User-agent: *\nAllow: /\n");
if (origin) {
  const urls = ["/", "/docs.html"]
    .map((path) => `  <url><loc>${origin}${path}</loc></url>`)
    .join("\n");
  await writeFile(
    "website/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  console.log(`Generated sitemap for ${origin}`);
} else {
  console.log(
    "No PUBLIC_SITE_ORIGIN supplied; skipped sitemap and canonical URL generation.",
  );
}
