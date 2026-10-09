import { z } from "zod";

export const OperationalEnvironmentSchema = z.enum([
  "local",
  "test",
  "staging",
  "production",
]);
export const LogLevelSchema = z.enum(["error", "warn", "info", "debug"]);
export const OperationalConfigSchema = z.object({
  environment: OperationalEnvironmentSchema,
  logLevel: LogLevelSchema,
  logRetentionDays: z.number().int().min(1).max(365),
  hostedControlPlane: z.boolean(),
});
export type OperationalConfig = z.infer<typeof OperationalConfigSchema>;

function booleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("CHIKU_HOSTED_CONTROL_PLANE must be true or false");
}

export function loadOperationalConfig(
  env: Record<string, string | undefined> = process.env,
): OperationalConfig {
  const environment = OperationalEnvironmentSchema.parse(
    env.CHIKU_ENV ?? "local",
  );
  const logLevel = LogLevelSchema.parse(
    env.CHIKU_LOG_LEVEL ?? (environment === "production" ? "info" : "debug"),
  );
  const retention = Number(env.CHIKU_LOG_RETENTION_DAYS ?? "14");
  const hostedControlPlane = booleanEnv(env.CHIKU_HOSTED_CONTROL_PLANE, false);
  if (
    environment === "production" &&
    hostedControlPlane &&
    !env.CHIKU_PRODUCTION_CONFIGURED
  )
    throw new Error(
      "production hosted mode requires CHIKU_PRODUCTION_CONFIGURED=true",
    );
  return OperationalConfigSchema.parse({
    environment,
    logLevel,
    logRetentionDays: retention,
    hostedControlPlane,
  });
}
