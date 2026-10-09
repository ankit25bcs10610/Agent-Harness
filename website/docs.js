const input = document.querySelector("#docs-search");
const results = document.querySelector("#docs-results");
const status = document.querySelector("#docs-status");
const index = await fetch("/docs-index.json")
  .then((response) => {
    if (!response.ok)
      throw new Error(`Documentation index unavailable (${response.status})`);
    return response.json();
  })
  .catch((error) => ({ error }));
function render(query = "") {
  if (index.error) {
    status.textContent = index.error.message;
    results.innerHTML = "";
    return;
  }
  const normalized = query.trim().toLowerCase();
  const matches = index.entries.filter(
    (entry) =>
      !normalized ||
      `${entry.title} ${entry.path} ${entry.excerpt} ${entry.content}`
        .toLowerCase()
        .includes(normalized),
  );
  status.textContent = `${matches.length} document${matches.length === 1 ? "" : "s"} found`;
  results.innerHTML = matches
    .map(
      (entry) =>
        `<article class="doc-result"><p class="eyebrow">${entry.path}</p><h2>${entry.title}</h2><p>${entry.excerpt}</p><details><summary>Read source excerpt</summary><pre>${entry.content.slice(0, 4000).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></details></article>`,
    )
    .join("");
}
input.addEventListener("input", () => render(input.value));
render();
