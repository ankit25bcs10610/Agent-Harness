import { z } from "zod";

export const GitHubRepositorySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;

export type GitHubFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GitHubClientOptions = {
  token: string;
  fetch?: GitHubFetch;
  apiBaseUrl?: string;
  signal?: AbortSignal;
};

export type PullRequestInput = {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
};

export type PullRequest = {
  number: number;
  url: string;
  htmlUrl: string;
  state: string;
  head: string;
  base: string;
};

export type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl?: string;
};

export type CheckSummary = {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  runs: CheckRun[];
};

export type MergeReadiness = {
  ready: boolean;
  reasons: string[];
  checks: CheckSummary;
  draft: boolean;
  mergeable: boolean | null;
};
