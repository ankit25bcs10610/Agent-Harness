import { describe, expect, test } from "bun:test";
import { EDITIONS, edition } from "../../src/commercial";

describe("commercial edition metadata", () => {
  test("keeps local developer use available without a hosted account", () => {
    const developer = edition("developer");
    expect(developer.availability).toBe("available");
    expect(developer.deployment).toBe("local");
    expect(developer.providerCostResponsibility).toBe("user");
  });
  test("does not present unavailable team services as a paid product", () => {
    const team = edition("team");
    expect(team.availability).toBe("not_available");
    expect(team.limitations.join(" ")).toContain("No production backend");
    expect(EDITIONS).toHaveLength(2);
  });
});
