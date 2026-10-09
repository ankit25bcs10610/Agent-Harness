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

export const AnalyticsPropertiesSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .superRefine((properties, context) => {
    if (Object.keys(properties).length > 20) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "analytics events support at most 20 properties",
      });
    }
    for (const [key, value] of Object.entries(properties)) {
      if (key.length > 64) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "analytics property names are too long",
        });
      }
      if (typeof value === "string" && value.length > 256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "analytics property values are too long",
        });
      }
    }
  });

export const AnalyticsEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  name: AnalyticsEventNameSchema,
  occurredAt: z.string().datetime({ offset: true }),
  installationId: z.string().uuid(),
  productVersion: z.string().min(1),
  /** Test fixtures are never eligible for product adoption reports. */
  origin: z.enum(["product", "synthetic"]).default("product"),
  properties: AnalyticsPropertiesSchema,
});
export type AnalyticsEvent = Omit<
  z.infer<typeof AnalyticsEventSchema>,
  "origin"
> & { origin?: "product" | "synthetic" };

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
