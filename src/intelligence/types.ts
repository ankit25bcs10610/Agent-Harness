export type IntelligenceLanguage = "typescript" | "javascript" | "unknown";
export type SymbolKind =
  "function" | "class" | "method" | "interface" | "type" | "variable";
export type RepositorySymbol = {
  id: string;
  name: string;
  kind: SymbolKind;
  path: string;
  language: IntelligenceLanguage;
  startLine: number;
  endLine: number;
  exported: boolean;
  container?: string | undefined;
};
export type RepositoryEdge = {
  from: string;
  to: string;
  kind: "imports" | "defines";
  evidence: string;
};
export type RepositoryIndex = {
  root: string;
  createdAt: string;
  files: {
    path: string;
    hash: string;
    bytes: number;
    language: IntelligenceLanguage;
  }[];
  symbols: RepositorySymbol[];
  edges: RepositoryEdge[];
  errors: string[];
};
export type RetrievalResult = {
  path: string;
  startLine: number;
  endLine: number;
  reason: string;
  symbols: string[];
};
export type IntelligenceOptions = {
  root: string;
  maxFiles?: number;
  maxFileBytes?: number;
  exclude?: string[];
  onMetric?: (metric: {
    name: "repository.list" | "repository.parse" | "repository.index";
    durationMs: number;
    items: number;
  }) => void;
};
export type IndexChanges = {
  added: string[];
  modified: string[];
  deleted: string[];
};
