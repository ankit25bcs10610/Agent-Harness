import { expect, test } from "bun:test";
import { GitHubApiError, GitHubClient } from "../../src/github";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("GitHub client discovers repository data and preserves least-privilege bearer auth", async () => {
  const requests: Request[] = [];
  const client = new GitHubClient({
    token: "test-token",
    apiBaseUrl: "https://github.test",
    fetch: async (input, init) => {
      const request = new Request(String(input), init);
      requests.push(request);
      return response({
        owner: { login: "ankit25bcs10610" },
        name: "Agent-Harness",
        default_branch: "main",
        permissions: { pull_requests: true },
      });
    },
  });
  expect(
    await client.repository({
      owner: "ankit25bcs10610",
      name: "Agent-Harness",
    }),
  ).toMatchObject({ defaultBranch: "main" });
  expect(requests[0]?.headers.get("authorization")).toBe("Bearer test-token");
  expect(requests[0]?.headers.get("x-github-api-version")).toBe("2022-11-28");
});

test("GitHub client prepares a pull request and aggregates check failures", async () => {
  const calls: string[] = [];
  const client = new GitHubClient({
    token: "token",
    apiBaseUrl: "https://github.test",
    authorizeMutation: () => true,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/pulls"))
        return response({
          number: 7,
          url: "api/pr/7",
          html_url: "https://github.test/pr/7",
          state: "open",
          head: { ref: "feature" },
          base: { ref: "main" },
        });
      if (url.endsWith("/pulls/7"))
        return response({
          draft: false,
          mergeable: true,
          head: { sha: "abc" },
        });
      return response({
        check_runs: [
          { name: "test", status: "completed", conclusion: "failure" },
          { name: "lint", status: "queued", conclusion: null },
        ],
      });
    },
  });
  const repo = { owner: "o", name: "r" };
  expect(
    (
      await client.createPullRequest(
        repo,
        {
          title: "Update",
          body: "body",
          head: "feature",
          base: "main",
        },
        { idempotencyKey: "create-pr-7" },
      )
    ).number,
  ).toBe(7);
  const readiness = await client.mergeReadiness(repo, 7);
  expect(readiness.ready).toBe(false);
  expect(readiness.checks.failed).toBe(1);
  expect(readiness.checks.pending).toBe(1);
  expect(calls.some((call) => call.startsWith("POST"))).toBe(true);
});

test("GitHub mutations fail closed and authorized retries are idempotent", async () => {
  let postCount = 0;
  const repository = { owner: "o", name: "r" };
  const payload = {
    title: "Update",
    body: "body",
    head: "feature",
    base: "main",
  };
  const denied = new GitHubClient({
    token: "token",
    fetch: async () => {
      postCount++;
      return response({});
    },
  });
  await expect(denied.createPullRequest(repository, payload)).rejects.toThrow(
    "requires explicit authorization",
  );
  expect(postCount).toBe(0);

  const approved = new GitHubClient({
    token: "token",
    authorizeMutation: (request) =>
      request.repository.owner === "o" && request.payload.head === "feature",
    fetch: async () => {
      postCount++;
      return response({
        number: 8,
        url: "api/pr/8",
        html_url: "https://github.test/pr/8",
        state: "open",
        head: { ref: "feature" },
        base: { ref: "main" },
      });
    },
  });
  const first = await approved.createPullRequest(repository, payload, {
    idempotencyKey: "create-pr-8",
  });
  const second = await approved.createPullRequest(repository, payload, {
    idempotencyKey: "create-pr-8",
  });
  expect(second).toEqual(first);
  expect(postCount).toBe(1);
});

test("GitHub client parses remotes and fails closed on API errors", async () => {
  const created = GitHubClient.fromRemote("git@github.com:owner/project.git", {
    token: "token",
    fetch: async () => response({ ok: true }),
  });
  expect(created.repository).toEqual({ owner: "owner", name: "project" });
  const client = new GitHubClient({
    token: "token",
    fetch: async () => response({ message: "forbidden" }, 403),
  });
  await expect(
    client.repository({ owner: "o", name: "r" }),
  ).rejects.toBeInstanceOf(GitHubApiError);
});
