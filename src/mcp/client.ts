import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { ToolContext } from "../tool/types";
import type { Tool } from "../tool/types";
import {
  McpServerConfigSchema,
  type McpServerConfig,
  type McpToolRecord,
} from "./types";

type Connected = {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
};

function classify(name: string, description: string) {
  const text = `${name} ${description}`.toLowerCase();
  if (
    /delete|destroy|drop|send|publish|deploy|payment|write|update|create/.test(
      text,
    )
  )
    return "destructive" as const;
  if (/edit|modify|set|move|rename|execute|run/.test(text))
    return "write" as const;
  if (/read|list|search|get|fetch|inspect/.test(text)) return "read" as const;
  return "unknown" as const;
}

function validateSchema(schema: Record<string, unknown>, value: unknown) {
  for (const keyword of ["anyOf", "oneOf", "allOf", "not", "patternProperties"])
    if (keyword in schema)
      throw new Error(`unsupported MCP input schema keyword: ${keyword}`);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP tool arguments must be an object");
  const type = schema.type;
  if (type !== undefined && type !== "object")
    throw new Error("unsupported MCP input schema: root must be an object");
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return;
  for (const name of required) {
    if (typeof name === "string" && !(name in value))
      throw new Error(`missing required MCP argument: ${name}`);
  }
  for (const [name, rule] of Object.entries(properties)) {
    if (!(name in value) || !rule || typeof rule !== "object") continue;
    const expected = (rule as { type?: unknown }).type;
    const ruleRecord = rule as Record<string, unknown>;
    const actual = typeof (value as Record<string, unknown>)[name];
    if (expected === "string" && actual !== "string")
      throw new Error(`MCP argument ${name} must be a string`);
    if (expected === "number" && actual !== "number")
      throw new Error(`MCP argument ${name} must be a number`);
    if (expected === "boolean" && actual !== "boolean")
      throw new Error(`MCP argument ${name} must be a boolean`);
    if (
      expected === "array" &&
      !Array.isArray((value as Record<string, unknown>)[name])
    )
      throw new Error(`MCP argument ${name} must be an array`);
    if (
      expected === "object" &&
      (actual !== "object" || (value as Record<string, unknown>)[name] === null)
    )
      throw new Error(`MCP argument ${name} must be an object`);
    if (
      Array.isArray(ruleRecord.enum) &&
      !ruleRecord.enum.includes((value as Record<string, unknown>)[name])
    )
      throw new Error(`MCP argument ${name} is not an allowed value`);
    if (
      typeof ruleRecord.pattern === "string" &&
      typeof (value as Record<string, unknown>)[name] === "string" &&
      !new RegExp(ruleRecord.pattern).test(
        (value as Record<string, unknown>)[name] as string,
      )
    )
      throw new Error(
        `MCP argument ${name} does not match its required pattern`,
      );
  }
}

export class McpClientConnection {
  private connection: Connected | undefined;
  private readonly records = new Map<string, McpToolRecord>();
  readonly audit: import("./types").McpAuditEvent[] = [];

  constructor(readonly config: McpServerConfig) {}

  async connect(signal = new AbortController().signal) {
    const config = McpServerConfigSchema.parse(this.config);
    if (!config.enabled) throw new Error(`MCP server disabled: ${config.id}`);
    if (config.transport === "stdio" && !config.command)
      throw new Error("stdio MCP server requires command");
    if (config.transport === "streamable-http" && !config.url)
      throw new Error("HTTP MCP server requires URL");
    const headers: Record<string, string> = {};
    if (config.authEnvironmentVariable) {
      const token = process.env[config.authEnvironmentVariable];
      if (!token)
        throw new Error(
          `MCP credential ${config.authEnvironmentVariable} is not configured`,
        );
      headers.Authorization = `Bearer ${token}`;
    }
    const transport =
      config.transport === "stdio"
        ? new StdioClientTransport({
            command: config.command!,
            args: config.args,
            ...(config.cwd ? { cwd: config.cwd } : {}),
            env: config.environment,
            stderr: "pipe",
          })
        : new StreamableHTTPClientTransport(new URL(config.url!), {
            requestInit: { headers },
          });
    const client = new Client({ name: "chiku", version: "1.0.0" });
    this.audit.push({
      at: new Date().toISOString(),
      serverId: config.id,
      operation: "connect",
      outcome: "started",
    });
    const abort = () => void transport.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([
        client.connect(transport as never),
        new Promise<never>(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(new Error("MCP connection timeout")),
              config.connectTimeoutMs,
            )),
        ),
      ]);
      this.connection = { config, client, transport };
      this.audit.push({
        at: new Date().toISOString(),
        serverId: config.id,
        operation: "connect",
        outcome: "completed",
      });
      return this;
    } catch (error) {
      this.audit.push({
        at: new Date().toISOString(),
        serverId: config.id,
        operation: "connect",
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      await transport.close().catch(() => undefined);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  async discoverTools() {
    const connection = this.connection;
    if (!connection) throw new Error("MCP server is not connected");
    const response = await connection.client.listTools();
    this.records.clear();
    for (const tool of response.tools) {
      if (
        connection.config.allowedTools.length &&
        !connection.config.allowedTools.includes(tool.name)
      )
        continue;
      const record: McpToolRecord = {
        serverId: connection.config.id,
        name: tool.name,
        namespacedName: `mcp.${connection.config.id}.${tool.name}`,
        description: tool.description ?? "External MCP tool",
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        sideEffect: classify(tool.name, tool.description ?? ""),
      };
      this.records.set(record.namespacedName, record);
    }
    this.audit.push({
      at: new Date().toISOString(),
      serverId: connection.config.id,
      operation: "discover",
      outcome: "completed",
      detail: `${this.records.size} tools`,
    });
    return [...this.records.values()];
  }

  tools(): Tool<any, unknown>[] {
    return [...this.records.values()].map((record) => ({
      name: record.namespacedName,
      description: `[MCP ${record.serverId}] ${record.description}`,
      parameters: z.object({}).passthrough(),
      getPermissionKey: () => ({
        capability: "external",
        target: `${record.serverId}:${record.name}`,
        explanation: `Invoke external MCP tool ${record.serverId}/${record.name}`,
        risk: record.sideEffect === "destructive" ? "high" : "normal",
      }),
      execute: async (
        args: unknown,
        signal: AbortSignal,
        context?: ToolContext,
      ) => this.invoke(record.namespacedName, args, signal, context),
    }));
  }

  async invoke(
    namespacedName: string,
    args: unknown,
    signal: AbortSignal,
    context?: ToolContext,
  ) {
    const connection = this.connection;
    const record = this.records.get(namespacedName);
    if (!connection || !record) throw new Error("MCP tool is unavailable");
    validateSchema(record.inputSchema, args);
    if (context?.allowedTools && !context.allowedTools.includes(namespacedName))
      throw new Error("agent capability policy denies this MCP tool");
    if (
      (record.sideEffect === "write" || record.sideEffect === "destructive") &&
      !context?.requiredContractId
    )
      throw new Error(
        "MCP side-effecting tool requires a bound Change Contract",
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => void connection.transport.close();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await Promise.race([
        connection.client.callTool({
          name: record.name,
          arguments: args as Record<string, unknown>,
        }),
        new Promise<never>(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(new Error("MCP tool timeout")),
              connection.config.toolTimeoutMs,
            )),
        ),
      ]);
      this.audit.push({
        at: new Date().toISOString(),
        serverId: record.serverId,
        tool: record.name,
        operation: "invoke",
        outcome: "completed",
      });
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  async listResources() {
    if (!this.connection) throw new Error("MCP server is not connected");
    return this.connection.client.listResources();
  }

  async readResource(uri: string, signal = new AbortController().signal) {
    if (!this.connection) throw new Error("MCP server is not connected");
    if (signal.aborted) throw new Error("MCP resource request cancelled");
    this.audit.push({
      at: new Date().toISOString(),
      serverId: this.config.id,
      operation: "resource",
      outcome: "started",
      detail: uri,
    });
    const result = await this.connection.client.readResource({ uri });
    this.audit.push({
      at: new Date().toISOString(),
      serverId: this.config.id,
      operation: "resource",
      outcome: "completed",
      detail: uri,
    });
    return result;
  }

  async listPrompts() {
    if (!this.connection) throw new Error("MCP server is not connected");
    return this.connection.client.listPrompts();
  }

  async getPrompt(name: string, arguments_: Record<string, string> = {}) {
    if (!this.connection) throw new Error("MCP server is not connected");
    this.audit.push({
      at: new Date().toISOString(),
      serverId: this.config.id,
      operation: "prompt",
      outcome: "started",
      detail: name,
    });
    const result = await this.connection.client.getPrompt({
      name,
      arguments: arguments_,
    });
    this.audit.push({
      at: new Date().toISOString(),
      serverId: this.config.id,
      operation: "prompt",
      outcome: "completed",
      detail: name,
    });
    return result;
  }

  async close() {
    if (this.connection) await this.connection.transport.close();
    this.connection = undefined;
  }
}
