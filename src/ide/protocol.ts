import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const IDE_PROTOCOL_VERSION = 1 as const;

export const IDEClientKindSchema = z.enum(["vscode", "jetbrains", "neovim"]);
export type IDEClientKind = z.infer<typeof IDEClientKindSchema>;

export const IDEHandshakeSchema = z
  .object({
    protocol: z.literal(IDE_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    clientId: z.string().min(1).max(100),
    clientKind: IDEClientKindSchema,
    clientVersion: z.string().min(1).max(100),
    authToken: z.string().min(16).max(512),
    capabilities: z.array(z.string().min(1).max(100)).max(50),
  })
  .strict();
export type IDEHandshake = z.infer<typeof IDEHandshakeSchema>;

export const IDERequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("register_workspace"),
      workspaceRoot: z.string().min(1).max(4_000),
      sessionId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("start_task"),
      workspaceId: z.string().uuid(),
      prompt: z.string().trim().min(1).max(20_000),
      activeFile: z.string().min(1).max(4_000).optional(),
      selection: z.string().max(50_000).optional(),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("cancel_task"),
      taskId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("resume_session"),
      sessionId: z.string().min(1).max(200),
      workspaceId: z.string().uuid(),
    })
    .strict(),
]);
export type IDERequest = z.infer<typeof IDERequestSchema>;

export const IDEEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("handshake_accepted"),
      serverVersion: z.string().min(1),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("progress"),
      taskId: z.string().min(1),
      stage: z.string().min(1).max(200),
      message: z.string().max(2_000),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("permission_request"),
      taskId: z.string().min(1),
      capability: z.string().min(1),
      target: z.string().min(1).max(4_000),
      explanation: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(IDE_PROTOCOL_VERSION),
      requestId: z.string().uuid(),
      type: z.literal("task_result"),
      taskId: z.string().min(1),
      status: z.enum(["completed", "failed", "cancelled", "blocked"]),
      summary: z.string().max(4_000),
    })
    .strict(),
]);
export type IDEEvent = z.infer<typeof IDEEventSchema>;

export function validateIDEHandshake(
  value: unknown,
  expectedAuthToken: string,
) {
  const handshake = IDEHandshakeSchema.parse(value);
  const actual = Buffer.from(handshake.authToken);
  const expected = Buffer.from(expectedAuthToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("IDE handshake authentication failed");
  return handshake;
}

export function parseIDERequest(value: unknown) {
  return IDERequestSchema.parse(value);
}

export function parseIDEEvent(value: unknown) {
  return IDEEventSchema.parse(value);
}
