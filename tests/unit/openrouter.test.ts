import { expect, test } from "bun:test";
import { createOpenRouterAdapter } from "../../src/provider/openrouter";

test("OpenRouter discovery returns only provider-grounded model capabilities", async () => {
  const adapter = createOpenRouterAdapter({
    apiKey: "test-only",
    fetchImpl: async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-only",
      );
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-test",
              name: "GPT Test",
              context_length: 128000,
              top_provider: { max_completion_tokens: 4096 },
              supported_parameters: ["tools", "response_format"],
            },
            { name: "invalid-without-id" },
          ],
        }),
        { status: 200 },
      );
    },
  });

  await expect(adapter.listModels()).resolves.toEqual([
    {
      provider: "openrouter",
      id: "openai/gpt-test",
      name: "GPT Test",
      capabilities: {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        streaming: true,
        toolCalling: true,
        reasoning: false,
        structuredOutput: true,
      },
      configured: true,
      capabilitiesVerified: true,
    },
  ]);
});

test("OpenRouter discovery rejects malformed responses", async () => {
  const adapter = createOpenRouterAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ data: "invalid" })),
  });
  await expect(adapter.listModels()).rejects.toThrow("malformed data");
});
