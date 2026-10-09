import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const root = new URL("../website/", import.meta.url);
const rootPath = fileURLToPath(root);

export function websiteAssetPath(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const requested =
    decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(rootPath, requested);
  const containment = relative(rootPath, candidate);
  if (containment.startsWith("..") || isAbsolute(containment)) return undefined;
  return candidate;
}

if (import.meta.main) {
  const server = Bun.serve({
    port: Number(Bun.env.WEBSITE_PORT ?? 4173),
    async fetch(request) {
      const url = new URL(request.url);
      const assetPath = websiteAssetPath(url.pathname);
      if (!assetPath) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(assetPath);
      if (!(await file.exists()))
        return new Response("Not found", { status: 404 });
      return new Response(file);
    },
  });
  console.log(`Chiku website: ${server.url}`);
}
