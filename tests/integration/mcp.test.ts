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
    allowedTools: ["greet"],
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
    ),
  ).rejects.toThrow("missing required");
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
    url: "http://127.0.0.1:1/mcp",
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
