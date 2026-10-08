import { readFile } from "node:fs/promises";

const tracked = Bun.spawn(["git", "ls-files", "-z"], { stdout: "pipe" });
const files = (await new Response(tracked.stdout).text())
  .split("\0")
  .filter(Boolean);
if ((await tracked.exited) !== 0)
  throw new Error("unable to enumerate tracked files");

const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["'][^"']{20,}["']/i,
];
const ignored = new Set(["bun.lock", "package-lock.json", "yarn.lock"]);
const findings: string[] = [];
for (const path of files) {
  if (ignored.has(path) || /(?:^|\/)(?:node_modules|dist|build)\//.test(path))
    continue;
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const pattern of credentialPatterns) {
    if (pattern.test(content)) {
      findings.push(`${path}: ${pattern.source}`);
      break;
    }
  }
}
if (findings.length) {
  console.error("Credential-shaped material found in tracked files:");
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`Security scan passed: ${files.length} tracked files inspected`);
