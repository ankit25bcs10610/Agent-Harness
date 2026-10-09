import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parsePatch, applyPatch } from "../patch/engine";
import { inspectProject } from "../modernization/inspect";
import type { DependencyRecord } from "../modernization/types";

export type SecurityScope = {
  root: string;
  allowedPaths?: readonly string[];
  excludedPaths?: readonly string[];
  allowDynamicTesting?: boolean;
  maxFiles?: number;
  maxBytesPerFile?: number;
};

export type ValidatedSecurityScope = SecurityScope & {
  root: string;
  allowedPaths: readonly string[];
  excludedPaths: readonly string[];
  allowDynamicTesting: boolean;
};

export type SecurityFindingType =
  | "secret-exposure"
  | "unsafe-command"
  | "path-traversal"
  | "unsafe-evaluation"
  | "sensitive-logging"
  | "dependency-risk";

export type SecurityFinding = {
  findingId: string;
  source: "static" | "secret-scan" | "dependency" | "advisory";
  location: { file: string; line: number; column?: number };
  evidence: string;
  type: SecurityFindingType;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  confidence: "confirmed" | "likely" | "scanner-alert" | "unknown";
  affectedComponent: string;
  verificationStatus: "confirmed" | "unverified" | "unknown";
  remediationState: "OPEN" | "UNKNOWN" | "FALSE_POSITIVE_CONFIRMED";
};

export type AdvisoryLookup = (dependency: DependencyRecord) => Promise<
  {
    advisoryId: string;
    affectedVersions: string;
    fixedVersion?: string;
    source: string;
    updatedAt?: string;
  }[]
>;

const ignored = new Set([
  ".git",
  ".chiku",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const secretPatterns: readonly [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/,
    "credential-shaped token",
  ],
  [
    /(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i,
    "credential assignment",
  ],
];

function redactedEvidence(value: string) {
  return value.replace(/[A-Za-z0-9_=-]{8,}/g, "[REDACTED]").slice(0, 240);
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function portableRelative(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

export async function validateSecurityScope(
  input: SecurityScope,
): Promise<ValidatedSecurityScope> {
  const root = await realpath(input.root).catch(() => {
    throw new Error("authorized security scope root does not exist");
  });
  const allowedPaths = input.allowedPaths ?? ["."];
  const excludedPaths = input.excludedPaths ?? [];
  for (const candidate of [...allowedPaths, ...excludedPaths]) {
    const absolute = resolve(root, candidate);
    if (!within(root, absolute))
      throw new Error(`security scope escapes repository: ${candidate}`);
  }
  if (input.allowDynamicTesting && input.root === process.cwd())
    throw new Error("dynamic testing requires an isolated fixture scope");
  return {
    ...input,
    root,
    allowedPaths,
    excludedPaths,
    allowDynamicTesting: input.allowDynamicTesting ?? false,
  };
}

async function filesInScope(scope: ValidatedSecurityScope) {
  const output: string[] = [];
  async function visit(directory: string) {
    if (output.length >= (scope.maxFiles ?? 5000)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
      const absolute = join(directory, entry.name);
      const rel = portableRelative(scope.root, absolute);
      if (
        scope.excludedPaths.some(
          (excluded) => rel === excluded || rel.startsWith(`${excluded}/`),
        )
      )
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (
        entry.isFile() &&
        scope.allowedPaths.some(
          (allowed) =>
            allowed === "." || rel === allowed || rel.startsWith(`${allowed}/`),
        )
      )
        output.push(rel);
    }
  }
  await visit(scope.root);
  return output.sort();
}

function addStaticFindings(file: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lineOf = (index: number) =>
    content.slice(0, index).split(/\r?\n/).length;
  for (const [pattern, label] of secretPatterns) {
    const match = pattern.exec(content);
    if (match?.index !== undefined)
      findings.push({
        findingId: `secret:${file}:${lineOf(match.index)}`,
        source: "secret-scan",
        location: { file, line: lineOf(match.index) },
        evidence: redactedEvidence(
          content.split(/\r?\n/)[lineOf(match.index) - 1] ?? label,
        ),
        type: "secret-exposure",
        severity: "high",
        confidence: "likely",
        affectedComponent: file,
        verificationStatus: "unverified",
        remediationState: "UNKNOWN",
      });
  }
  const rules: readonly [
    RegExp,
    SecurityFindingType,
    string,
    SecurityFinding["severity"],
  ][] = [
    [
      /\b(?:child_process\.)?exec\s*\(\s*[`"']?[^)]*\$\{|\bexecFile\s*\(\s*[^,]+\+/,
      "unsafe-command",
      "dynamic command construction",
      "high",
    ],
    [
      /(?:readFile|writeFile|stat)\s*\([^\n]*(?:req\.|request\.|params\.|query\.|user)/i,
      "path-traversal",
      "request-derived filesystem path",
      "high",
    ],
    [
      /(?:eval|new Function)\s*\(/,
      "unsafe-evaluation",
      "dynamic code evaluation",
      "high",
    ],
    [
      /console\.(?:log|error|warn)\s*\([^\n]*(?:password|token|secret|authorization|apiKey)/i,
      "sensitive-logging",
      "sensitive value in diagnostic output",
      "high",
    ],
  ];
  for (const [pattern, type, evidence, severity] of rules) {
    const match = pattern.exec(content);
    if (match?.index !== undefined)
      findings.push({
        findingId: `${type}:${file}:${lineOf(match.index)}`,
        source: "static",
        location: { file, line: lineOf(match.index) },
        evidence,
        type,
        severity,
        confidence: "scanner-alert",
        affectedComponent: file,
        verificationStatus: "unverified",
        remediationState: "UNKNOWN",
      });
  }
  return findings;
}

export async function scanAuthorizedRepository(
  scopeInput: SecurityScope,
  advisoryLookup?: AdvisoryLookup,
) {
  const scope = await validateSecurityScope(scopeInput);
  const files = await filesInScope(scope);
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const content = await readFile(join(scope.root, file), "utf8").catch(
      () => "",
    );
    if (
      !content ||
      content.includes("\0") ||
      Buffer.byteLength(content) > (scope.maxBytesPerFile ?? 1_000_000)
    )
      continue;
    findings.push(...addStaticFindings(file, content));
  }
  const inventory = await inspectProject(scope.root).catch(() => undefined);
  if (inventory && advisoryLookup)
    for (const dependency of inventory.dependencies)
      for (const advisory of await advisoryLookup(dependency))
        findings.push({
          findingId: `advisory:${advisory.advisoryId}:${dependency.name}`,
          source: "advisory",
          location: { file: dependency.source, line: 1 },
          evidence: `advisory ${advisory.advisoryId} reported by ${advisory.source}`,
          type: "dependency-risk",
          severity: "unknown",
          confidence: "scanner-alert",
          affectedComponent: dependency.name,
          verificationStatus: "unverified",
          remediationState: "UNKNOWN",
        });
  const correlated = [
    ...new Map(
      findings.map((finding) => [finding.findingId, finding]),
    ).values(),
  ];
  return {
    scope,
    files,
    findings: correlated,
    limitations: [
      "Static rules are language-limited and scanner alerts require manual verification",
      "No advisory source is consulted unless an authorized lookup adapter is supplied",
      "No dynamic testing is performed by this scanner",
    ],
  };
}

export async function applyAuthorizedSecurityPatch(
  root: string,
  patch: string,
  approvedFiles: readonly string[],
) {
  const files = parsePatch(patch);
  const unauthorized = files
    .map((file) => file.path)
    .filter((path) => !approvedFiles.includes(path));
  if (unauthorized.length)
    throw new Error(
      `security patch exceeds approved files: ${unauthorized.join(", ")}`,
    );
  return applyPatch(root, patch);
}
