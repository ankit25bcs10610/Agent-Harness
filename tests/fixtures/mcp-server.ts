import { createInterface } from "node:readline";

const tools = [
  {
    name: "greet",
    description: "Read a greeting for a name",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "delete_record",
    description: "Delete a record",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "validate_payload",
    description: "Inspect a structured payload",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        profile: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 2 },
            age: { type: "integer", minimum: 0 },
          },
          required: ["name", "age"],
        },
        tags: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["profile", "tags"],
    },
  },
];

const lineReader = createInterface({ input: process.stdin });
for await (const line of lineReader) {
  if (!line.trim()) continue;
  const request = JSON.parse(line) as {
    id?: number;
    method: string;
    params?: Record<string, unknown>;
  };
  if (request.id === undefined) continue;
  let result: unknown;
  if (request.method === "initialize") {
    result = {
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: { listChanged: false },
        resources: {},
        prompts: {},
      },
      serverInfo: { name: "fixture", version: "1.0.0" },
    };
  } else if (request.method === "tools/list") result = { tools };
  else if (request.method === "tools/call") {
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    result = {
      content: [
        { type: "text", text: `hello ${String(args.name ?? "unknown")}` },
      ],
    };
  } else if (request.method === "resources/list")
    result = {
      resources: [
        { uri: "fixture://notes", name: "notes", mimeType: "text/plain" },
      ],
    };
  else if (request.method === "resources/read")
    result = {
      contents: [
        {
          uri: "fixture://notes",
          mimeType: "text/plain",
          text: "fixture resource",
        },
      ],
    };
  else if (request.method === "prompts/list")
    result = {
      prompts: [
        { name: "review", description: "Review fixture", arguments: [] },
      ],
    };
  else if (request.method === "prompts/get")
    result = {
      description: "Review fixture",
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Review this fixture" },
        },
      ],
    };
  else result = {};
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
  );
}
