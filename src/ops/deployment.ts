import { z } from "zod";

export const DeploymentModeSchema = z.enum([
  "local_cli",
  "single_node_private",
  "customer_controlled_container",
  "private_kubernetes",
  "restricted_network",
  "air_gapped",
]);
export type DeploymentMode = z.infer<typeof DeploymentModeSchema>;

export const DeploymentStatusSchema = z.enum([
  "SUPPORTED",
  "EXPERIMENTAL",
  "NOT_IMPLEMENTED",
  "BLOCKED",
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

export const DeploymentCapabilitySchema = z.object({
  mode: DeploymentModeSchema,
  status: DeploymentStatusSchema,
  evidence: z.array(z.string()),
  blockers: z.array(z.string()),
});
export type DeploymentCapability = z.infer<typeof DeploymentCapabilitySchema>;

/**
 * Reports only capabilities implemented in this distribution. A mode is not
 * considered supported because a manifest or configuration flag exists.
 */
export function deploymentCapabilities(): DeploymentCapability[] {
  return [
    {
      mode: "local_cli",
      status: "SUPPORTED",
      evidence: ["The Bun CLI and local session/runtime tests are present."],
      blockers: [
        "Provider credentials and a supported model are still required for model-backed runs.",
      ],
    },
    {
      mode: "single_node_private",
      status: "NOT_IMPLEMENTED",
      evidence: [],
      blockers: [
        "No private control-plane or persistent service deployment is implemented.",
      ],
    },
    {
      mode: "customer_controlled_container",
      status: "NOT_IMPLEMENTED",
      evidence: [],
      blockers: [
        "No production container image, runner authentication, or resource policy is implemented.",
      ],
    },
    {
      mode: "private_kubernetes",
      status: "NOT_IMPLEMENTED",
      evidence: [],
      blockers: [
        "No Kubernetes manifests, probes, migrations, or upgrade/rollback controller is implemented.",
      ],
    },
    {
      mode: "restricted_network",
      status: "BLOCKED",
      evidence: [],
      blockers: [
        "The current provider integration uses OpenRouter and no enforceable egress policy is provided.",
      ],
    },
    {
      mode: "air_gapped",
      status: "BLOCKED",
      evidence: [],
      blockers: [
        "No local model/provider distribution or dependency-bundled air-gap artifact is provided.",
      ],
    },
  ].map((capability) => DeploymentCapabilitySchema.parse(capability));
}

export function assertDeploymentModeAllowed(mode: DeploymentMode): void {
  const capability = deploymentCapabilities().find(
    (entry) => entry.mode === mode,
  );
  if (!capability || capability.status !== "SUPPORTED") {
    const status = capability?.status ?? "NOT_IMPLEMENTED";
    const blockers =
      capability?.blockers.join(" ") ?? "Unknown deployment mode.";
    throw new Error(`deployment mode ${mode} is ${status}: ${blockers}`);
  }
}
