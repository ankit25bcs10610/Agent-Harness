import type { AnalyticsEvent } from "./types";

export type RetentionPeriod = {
  day: number;
  cohortSize: number;
  retainedInstallations: number;
  rate: number | null;
};

/**
 * Calculates retention from observed, opted-in local events only.
 * The cohort is the first observed launch per installation; missing activity
 * is not converted into a success or an inferred user.
 */
export function cohortRetention(
  events: readonly AnalyticsEvent[],
  periods = [1, 7, 30],
): RetentionPeriod[] {
  const launches = new Map<string, number>();
  for (const event of events) {
    if (event.origin === "synthetic" || event.name !== "first_launch") continue;
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at)) continue;
    const previous = launches.get(event.installationId);
    if (previous === undefined || at < previous)
      launches.set(event.installationId, at);
  }
  return periods.map((day) => {
    if (!Number.isInteger(day) || day < 1)
      throw new Error("retention day must be a positive integer");
    const cohortSize = launches.size;
    const retainedInstallations = [...launches.entries()].filter(
      ([installationId, launchAt]) =>
        events.some((event) => {
          if (
            event.origin === "synthetic" ||
            event.installationId !== installationId ||
            event.name === "first_launch"
          )
            return false;
          const deltaDays =
            (Date.parse(event.occurredAt) - launchAt) / 86_400_000;
          return deltaDays >= day && deltaDays < day + 1;
        }),
    ).length;
    return {
      day,
      cohortSize,
      retainedInstallations,
      rate: cohortSize ? retainedInstallations / cohortSize : null,
    };
  });
}
