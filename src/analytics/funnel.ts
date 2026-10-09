import type { AnalyticsEvent } from "./types";

export type FunnelCounts = {
  eligibleInstallations: number;
  firstLaunches: number;
  setupCompletions: number;
  firstTaskAttempts: number;
  verifiedFirstTasks: number;
};

export function activationFunnel(
  events: readonly AnalyticsEvent[],
): FunnelCounts {
  const installations = new Set<string>();
  const launches = new Set<string>();
  const setups = new Set<string>();
  const attempts = new Set<string>();
  const verified = new Set<string>();
  for (const event of events) {
    if (event.name === "installation_verified")
      installations.add(event.installationId);
    if (event.name === "first_launch") launches.add(event.installationId);
    if (event.name === "onboarding_completed") setups.add(event.installationId);
    if (event.name === "coding_task_attempted")
      attempts.add(event.installationId);
    if (event.name === "coding_task_verified")
      verified.add(event.installationId);
  }
  return {
    eligibleInstallations: installations.size,
    firstLaunches: launches.size,
    setupCompletions: setups.size,
    firstTaskAttempts: attempts.size,
    verifiedFirstTasks: verified.size,
  };
}
