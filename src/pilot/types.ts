import { z } from "zod";

export const PilotRequestStatusSchema = z.enum([
  "REQUESTED",
  "QUALIFICATION",
  "SECURITY_REVIEW",
  "APPROVED",
  "ONBOARDING",
  "ACTIVE",
  "COMPLETED",
  "PAUSED",
  "REJECTED",
]);
export type PilotRequestStatus = z.infer<typeof PilotRequestStatusSchema>;
export const PilotRequestSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  organizationId: z.string().min(1),
  requestedBy: z.string().min(1),
  status: PilotRequestStatusSchema,
  approvedRepositories: z.array(z.string()),
  approvedModels: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PilotRequest = z.infer<typeof PilotRequestSchema>;

export const PilotStatusSchema = z.enum([
  "draft",
  "authorized",
  "active",
  "paused",
  "closed",
]);
export type PilotStatus = z.infer<typeof PilotStatusSchema>;
export const PilotResultSchema = z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]);
export const PilotEvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  evaluationId: z.string().uuid(),
  organizationId: z.string().min(1),
  authorizedContact: z.string().email().optional(),
  productVersion: z.string().min(1),
  status: PilotStatusSchema,
  requirements: z.array(z.string()),
  supportedModels: z.array(z.string()),
  authorizedRepositories: z.array(z.string()),
  taskIds: z.array(z.string()),
  verification: z.array(
    z.object({
      taskId: z.string(),
      result: PilotResultSchema,
      evidence: z.array(z.string()),
    }),
  ),
  issueIds: z.array(z.string()),
  costs: z.object({
    providerCents: z.number().nonnegative().nullable(),
    softwareCents: z.number().nonnegative().nullable(),
    status: z.enum(["measured", "estimated", "unknown"]),
  }),
  feedbackDraftIds: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PilotEvaluation = z.infer<typeof PilotEvaluationSchema>;
