import { registerExternalTools } from "../tool/registry";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpClientConnection } from "./client";
import { McpServerConfigSchema, type McpServerConfig } from "./types";

export class McpClientManager {
  private readonly connections = new Map<string, McpClientConnection>();

  async connect(config: McpServerConfig, signal?: AbortSignal) {
    const parsed = McpServerConfigSchema.parse(config);
    if (this.connections.has(parsed.id))
      throw new Error(`MCP server already connected: ${parsed.id}`);
    const connection = await new McpClientConnection(parsed).connect(signal);
    const tools = await connection.discoverTools();
    registerExternalTools(connection.tools());
    this.connections.set(parsed.id, connection);
    return { server: parsed, tools };
  }

  get(serverId: string) {
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(`MCP server not connected: ${serverId}`);
    return connection;
  }

  list() {
    return [...this.connections.entries()].map(([id, connection]) => ({
      id,
      tools: connection.tools().map((tool) => tool.name),
      audit: connection.audit,
    }));
  }

  configs() {
    return [...this.connections.values()].map(({ config }) => ({
      id: config.id,
      transport: config.transport,
      ...(config.command ? { command: config.command } : {}),
      args: config.args,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      ...(config.url ? { url: config.url } : {}),
      enabled: config.enabled,
      allowedTools: config.allowedTools,
    }));
  }

  async disconnect(serverId: string) {
    const connection = this.get(serverId);
    await connection.close();
    this.connections.delete(serverId);
  }

  async close() {
    for (const id of [...this.connections.keys()]) await this.disconnect(id);
  }

  async loadConfigured(path = join(process.cwd(), ".chiku", "mcp.json")) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as {
        servers?: unknown;
      };
      if (!Array.isArray(parsed.servers))
        throw new Error("mcp.json requires a servers array");
      return parsed.servers.map((server) =>
        McpServerConfigSchema.parse(server),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
  }
}
