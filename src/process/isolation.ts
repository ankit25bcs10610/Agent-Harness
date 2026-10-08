import type {
  IsolationBackend,
  ProcessRequest,
  PreparedProcess,
} from "./types";

/**
 * No isolation backend is enabled by default. Requesting one that has not been
 * registered fails closed instead of silently running without isolation.
 */
export class IsolationRegistry {
  private readonly backends = new Map<string, IsolationBackend>();

  register(backend: IsolationBackend): void {
    this.backends.set(backend.name, backend);
  }

  async prepare(request: ProcessRequest): Promise<PreparedProcess> {
    if (!request.isolation) return {};
    const backend = this.backends.get(request.isolation.backend);
    if (!backend) {
      throw new Error(
        `Isolation backend unavailable: ${request.isolation.backend}`,
      );
    }
    return backend.prepare(request);
  }
}

export const isolationRegistry = new IsolationRegistry();
