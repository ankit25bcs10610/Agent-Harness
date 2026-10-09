import { z } from "zod";

export const ReliabilityInvariantSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  passed: z.boolean(),
  evidence: z.array(z.string().min(1)).max(20),
});
export type ReliabilityInvariant = z.infer<typeof ReliabilityInvariantSchema>;

export class InvariantChecker {
  private readonly results: ReliabilityInvariant[] = [];

  check(input: ReliabilityInvariant) {
    const result = ReliabilityInvariantSchema.parse(input);
    this.results.push(result);
    return result;
  }

  all() {
    return [...this.results];
  }

  failures() {
    return this.results.filter((result) => !result.passed);
  }

  passed() {
    return this.results.length > 0 && this.failures().length === 0;
  }
}
