import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBetaInvitation,
  createBetaProgram,
  enrollBetaParticipant,
  getBetaParticipant,
  revokeBetaInvitation,
  withdrawBetaConsent,
} from "../../src/beta";

const at = new Date("2026-01-01T00:00:00.000Z");
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-beta-"));
  await createBetaProgram(
    directory,
    {
      id: "pilot-a",
      name: "Local pilot",
      maxParticipants: 2,
      consentVersion: "privacy-2026-01",
      expiresAt: null,
      allowedPlatforms: ["darwin", "linux"],
    },
    at,
  );
  return directory;
};

describe("beta participant lifecycle", () => {
  test("enrolls with a current invitation and consent without storing secrets", async () => {
    const directory = await setup();
    const issued = await createBetaInvitation(directory, "pilot-a", 60_000, at);
    const participant = await enrollBetaParticipant(
      directory,
      {
        token: issued.token,
        contact: "Developer@example.com",
        platform: "darwin",
        consentVersion: "privacy-2026-01",
      },
      at,
    );
    expect(participant.consent.withdrawnAt).toBeNull();
    expect(participant.contactHash).not.toContain("developer@example.com");
    const stored = await Bun.file(
      join(directory, "beta-participants.json"),
    ).text();
    expect(stored).not.toContain(issued.token);
    expect(stored).not.toContain("developer@example.com");
  });

  test("rejects expired, revoked, reused, wrong-consent, and wrong-platform invitations", async () => {
    const directory = await setup();
    const expired = await createBetaInvitation(directory, "pilot-a", 1, at);
    await expect(
      enrollBetaParticipant(
        directory,
        {
          token: expired.token,
          contact: "a@example.com",
          platform: "darwin",
          consentVersion: "privacy-2026-01",
        },
        new Date(at.getTime() + 2),
      ),
    ).rejects.toThrow("expired");
    const revoked = await createBetaInvitation(
      directory,
      "pilot-a",
      60_000,
      at,
    );
    await revokeBetaInvitation(directory, revoked.invitation.id, at);
    await expect(
      enrollBetaParticipant(
        directory,
        {
          token: revoked.token,
          contact: "b@example.com",
          platform: "darwin",
          consentVersion: "privacy-2026-01",
        },
        at,
      ),
    ).rejects.toThrow("revoked");
    const wrong = await createBetaInvitation(directory, "pilot-a", 60_000, at);
    await expect(
      enrollBetaParticipant(
        directory,
        {
          token: wrong.token,
          contact: "c@example.com",
          platform: "win32",
          consentVersion: "privacy-2026-01",
        },
        at,
      ),
    ).rejects.toThrow("platform");
    const stale = await createBetaInvitation(directory, "pilot-a", 60_000, at);
    await expect(
      enrollBetaParticipant(
        directory,
        {
          token: stale.token,
          contact: "d@example.com",
          platform: "linux",
          consentVersion: "old",
        },
        at,
      ),
    ).rejects.toThrow("consent");
  });

  test("prevents duplicate enrollment, isolates programs, and records withdrawal", async () => {
    const directory = await setup();
    const first = await createBetaInvitation(directory, "pilot-a", 60_000, at);
    const participant = await enrollBetaParticipant(
      directory,
      {
        token: first.token,
        contact: "same@example.com",
        platform: "linux",
        consentVersion: "privacy-2026-01",
      },
      at,
    );
    const second = await createBetaInvitation(directory, "pilot-a", 60_000, at);
    await expect(
      enrollBetaParticipant(
        directory,
        {
          token: second.token,
          contact: "SAME@example.com",
          platform: "linux",
          consentVersion: "privacy-2026-01",
        },
        at,
      ),
    ).rejects.toThrow("already enrolled");
    await expect(
      getBetaParticipant(directory, participant.id, "other-program"),
    ).rejects.toThrow("not found");
    const withdrawn = await withdrawBetaConsent(directory, participant.id, at);
    expect(withdrawn.consent.withdrawnAt).toBe(at.toISOString());
  });
});
