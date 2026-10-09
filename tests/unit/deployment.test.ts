import { describe, expect, test } from "bun:test";
import {
  assertDeploymentModeAllowed,
  deploymentCapabilities,
} from "../../src/ops/deployment";

describe("deployment capability matrix", () => {
  test("reports local CLI as supported and private targets as unimplemented", () => {
    const capabilities = deploymentCapabilities();
    expect(
      capabilities.find((entry) => entry.mode === "local_cli")?.status,
    ).toBe("SUPPORTED");
    expect(
      capabilities.find((entry) => entry.mode === "private_kubernetes")?.status,
    ).toBe("NOT_IMPLEMENTED");
    expect(
      capabilities.find((entry) => entry.mode === "air_gapped")?.status,
    ).toBe("BLOCKED");
  });

  test("allows only the implemented local mode", () => {
    expect(() => assertDeploymentModeAllowed("local_cli")).not.toThrow();
    expect(() =>
      assertDeploymentModeAllowed("customer_controlled_container"),
    ).toThrow(/NOT_IMPLEMENTED/);
    expect(() => assertDeploymentModeAllowed("air_gapped")).toThrow(/BLOCKED/);
  });
});
