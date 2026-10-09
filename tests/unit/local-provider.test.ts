import { expect, test } from "bun:test";
import {
  createLocalProviderAdapter,
  detectHardware,
  inspectLocalEndpoint,
} from "../../src/provider/local";
import { chooseModel } from "../../src/provider/router";

test("hardware detection is conservative and does not claim GPU support", () => {
  const profile = detectHardware();
  expect(profile.cpuCount).toBeGreaterThan(0);
  expect(profile.totalMemoryBytes).toBeGreaterThan(0);
  expect(profile.gpu).toBe("unknown");
  expect(profile.acceleration).toBe("unknown");
});

test("offline local policy permits loopback and rejects remote endpoints", () => {
  expect(
    inspectLocalEndpoint({
      baseUrl: "http://127.0.0.1:11434/v1",
      offline: true,
    }).allowed,
  ).toBe(true);
  expect(
    inspectLocalEndpoint({
      baseUrl: "http://192.0.2.10/v1",
      offline: true,
    }).allowed,
  ).toBe(false);
  expect(
    inspectLocalEndpoint({
      baseUrl: "https://192.0.2.10/v1",
      allowRemote: true,
      privateEndpointConsent: true,
    }).allowed,
  ).toBe(true);
  expect(
    inspectLocalEndpoint({
      baseUrl: "http://user:secret@127.0.0.1:11434/v1",
    }).allowed,
  ).toBe(false);
});

test("local discovery keeps unverified capabilities unroutable", async () => {
  const adapter = createLocalProviderAdapter({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  });
  const models = await adapter.listModels();
  expect(models[0]?.configured).toBe(false);
  expect(models[0]?.capabilitiesVerified).toBe(false);
  expect(() =>
    chooseModel(
      { role: "coding", complexity: "medium" },
      {
        routes: [
          { provider: "local", model: "local-model", roles: ["coding"] },
        ],
      },
      models,
    ),
  ).toThrow("no configured model");
});

test("local completion uses injected transport and preserves missing usage as incomplete", async () => {
  let authorization = "";
  const adapter = createLocalProviderAdapter({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-local-key",
    fetchImpl: (async (
      _input: string | URL | Request,
      init: RequestInit | undefined,
    ) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
  });
  const result = await adapter.complete(
    [{ type: "user", content: "hi" }],
    [],
    new AbortController().signal,
    "local-model",
  );
  expect(result.message.content).toBe("hello");
  expect(result.stats.usageComplete).toBe(false);
  expect(authorization).toBe("Bearer test-local-key");
});

test("local streaming reassembles SSE chunks and propagates cancellation", async () => {
  const adapter = createLocalProviderAdapter({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: (async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n',
          "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch,
  });
  const chunks: string[] = [];
  const result = await adapter.completeStream!(
    [{ type: "user", content: "hi" }],
    [],
    new AbortController().signal,
    "local-model",
    { onText: (chunk) => chunks.push(chunk) },
  );
  expect(chunks.join("")).toBe("hello");
  expect(result.message.content).toBe("hello");
  expect(result.finishReason).toBe("stop");

  const controller = new AbortController();
  controller.abort();
  await expect(
    adapter.completeStream!(
      [{ type: "user", content: "hi" }],
      [],
      controller.signal,
      "local-model",
    ),
  ).rejects.toThrow("aborted");
});
