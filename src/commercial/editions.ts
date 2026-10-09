import { z } from "zod";

export const EditionIdSchema = z.enum(["developer", "team"]);
export const EditionSchema = z.object({
  id: EditionIdSchema,
  name: z.string().min(1),
  availability: z.enum(["available", "not_available"]),
  capabilities: z.array(z.string().min(1)),
  deployment: z.enum(["local", "hosted_backend_required"]),
  providerCostResponsibility: z.enum(["user", "organization", "unknown"]),
  support: z.enum(["community", "not_defined"]),
  limitations: z.array(z.string()),
});
export type Edition = z.infer<typeof EditionSchema>;

export const EDITIONS: readonly Edition[] = [
  EditionSchema.parse({
    id: "developer",
    name: "Developer Edition",
    availability: "available",
    capabilities: [
      "terminal_agent",
      "repository_tools",
      "permission_aware_execution",
      "local_sessions",
      "verification_workflows",
    ],
    deployment: "local",
    providerCostResponsibility: "user",
    support: "community",
    limitations: [
      "OpenRouter is the verified provider path",
      "No hosted team account is required or included",
    ],
  }),
  EditionSchema.parse({
    id: "team",
    name: "Team Edition",
    availability: "not_available",
    capabilities: [
      "organization_policies",
      "team_audit_metadata",
      "team_usage_reporting",
    ],
    deployment: "hosted_backend_required",
    providerCostResponsibility: "unknown",
    support: "not_defined",
    limitations: [
      "No production backend, authentication service, billing, or subscription plans are provided in this repository",
    ],
  }),
];

export function edition(id: Edition["id"]) {
  return EDITIONS.find((entry) => entry.id === id)!;
}
