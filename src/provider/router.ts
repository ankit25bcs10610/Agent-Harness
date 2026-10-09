import type { ModelRole, ModelRoute } from "./config";
import type { ModelInfo } from "./registry";

export type RoutingRequest = {
  role: ModelRole;
  complexity: "low" | "medium" | "high";
  requiresTools?: boolean;
  minimumContextWindow?: number;
  estimatedPromptTokens?: number;
  estimatedCompletionTokens?: number;
  preferredModel?: string;
  disallowedModels?: readonly string[];
  privacyAllowedProviders?: readonly string[];
  remainingBudgetMinor?: number;
};

export type RoutingPolicy = {
  routes: readonly ModelRoute[];
  modelCostsMinorPerMillionTokens?: Readonly<Record<string, number>>;
};

export type RoutingDecision = {
  model: string;
  provider: string;
  estimatedCostMinor: number | null;
  reasons: string[];
};

export function chooseModel(
  request: RoutingRequest,
  policy: RoutingPolicy,
  available: readonly ModelInfo[],
): RoutingDecision {
  const availableById = new Map(
    available.map((model) => [model.provider + "/" + model.id, model]),
  );
  const candidates = policy.routes.filter((route) => {
    const modelRef = route.provider + "/" + route.model;
    const model = availableById.get(modelRef);
    return (
      route.roles?.includes(request.role) === true &&
      model?.configured === true &&
      model.capabilitiesVerified !== false &&
      (!request.requiresTools || model.capabilities.toolCalling) &&
      (request.minimumContextWindow === undefined ||
        (model.capabilities.contextWindow ?? 0) >=
          request.minimumContextWindow) &&
      !request.disallowedModels?.includes(modelRef) &&
      (!request.privacyAllowedProviders ||
        request.privacyAllowedProviders.includes(route.provider))
    );
  });
  const ordered = request.preferredModel
    ? [
        ...candidates.filter(
          (candidate) =>
            candidate.provider + "/" + candidate.model ===
            request.preferredModel,
        ),
        ...candidates.filter(
          (candidate) =>
            candidate.provider + "/" + candidate.model !==
            request.preferredModel,
        ),
      ]
    : candidates;
  for (const route of ordered) {
    const modelRef = route.provider + "/" + route.model;
    const tokens =
      (request.estimatedPromptTokens ?? 0) +
      (request.estimatedCompletionTokens ?? 0);
    const rate = policy.modelCostsMinorPerMillionTokens?.[modelRef];
    const estimatedCostMinor =
      rate === undefined ? null : Math.ceil((tokens * rate) / 1_000_000);
    if (
      request.remainingBudgetMinor !== undefined &&
      estimatedCostMinor !== null &&
      estimatedCostMinor > request.remainingBudgetMinor
    )
      continue;
    return {
      model: route.model,
      provider: route.provider,
      estimatedCostMinor,
      reasons: [
        "role=" + request.role,
        "complexity=" + request.complexity,
        request.preferredModel === modelRef
          ? "preferred-model"
          : "policy-order",
      ],
    };
  }
  throw new Error("no configured model satisfies the routing policy");
}
