import { z } from "zod";

export const UatStatusSchema = z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]);
export type UatStatus = z.infer<typeof UatStatusSchema>;
export const UatScenarioSchema = z.object({
  scenarioId: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  expectedBehaviors: z.array(z.string().min(1)).min(1),
  requirements: z.array(z.string()),
});
export type UatScenario = z.infer<typeof UatScenarioSchema>;
export const UatRecordSchema = z.object({
  recordId: z.string().uuid(),
  scenarioId: z.string().min(1),
  scenarioVersion: z.string().min(1),
  status: UatStatusSchema,
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  environment: z.object({
    runtime: z.string(),
    platform: z.string(),
    workspace: z.string(),
  }),
  evidence: z.array(z.string()),
  failure: z.string().optional(),
  sessionId: z.string().optional(),
  releaseCandidate: z.string().optional(),
});
export type UatRecord = z.infer<typeof UatRecordSchema>;
