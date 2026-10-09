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

function validateHttpEndpoint(config: McpServerConfig): URL {
  const endpoint = new URL(config.url!);
  if (endpoint.protocol !== "https:")
    throw new Error("MCP HTTP transport requires HTTPS");
  if (endpoint.username || endpoint.password)
    throw new Error("MCP HTTP URL must not contain credentials");
  if (!config.allowedHosts.includes(endpoint.hostname))
    throw new Error(`MCP host is not allowlisted: ${endpoint.hostname}`);
  return endpoint;
}

function boundExternalResult(value: unknown, maxChars: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length <= maxChars) return value;
  return {
    truncated: true,
    output: serialized.slice(0, maxChars),
  };
}

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

function validateSchema(
  schema: Record<string, unknown>,
  value: unknown,
  path = "arguments",
) {
  for (const keyword of [
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "patternProperties",
    "$ref",
  ])
    if (keyword in schema)
      throw new Error(`unsupported MCP input schema keyword: ${keyword}`);

  if ("const" in schema && !Object.is(schema.const, value))
    throw new Error(`${path} must equal the schema constant`);
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => Object.is(item, value))
  )
    throw new Error(`${path} is not an allowed value`);

  const expected = schema.type;
  if (expected === undefined) return;
  const actual = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;
  const validType =
    (expected === "integer" &&
      typeof value === "number" &&
      Number.isInteger(value)) ||
    expected === actual;
  if (!validType) throw new Error(`${path} must be a ${String(expected)}`);

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      throw new Error(`${path} is shorter than minLength`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      throw new Error(`${path} is longer than maxLength`);
    if (typeof schema.pattern === "string") {
      let pattern: RegExp;
      try {
        pattern = new RegExp(schema.pattern);
      } catch {
        throw new Error(`${path} has an invalid schema pattern`);
      }
      if (!pattern.test(value))
        throw new Error(`${path} does not match its required pattern`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new Error(`${path} is below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new Error(`${path} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      throw new Error(`${path} has too few items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      throw new Error(`${path} has too many items`);
    if (
      schema.items &&
      typeof schema.items === "object" &&
      !Array.isArray(schema.items)
    )
      value.forEach((item, index) =>
        validateSchema(
          schema.items as Record<string, unknown>,
          item,
          `${path}[${index}]`,
        ),
      );
    return;
  }
  if (expected !== "object") return;
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    if (typeof name === "string" && !(name in object))
      throw new Error(`missing required MCP argument: ${path}.${name}`);
  }
  const properties = schema.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  )
    return;
  const propertyRules = properties as Record<string, unknown>;
  if (schema.additionalProperties === false)
    for (const name of Object.keys(object))
      if (!(name in propertyRules))
        throw new Error(`${path}.${name} is not permitted`);
  for (const [name, rule] of Object.entries(propertyRules)) {
    if (!(name in object)) continue;
    if (!rule || typeof rule !== "object" || Array.isArray(rule))
      throw new Error(`${path}.${name} has an invalid schema`);
    validateSchema(
      rule as Record<string, unknown>,
      object[name],
      `${path}.${name}`,
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
    const httpEndpoint =
      config.transport === "streamable-http"
        ? validateHttpEndpoint(config)
        : undefined;
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
        : new StreamableHTTPClientTransport(httpEndpoint!, {
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
    if (!context?.permissionGranted)
      throw new Error(
        "MCP tool invocation requires central permission approval",
      );
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
            (timer = setTimeout(() => {
              void connection.transport.close();
              reject(new Error("MCP tool timeout"));
            }, connection.config.toolTimeoutMs)),
        ),
      ]);
      this.audit.push({
        at: new Date().toISOString(),
        serverId: record.serverId,
        tool: record.name,
        operation: "invoke",
        outcome: "completed",
      });
      return boundExternalResult(result, connection.config.maxOutputChars);
    } catch (error) {
      this.audit.push({
        at: new Date().toISOString(),
        serverId: record.serverId,
        tool: record.name,
        operation: "invoke",
        outcome: "failed",
        detail:
          error instanceof Error ? error.message : "MCP invocation failed",
      });
      throw error;
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
