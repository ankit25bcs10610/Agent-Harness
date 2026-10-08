import { randomUUID } from "node:crypto";
import {
  AgentMessageSchema,
  type AgentMessage,
  type AgentMessageType,
} from "./types";

export type AgentBusHandler = (message: AgentMessage) => void | Promise<void>;

export class AgentCommunicationBus {
  private readonly messages = new Map<string, AgentMessage>();
  private readonly handlers = new Map<string, Set<AgentBusHandler>>();
  private readonly acknowledged = new Set<string>();

  constructor(
    private readonly persist?: (message: AgentMessage) => Promise<void>,
  ) {}

  restore(messages: readonly AgentMessage[]) {
    for (const value of messages) {
      const message = AgentMessageSchema.parse(value);
      if (this.messages.has(message.id)) continue;
      this.messages.set(message.id, message);
    }
  }

  async publish(input: {
    sourceAgent: string;
    destination: string;
    taskId: string;
    correlationId?: string;
    type: AgentMessageType;
    payload: Record<string, unknown>;
  }) {
    const message = AgentMessageSchema.parse({
      id: randomUUID(),
      ...input,
      correlationId: input.correlationId ?? randomUUID(),
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
    });
    if (this.messages.has(message.id)) return message;
    this.messages.set(message.id, message);
    await this.persist?.(message);
    const subscribers = [
      ...(this.handlers.get(message.destination) ?? []),
      ...(this.handlers.get("*") ?? []),
    ];
    await Promise.all(subscribers.map((handler) => handler(message)));
    return message;
  }

  subscribe(destination: string, handler: AgentBusHandler) {
    const handlers =
      this.handlers.get(destination) ?? new Set<AgentBusHandler>();
    handlers.add(handler);
    this.handlers.set(destination, handlers);
    return () => handlers.delete(handler);
  }

  acknowledge(messageId: string) {
    if (!this.messages.has(messageId))
      throw new Error(`message not found: ${messageId}`);
    this.acknowledged.add(messageId);
  }

  get(messageId: string) {
    return this.messages.get(messageId);
  }

  list(taskId?: string) {
    return [...this.messages.values()].filter(
      (message) => !taskId || message.taskId === taskId,
    );
  }

  isAcknowledged(messageId: string) {
    return this.acknowledged.has(messageId);
  }
}
