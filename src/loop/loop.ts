import { compact } from "../context/compact";
import type { AgentMessage } from "../provider";
import { generateToolsArray } from "../tool";
import { dispatchTool } from "./dispatch";
import type { ToolContext } from "../tool/types";
import { ContextManager } from "../context/manager";
import type {
  AgentEvent,
  ExecutionStats,
  LifecycleState,
  LoopInput,
  LoopOutput,
  StopReason,
} from "./types";

function buildMsgView(
  summary: AgentMessage,
  summarizedUpTo: number,
  messages: AgentMessage[],
) {
  return [summary, ...messages.slice(summarizedUpTo + 1)];
}

const INTERRUPT_NOTE: AgentMessage = {
  type: "user",
  content: "[Request interrupted by user]",
};

export async function runLoop(input: LoopInput): Promise<LoopOutput> {
  const ctx: ToolContext = input.ctx;
  const cfg = input.config;
  const startedAt = Date.now();
  const messages = [...(input.state?.messages ?? []), ...input.messages];
  let lastMessageView = [...(input.state?.view ?? []), ...input.messages];
  let previousSummary: AgentMessage = input.state?.summary ?? {
    type: "assistant",
    content: "",
  };
  let previousSummarizedUpTo = input.state?.summarizedUpTo ?? -1;
  let lastPromptTokens = input.state?.lastPromptTokens ?? 0;
  let iterations = 0;
  let tokensUsed = 0;
  let modelRequests = 0;
  let toolCalls = 0;
  let usageIncomplete = false;
  let lifecycle: LifecycleState = "initializing";
  const contextManager = new ContextManager(
    {
      contextWindow: cfg.contextWindow,
      activeRatio: cfg.contextActiveRatio ?? 0.75,
      recentTurns: cfg.recentContextTurns ?? 6,
      maxMemoryEntries: cfg.maxMemoryEntries ?? 100,
    },
    input.state?.context,
  );

  const emit = (event: AgentEvent) => input.events?.onEvent?.(event);
  const setLifecycle = (state: LifecycleState) => {
    lifecycle = state;
    emit({ type: "lifecycle", state, at: Date.now() });
  };
  const overWallClock = () =>
    cfg.wallClockMs !== undefined && Date.now() - startedAt >= cfg.wallClockMs;
  const execution = (): ExecutionStats => ({
    startedAt,
    durationMs: Date.now() - startedAt,
    modelRequests,
    toolCalls,
    tokensUsed,
    usageIncomplete,
  });
  const currentState = () => ({
    messages,
    view: lastMessageView,
    summary: previousSummary,
    summarizedUpTo: previousSummarizedUpTo,
    lastPromptTokens,
    execution: execution(),
    context: contextManager.state(),
    ...(input.skills ? { skills: input.skills.state() } : {}),
  });
  let verificationReport;

  const finish = async (stopReason: StopReason): Promise<LoopOutput> => {
    verificationReport = await input.workflow?.finalize(stopReason, ctx.signal);
    const finalReason: StopReason =
      verificationReport && stopReason === "stop" && !verificationReport.passed
        ? "verification_failed"
        : stopReason;
    if (finalReason === "interrupted") {
      setLifecycle("cancellation");
      messages.push(INTERRUPT_NOTE);
      lastMessageView.push(INTERRUPT_NOTE);
    } else if (
      [
        "provider_failure",
        "malformed_response",
        "tool_failure",
        "verification_failed",
      ].includes(finalReason)
    )
      setLifecycle("failure");
    else setLifecycle("completion");
    const state = currentState();
    if (input.checkpoint) {
      await input.checkpoint(state);
      emit({ type: "checkpoint", at: Date.now() });
    }
    emit({ type: "stopped", reason: finalReason, at: Date.now() });
    return {
      messages,
      stopReason: finalReason,
      iterations,
      lastPromptTokens,
      tokensUsed,
      lastMessageView,
      state,
      execution: execution(),
      ...(verificationReport ? { verification: verificationReport } : {}),
      context: contextManager.diagnostics(),
    };
  };

  try {
    const dispatchEvents = {
      ...input.events,
      onPermissionWaiting: () => {
        setLifecycle("permission_waiting");
        input.events?.onPermissionWaiting?.();
      },
    };
    setLifecycle("reasoning");
    while (true) {
      if (ctx.signal.aborted) return finish("interrupted");
      if (overWallClock()) return finish("wall_clock");
      if (iterations >= cfg.maxIterations) return finish("max_iterations");
      if (tokensUsed >= cfg.maxTokens) return finish("max_tokens");
      if (lastPromptTokens >= cfg.contextWindow * cfg.compactionRatio) {
        try {
          const summaryResult = await compact(
            previousSummary,
            previousSummarizedUpTo,
            messages,
            ctx.signal,
            cfg.compactionModel,
            cfg.transcriptCapChars,
            input.complete,
          );
          if (summaryResult) {
            const [summary, summarizedUpTo, compactionTokensUsed] =
              summaryResult;
            lastMessageView = buildMsgView(summary, summarizedUpTo, messages);
            previousSummary = summary;
            previousSummarizedUpTo = summarizedUpTo;
            contextManager.markCompacted();
            tokensUsed += compactionTokensUsed;
            if (tokensUsed >= cfg.maxTokens) return finish("max_tokens");
          }
        } catch (error) {
          if (ctx.signal.aborted) return finish("interrupted");
          // Deterministic selection remains available when model-assisted compaction fails.
          lastMessageView = contextManager.select(
            lastMessageView,
            input.messages.map((message) => message.content ?? "").join(" "),
          );
        }
      }
      lastMessageView = contextManager.buildWindow(
        lastMessageView,
        input.messages.map((message) => message.content ?? "").join(" "),
      );
      if (overWallClock()) return finish("wall_clock");
      setLifecycle("reasoning");
      modelRequests++;
      emit({
        type: "model_request",
        model: cfg.loopModel,
        attempt: modelRequests,
        at: Date.now(),
      });
      let completion;
      const modelSpan = input.performance?.start("model.request", {
        model: cfg.loopModel,
        attempt: modelRequests,
      });
      try {
        completion = await input.complete(
          [input.systemPrompt, ...lastMessageView],
          generateToolsArray(),
          ctx.signal,
          cfg.loopModel,
          input.events,
        );
      } catch (error) {
        modelSpan?.end(ctx.signal.aborted ? "cancelled" : "error");
        if (ctx.signal.aborted) return finish("interrupted");
        const code =
          typeof error === "object" && error && "code" in error
            ? error.code
            : undefined;
        return finish(
          code === "malformed_response" || code === "incomplete_response"
            ? "malformed_response"
            : "provider_failure",
        );
      }
      modelSpan?.end("ok", { totalTokens: completion.stats.totalTokens });
      tokensUsed += completion.stats.totalTokens;
      lastPromptTokens = completion.stats.promptTokens;
      usageIncomplete ||= completion.stats.usageComplete === false;
      emit({
        type: "model_response",
        totalTokens: completion.stats.totalTokens,
        at: Date.now(),
      });
      messages.push(completion.message);
      lastMessageView.push(completion.message);
      if (tokensUsed >= cfg.maxTokens) return finish("max_tokens");
      if (overWallClock()) return finish("wall_clock");
      if (completion.finishReason === "tool_calls") {
        const calls = completion.message.toolCalls;
        if (!calls?.length) return finish("malformed_response");
        setLifecycle("tool_dispatch");
        toolCalls += calls.length;
        for (const call of calls) {
          emit({ type: "tool_call", call, at: Date.now() });
          input.workflow?.recordToolCall(call);
        }
        setLifecycle("execution");
        const toolSpan = input.performance?.start("tool.dispatch", {
          toolCount: calls.length,
        });
        let results;
        try {
          results = await dispatchTool(calls, ctx, dispatchEvents);
          toolSpan?.end("ok", { resultCount: results.length });
        } catch (error) {
          toolSpan?.end(ctx.signal.aborted ? "cancelled" : "error");
          throw error;
        }
        setLifecycle("verification");
        for (const result of results) {
          messages.push(result);
          lastMessageView.push(result);
          const call = calls.find(
            (item) => item.toolCallId === result.toolCallId,
          );
          if (call)
            emit({
              type: "tool_result",
              call,
              result: result.content,
              at: Date.now(),
            });
        }
        if (input.checkpoint) {
          await input.checkpoint(currentState());
          emit({ type: "checkpoint", at: Date.now() });
        }
        if (ctx.signal.aborted) return finish("interrupted");
        if (overWallClock()) return finish("wall_clock");
        iterations++;
        continue;
      }
      if (completion.finishReason === "error")
        return finish("provider_failure");
      if (completion.finishReason === "stop") return finish("stop");
      if (completion.finishReason === "length") return finish("length");
      if (completion.finishReason === "content_filter")
        return finish("content_filter");
      return finish("malformed_response");
    }
  } catch (error) {
    if (ctx.signal.aborted) return finish("interrupted");
    return finish("tool_failure");
  } finally {
    void lifecycle;
  }
}
