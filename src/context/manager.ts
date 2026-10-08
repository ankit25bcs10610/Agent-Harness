import type { AgentMessage } from "../provider";
import type {
  ContextDiagnostics,
  ContextMemory,
  ContextPolicy,
  ContextState,
} from "./types";

const SENSITIVE =
  /(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|\.env|id_rsa|private key)/i;
const estimate = (message: AgentMessage) => {
  const toolCalls =
    message.type === "assistant"
      ? (message.toolCalls
          ?.map((call) => `${call.name} ${call.arguments}`)
          .join(" ") ?? "")
      : "";
  return Math.ceil(((message.content ?? "") + toolCalls).length / 4);
};
const terms = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((term) => term.length > 2),
  );

type Group = { messages: AgentMessage[]; score: number; recent: boolean };

export class ContextManager {
  private raw: AgentMessage[] = [];
  private memories: ContextMemory[];
  private invalidatedPaths: Set<string>;
  private compactionCount: number;
  private last: ContextDiagnostics;

  constructor(
    private readonly policy: ContextPolicy,
    state?: ContextState,
  ) {
    this.memories = (state?.memories ?? []).filter(
      (memory) => !memory.invalidatedBy,
    );
    this.invalidatedPaths = new Set(state?.invalidatedPaths ?? []);
    this.compactionCount = state?.compactionCount ?? 0;
    this.last = {
      estimatedTokens: 0,
      budgetTokens: 0,
      retainedMessages: 0,
      rawMessages: 0,
      prunedMessages: 0,
      memoryEntries: this.memories.length,
      compactionCount: this.compactionCount,
      usageRatio: 0,
    };
  }

  ingest(messages: AgentMessage[]): void {
    this.raw = [...messages];
    messages.forEach((message, index) => {
      if (message.type === "user" && message.content) {
        this.addMemory("requirement", message.content, [index]);
      }
    });
  }
  addMemory(
    kind: ContextMemory["kind"],
    text: string,
    sourceIndexes: number[] = [],
  ): void {
    if (SENSITIVE.test(text)) return;
    const normalized = text.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    this.memories = this.memories.filter(
      (memory) => memory.text.toLowerCase() !== key,
    );
    this.memories.unshift({
      id: `${kind}:${key.slice(0, 80)}`,
      kind,
      text: normalized,
      sourceIndexes,
    });
    this.memories = this.memories.slice(0, this.policy.maxMemoryEntries);
  }
  invalidatePath(path: string): void {
    this.invalidatedPaths.add(path);
    this.memories = this.memories
      .map((memory) => ({
        ...memory,
        ...(memory.text.includes(path) ? { invalidatedBy: path } : {}),
      }))
      .filter((memory) => !memory.invalidatedBy);
  }
  markCompacted(): void {
    this.compactionCount++;
    this.last = { ...this.last, compactionCount: this.compactionCount };
  }
  state(): ContextState {
    return {
      memories: this.memories,
      invalidatedPaths: [...this.invalidatedPaths],
      compactionCount: this.compactionCount,
    };
  }
  memoryFor(task: string): ContextMemory[] {
    const taskTerms = terms(task);
    return this.memories.filter(
      (memory) =>
        [...terms(memory.text)].some((term) => taskTerms.has(term)) &&
        !memory.invalidatedBy,
    );
  }

  memoryMessage(task: string): AgentMessage | undefined {
    const relevant = this.memoryFor(task).slice(
      0,
      this.policy.maxMemoryEntries,
    );
    if (!relevant.length) return undefined;
    return {
      type: "system",
      content: `Persistent task context:\n${relevant.map((memory) => `- [${memory.kind}] ${memory.text}`).join("\n")}`,
    };
  }

  buildWindow(messages: AgentMessage[], task = ""): AgentMessage[] {
    const selected = this.select(
      messages.filter(
        (message) =>
          !(
            message.type === "system" &&
            message.content?.startsWith("Persistent task context:")
          ),
      ),
      task,
    );
    const memory = this.memoryMessage(task);
    return memory ? [memory, ...selected] : selected;
  }

  select(messages: AgentMessage[], task = ""): AgentMessage[] {
    this.ingest(messages);
    const budgetTokens = Math.max(
      1,
      Math.floor(this.policy.contextWindow * this.policy.activeRatio),
    );
    const taskTerms = terms(task);
    const groups: Group[] = [];
    for (let index = 0; index < messages.length;) {
      const message = messages[index]!;
      const group: AgentMessage[] = [message];
      index++;
      if (message.type === "assistant" && message.toolCalls?.length) {
        const ids = new Set(message.toolCalls.map((call) => call.toolCallId));
        while (index < messages.length) {
          const next = messages[index];
          if (next?.type !== "tool" || !ids.has(next.toolCallId)) break;
          group.push(next);
          index++;
        }
      }
      const text = group
        .map(
          (item) =>
            `${item.content ?? ""} ${item.type === "assistant" ? (item.toolCalls?.map((call) => `${call.name} ${call.arguments}`).join(" ") ?? "") : ""}`,
        )
        .join(" ");
      const relevance = [...terms(text)].filter((term) =>
        taskTerms.has(term),
      ).length;
      groups.push({
        messages: group,
        score:
          relevance +
          (index > messages.length - this.policy.recentTurns ? 2 : 0),
        recent: index > messages.length - this.policy.recentTurns,
      });
    }
    const selected: Group[] = [];
    let used = 0;
    for (const group of [...groups].sort((a, b) => b.score - a.score)) {
      const cost = group.messages.reduce(
        (total, message) => total + estimate(message),
        0,
      );
      if (
        used + cost <= budgetTokens ||
        group.recent ||
        selected.length === 0
      ) {
        selected.push(group);
        used += cost;
      }
    }
    const ordered = groups
      .filter((group) => selected.includes(group))
      .flatMap((group) => group.messages);
    this.last = {
      estimatedTokens: used,
      budgetTokens,
      retainedMessages: ordered.length,
      rawMessages: messages.length,
      prunedMessages: messages.length - ordered.length,
      memoryEntries: this.memories.length,
      compactionCount: this.compactionCount,
      usageRatio: used / budgetTokens,
    };
    return ordered;
  }
  diagnostics(): ContextDiagnostics {
    return this.last;
  }
}
