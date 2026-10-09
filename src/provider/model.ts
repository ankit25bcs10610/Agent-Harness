const PROVIDER_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { value: number; expiresAt: number }>();

export function clearContextWindowCache(): void {
  cache.clear();
}

// OpenRouter's public model list
export async function getContextWindow(
  model: string,
  fallback: number,
): Promise<number> {
  if (model.startsWith("local/") || process.env.CHIKU_PROVIDER === "local")
    return fallback;
  const cached = cache.get(model);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const res = await fetch(PROVIDER_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as {
      data: { id: string; context_length?: number | null }[];
    };
    const found = body.data.find((m) => m.id === model);
    const value = found?.context_length ?? fallback;
    cache.set(model, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return fallback; // offline or timeout
  }
}
