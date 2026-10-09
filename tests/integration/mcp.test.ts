import { afterEach, expect, test } from "bun:test";
import { McpClientConnection } from "../../src/mcp";
import { registerExternalTools, runTool } from "../../src/tool/registry";

const connections: McpClientConnection[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
});

test("real stdio MCP fixture initializes, discovers, validates, and invokes tools", async () => {
  const connection = new McpClientConnection({
    id: "fixture-stdio",
    transport: "stdio",
    command: process.execPath,
    args: ["tests/fixtures/mcp-server.ts"],
    environment: {},
    connectTimeoutMs: 5_000,
    toolTimeoutMs: 5_000,
    maxOutputChars: 5_000,
    enabled: true,
    allowedHosts: [],
    allowedTools: [],
  });
  connections.push(connection);
  await connection.connect();
  const discovered = await connection.discoverTools();
  registerExternalTools(connection.tools());
  expect(discovered.map((tool) => tool.namespacedName)).toContain(
    "mcp.fixture-stdio.greet",
  );
  expect(
    discovered.find((tool) => tool.name === "delete_record")?.sideEffect,
  ).toBe("destructive");
  const tool = connection
    .tools()
    .find((candidate) => candidate.name.endsWith(".greet"));
  expect(tool).toBeDefined();
  const result = await runTool(tool!.name, JSON.stringify({ name: "Ankit" }), {
    permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
    asker: async () => "allow-once",
    signal: new AbortController().signal,
    maxOutputChars: 5_000,
  });
  expect(result).toContain("hello Ankit");
});

test("MCP tool input validation and capability policy fail closed", async () => {
  const connection = new McpClientConnection({
    id: "fixture-policy",
    transport: "stdio",
    command: process.execPath,
    args: ["tests/fixtures/mcp-server.ts"],
    environment: {},
    connectTimeoutMs: 5_000,
    toolTimeoutMs: 5_000,
    maxOutputChars: 5_000,
    enabled: true,
    allowedHosts: [],
    allowedTools: ["greet", "validate_payload"],
  });
  connections.push(connection);
  await connection.connect();
  await connection.discoverTools();
  expect(connection.tools().map((tool) => tool.name)).not.toContain(
    "mcp.fixture-policy.delete_record",
  );
  await expect(
    connection.invoke(
      "mcp.fixture-policy.greet",
      {},
      new AbortController().signal,
      {
        allowedTools: ["mcp.fixture-policy.greet"],
        permissionGranted: true,
        permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
        asker: async () => "deny",
        signal: new AbortController().signal,
        maxOutputChars: 5_000,
      },
    ),
  ).rejects.toThrow("missing required");
  await expect(
    connection.invoke(
      "mcp.fixture-policy.greet",
      { name: "Ankit" },
      new AbortController().signal,
      {
        allowedTools: ["mcp.fixture-policy.greet"],
        permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
        asker: async () => "deny",
        signal: new AbortController().signal,
        maxOutputChars: 5_000,
      },
    ),
  ).rejects.toThrow("central permission approval");
  await expect(
    connection.invoke(
      "mcp.fixture-policy.validate_payload",
      { profile: { name: "A", age: 4 }, tags: ["safe"] },
      new AbortController().signal,
      {
        allowedTools: ["mcp.fixture-policy.validate_payload"],
        permissionGranted: true,
        permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
        asker: async () => "allow-once",
        signal: new AbortController().signal,
        maxOutputChars: 5_000,
      },
    ),
  ).rejects.toThrow("minLength");
  await expect(
    connection.invoke(
      "mcp.fixture-policy.validate_payload",
      { profile: { name: "Ankit", age: 4, role: "admin" }, tags: ["safe"] },
      new AbortController().signal,
      {
        allowedTools: ["mcp.fixture-policy.validate_payload"],
        permissionGranted: true,
        permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
        asker: async () => "allow-once",
        signal: new AbortController().signal,
        maxOutputChars: 5_000,
      },
    ),
  ).rejects.toThrow("not permitted");
});

test("MCP resources and prompts use the negotiated client session", async () => {
  const connection = new McpClientConnection({
    id: "fixture-content",
    transport: "stdio",
    command: process.execPath,
    args: ["tests/fixtures/mcp-server.ts"],
    environment: {},
    connectTimeoutMs: 5_000,
    toolTimeoutMs: 5_000,
    maxOutputChars: 5_000,
    enabled: true,
    allowedHosts: [],
    allowedTools: [],
  });
  connections.push(connection);
  await connection.connect();
  expect((await connection.listResources()).resources[0]?.uri).toBe(
    "fixture://notes",
  );
  expect(
    (await connection.readResource("fixture://notes")).contents[0],
  ).toMatchObject({ text: "fixture resource" });
  expect((await connection.listPrompts()).prompts[0]?.name).toBe("review");
  expect((await connection.getPrompt("review")).messages[0]).toMatchObject({
    role: "user",
  });
});

test("configured MCP credentials fail closed when unavailable", async () => {
  const connection = new McpClientConnection({
    id: "fixture-auth",
    transport: "streamable-http",
    args: [],
    url: "https://127.0.0.1:1/mcp",
    allowedHosts: ["127.0.0.1"],
    authEnvironmentVariable: "CHIKU_TEST_MISSING_TOKEN",
    environment: {},
    connectTimeoutMs: 1_000,
    toolTimeoutMs: 1_000,
    maxOutputChars: 1_000,
    enabled: true,
    allowedTools: [],
  });
  await expect(connection.connect()).rejects.toThrow(
    "CHIKU_TEST_MISSING_TOKEN is not configured",
  );
});

test("MCP HTTP transport requires an explicit HTTPS host allowlist", async () => {
  const connection = new McpClientConnection({
    id: "fixture-ssrf",
    transport: "streamable-http",
    url: "http://127.0.0.1:1/mcp",
    allowedHosts: ["127.0.0.1"],
    environment: {},
    connectTimeoutMs: 1_000,
    toolTimeoutMs: 1_000,
    maxOutputChars: 1_000,
    enabled: true,
    allowedTools: [],
    args: [],
  });
  await expect(connection.connect()).rejects.toThrow("requires HTTPS");
});
