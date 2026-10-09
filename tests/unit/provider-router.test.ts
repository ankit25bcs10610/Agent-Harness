import { expect, test } from "bun:test";
import { chooseModel } from "../../src/provider";

const models = [
  {
    provider: "openrouter",
    id: "cheap",
    configured: true,
    capabilities: {
      contextWindow: 16_000,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      structuredOutput: true,
    },
  },
  {
    provider: "openrouter",
    id: "strong",
    configured: true,
    capabilities: {
      contextWindow: 128_000,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      structuredOutput: true,
    },
  },
];

test("router selects a configured capable model and records a bounded cost estimate", () => {
  const decision = chooseModel(
    {
      role: "coding",
      complexity: "high",
      requiresTools: true,
      minimumContextWindow: 64_000,
      estimatedPromptTokens: 100_000,
      estimatedCompletionTokens: 10_000,
      preferredModel: "openrouter/strong",
    },
    {
      routes: [
        { provider: "openrouter", model: "cheap", roles: ["coding"] },
        { provider: "openrouter", model: "strong", roles: ["coding"] },
      ],
      modelCostsMinorPerMillionTokens: { "openrouter/strong": 500 },
    },
    models,
  );
  expect(decision.model).toBe("strong");
  expect(decision.estimatedCostMinor).toBe(55);
  expect(decision.reasons).toContain("preferred-model");
});

test("router fails closed for disallowed, private-policy, and over-budget models", () => {
  expect(() =>
    chooseModel(
      {
        role: "coding",
        complexity: "medium",
        disallowedModels: ["openrouter/strong"],
        privacyAllowedProviders: ["local"],
      },
      {
        routes: [
          { provider: "openrouter", model: "strong", roles: ["coding"] },
        ],
      },
      models,
    ),
  ).toThrow("no configured model");
  expect(() =>
    chooseModel(
      {
        role: "coding",
        complexity: "medium",
        remainingBudgetMinor: 1,
        estimatedPromptTokens: 100_000,
        estimatedCompletionTokens: 10_000,
      },
      {
        routes: [
          { provider: "openrouter", model: "strong", roles: ["coding"] },
        ],
        modelCostsMinorPerMillionTokens: { "openrouter/strong": 500 },
      },
      models,
    ),
  ).toThrow("no configured model");
});
