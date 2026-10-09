import { describe, expect, test } from "bun:test";
import { loadOperationalConfig } from "../../src/ops";

describe("operational configuration", () => {
  test("defaults to local, non-hosted operation", () => {
    expect(loadOperationalConfig({})).toMatchObject({
      environment: "local",
      hostedControlPlane: false,
    });
  });
  test("rejects invalid retention and boolean values", () => {
    expect(() =>
      loadOperationalConfig({ CHIKU_LOG_RETENTION_DAYS: "0" }),
    ).toThrow();
    expect(() =>
      loadOperationalConfig({ CHIKU_HOSTED_CONTROL_PLANE: "yes" }),
    ).toThrow();
  });
  test("fails closed for unconfigured production hosted mode", () => {
    expect(() =>
      loadOperationalConfig({
        CHIKU_ENV: "production",
        CHIKU_HOSTED_CONTROL_PLANE: "true",
      }),
    ).toThrow("production hosted mode");
  });
});
