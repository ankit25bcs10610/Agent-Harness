export type ModelRole =
  "coding" | "reasoning" | "summarization" | "review" | "classification";
export type ModelRoute = {
  provider: string;
  model: string;
  roles?: ModelRole[];
  fallback?: string[];
};
export type ProviderHealth = {
  provider: string;
  successes: number;
  failures: number;
  lastFailureAt?: number;
  latencyMs?: number;
};
export type UsageRecord = {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  at: number;
};

export function modelForRole(
  routes: ModelRoute[],
  role: ModelRole,
): ModelRoute | undefined {
  return routes.find((route) => route.roles?.includes(role));
}

export class ProviderHealthStore {
  private readonly values = new Map<string, ProviderHealth>();
  record(
    provider: string,
    success: boolean,
    latencyMs: number,
  ): ProviderHealth {
    const current = this.values.get(provider) ?? {
      provider,
      successes: 0,
      failures: 0,
    };
    const next = {
      ...current,
      ...(success
        ? { successes: current.successes + 1 }
        : { failures: current.failures + 1, lastFailureAt: Date.now() }),
      latencyMs,
    };
    this.values.set(provider, next);
    return next;
  }
  list(): ProviderHealth[] {
    return [...this.values.values()];
  }
}

export function credentialFor(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const key = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  return env[key] ?? (provider === "ollama" ? env.OLLAMA_HOST : undefined);
}
