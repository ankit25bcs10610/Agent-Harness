const root = new URL("../website/", import.meta.url);
const server = Bun.serve({
  port: Number(Bun.env.WEBSITE_PORT ?? 4173),
  async fetch(request) {
    const url = new URL(request.url);
    const relative =
      url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = Bun.file(new URL(relative, root));
    if (!(await file.exists()))
      return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});
console.log(`Chiku website: ${server.url}`);
