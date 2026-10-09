import {
  GitHubRepositorySchema,
  type CheckSummary,
  type GitHubClientOptions,
  type GitHubRepository,
  type PullRequest,
  type PullRequestInput,
  type GitHubMutationRequest,
} from "./types";

function repositoryFromRemote(remote: string): GitHubRepository {
  const match = remote
    .trim()
    .match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error("origin is not a GitHub repository");
  return GitHubRepositorySchema.parse({ owner: match[1], name: match[2] });
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub returned an invalid JSON object");
  return value as Record<string, unknown>;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubClient {
  private readonly fetcher: NonNullable<GitHubClientOptions["fetch"]>;
  private readonly baseUrl: string;
  private readonly signal: AbortSignal | undefined;
  private readonly authorizeMutation: GitHubClientOptions["authorizeMutation"];
  private readonly mutationResults = new Map<string, PullRequest>();

  constructor(private readonly options: GitHubClientOptions) {
    if (!options.token.trim()) throw new Error("GitHub token is required");
    this.fetcher = options.fetch ?? fetch;
    this.baseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(
      /\/$/,
      "",
    );
    this.signal = options.signal;
    this.authorizeMutation = options.authorizeMutation;
  }

  private async request(path: string, init: RequestInit = {}) {
    const requestInit: RequestInit = {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.options.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    };
    const signal = init.signal ?? this.signal;
    if (signal) requestInit.signal = signal;
    const response = await this.fetcher(`${this.baseUrl}${path}`, requestInit);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GitHubApiError(
        response.status,
        `GitHub API ${response.status}: ${body.slice(0, 500)}`,
      );
    }
    return response;
  }

  static fromRemote(remote: string, options: GitHubClientOptions) {
    return {
      repository: repositoryFromRemote(remote),
      client: new GitHubClient(options),
    };
  }

  async repository(repository: GitHubRepository) {
    const data = jsonObject(
      await (
        await this.request(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
        )
      ).json(),
    );
    return {
      owner: String(jsonObject(data.owner).login),
      name: String(data.name),
      defaultBranch: String(data.default_branch),
      permissions: data.permissions,
    };
  }

  async createPullRequest(
    repository: GitHubRepository,
    input: PullRequestInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<PullRequest> {
    const request: GitHubMutationRequest = {
      operation: "create_pull_request",
      repository,
      payload: input,
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
    };
    if (!this.authorizeMutation)
      throw new Error("GitHub mutation requires explicit authorization");
    if (!(await this.authorizeMutation(request)))
      throw new Error("GitHub mutation was not authorized");
    if (options.idempotencyKey) {
      const previous = this.mutationResults.get(options.idempotencyKey);
      if (previous) return previous;
    }
    const data = jsonObject(
      await (
        await this.request(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        )
      ).json(),
    );
    const result = {
      number: Number(data.number),
      url: String(data.url),
      htmlUrl: String(data.html_url),
      state: String(data.state),
      head: String(jsonObject(data.head).ref),
      base: String(jsonObject(data.base).ref),
    };
    if (options.idempotencyKey)
      this.mutationResults.set(options.idempotencyKey, result);
    return result;
  }

  async checks(
    repository: GitHubRepository,
    ref: string,
  ): Promise<CheckSummary> {
    const data = jsonObject(
      await (
        await this.request(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(ref)}/check-runs`,
        )
      ).json(),
    );
    const runs = Array.isArray(data.check_runs)
      ? data.check_runs.map((run) => {
          const item = jsonObject(run);
          return {
            name: String(item.name),
            status: String(item.status),
            conclusion:
              item.conclusion == null ? null : String(item.conclusion),
            ...(item.details_url
              ? { detailsUrl: String(item.details_url) }
              : {}),
          };
        })
      : [];
    return {
      total: runs.length,
      pending: runs.filter((run) => run.status !== "completed").length,
      passed: runs.filter((run) => run.conclusion === "success").length,
      failed: runs.filter(
        (run) => run.status === "completed" && run.conclusion !== "success",
      ).length,
      runs,
    };
  }

  async mergeReadiness(
    repository: GitHubRepository,
    pullNumber: number,
  ): Promise<import("./types").MergeReadiness> {
    const data = jsonObject(
      await (
        await this.request(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${pullNumber}`,
        )
      ).json(),
    );
    const head = String(jsonObject(data.head).sha);
    const checks = await this.checks(repository, head);
    const reasons = [
      ...(Boolean(data.draft) ? ["pull request is a draft"] : []),
      ...(data.mergeable === false ? ["GitHub reports merge conflicts"] : []),
      ...(checks.pending
        ? [`${checks.pending} check(s) are still pending`]
        : []),
      ...(checks.failed ? [`${checks.failed} check(s) failed`] : []),
    ];
    return {
      ready: reasons.length === 0 && data.mergeable !== null,
      reasons,
      checks,
      draft: Boolean(data.draft),
      mergeable: typeof data.mergeable === "boolean" ? data.mergeable : null,
    };
  }
}
