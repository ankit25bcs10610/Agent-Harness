import { describe, expect, test } from "bun:test";
import { diagnostics } from "../../src/cli";

describe("maintenance health diagnostics", () => {
  test("reports measured local checks without fabricating provider connectivity", () => {
    const checks = diagnostics(process.cwd());
    expect(checks.length).toBeGreaterThan(3);
    expect(checks.some((check) => check.name === "runtime")).toBe(true);
    const provider = checks.find(
      (check) => check.name === "provider credentials",
    );
    expect(provider?.detail).toMatch(/configured|not configured/);
    expect(provider?.detail).not.toContain("healthy");
  });
});
