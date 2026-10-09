import { z } from "zod";

export const McpServerConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  transport: z.enum(["stdio", "streamable-http"]),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).max(50).default([]),
  cwd: z.string().min(1).optional(),
  url: z.string().url().optional(),
  allowedHosts: z.array(z.string().min(1)).max(50).default([]),
  environment: z.record(z.string(), z.string()).default({}),
  authEnvironmentVariable: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).default(10_000),
  toolTimeoutMs: z.number().int().positive().max(300_000).default(60_000),
  maxOutputChars: z.number().int().positive().max(1_000_000).default(20_000),
  enabled: z.boolean().default(true),
  allowedTools: z.array(z.string().min(1)).default([]),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export type McpToolRecord = {
  serverId: string;
  name: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffect: "read" | "write" | "destructive" | "unknown";
};

export type McpAuditEvent = {
  at: string;
  serverId: string;
  tool?: string;
  operation: "connect" | "discover" | "invoke" | "resource" | "prompt";
  outcome: "started" | "allowed" | "denied" | "completed" | "failed";
  detail?: string;
};
