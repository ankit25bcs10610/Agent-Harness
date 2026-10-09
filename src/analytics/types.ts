import { z } from "zod";

export const AnalyticsEventNameSchema = z.enum([
  "installation_verified",
  "first_launch",
  "onboarding_started",
  "onboarding_completed",
  "coding_task_attempted",
  "coding_task_verified",
  "task_failed",
  "session_resumed",
  "provider_configuration_error",
  "crash_recorded",
  "feedback_submitted",
  "upgrade_completed",
]);

export const AnalyticsEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  name: AnalyticsEventNameSchema,
  occurredAt: z.string().datetime({ offset: true }),
  installationId: z.string().uuid(),
  productVersion: z.string().min(1),
  /** Test fixtures are never eligible for product adoption reports. */
  origin: z.enum(["product", "synthetic"]).default("product"),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsConsentSchema = z.object({
  schemaVersion: z.literal(1),
  analyticsOptIn: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AnalyticsConsent = z.infer<typeof AnalyticsConsentSchema>;

export const AnalyticsExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  consent: AnalyticsConsentSchema,
  events: z.array(AnalyticsEventSchema),
});
export type AnalyticsExport = z.infer<typeof AnalyticsExportSchema>;
