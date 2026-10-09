const features = [
  {
    name: "Repository intelligence",
    status: "AVAILABLE",
    text: "Inspect files, search source, and load structured repository context through registered tools.",
  },
  {
    name: "Permission-aware tools",
    status: "AVAILABLE",
    text: "File operations and process execution pass through capability-scoped policy decisions.",
  },
  {
    name: "Context and sessions",
    status: "AVAILABLE",
    text: "Prune active context and persist local session state for continued work.",
  },
  {
    name: "Verification workflow",
    status: "BETA",
    text: "Run configured checks and report actual evidence instead of assuming success.",
  },
  {
    name: "MCP and GitHub",
    status: "EXPERIMENTAL",
    text: "Optional integrations exist in the source tree; validate credentials and scope before use.",
  },
  {
    name: "Multi-agent workflows",
    status: "EXPERIMENTAL",
    text: "Coordinator and workspace modules are available for continued integration work.",
  },
];
document.querySelector("#feature-grid").innerHTML = features
  .map(
    (feature) =>
      `<article class="feature-card"><span class="badge">${feature.status}</span><h3>${feature.name}</h3><p>${feature.text}</p></article>`,
  )
  .join("");
document.querySelectorAll("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }),
);
document.querySelector("#theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem(
    "chiku-theme",
    document.body.classList.contains("light") ? "light" : "dark",
  );
});
if (localStorage.getItem("chiku-theme") === "light")
  document.body.classList.add("light");
