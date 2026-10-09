import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const BetaProgramSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  maxParticipants: z.number().int().positive(),
  consentVersion: z.string().trim().min(1).max(80),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  allowedPlatforms: z.array(z.string().min(1)).min(1),
  createdAt: z.string().datetime({ offset: true }),
});
export type BetaProgram = z.infer<typeof BetaProgramSchema>;

export const BetaInvitationSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  programId: z.string().min(1),
  tokenHash: z.string().length(64),
  expiresAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  enrolledParticipantId: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type BetaInvitation = z.infer<typeof BetaInvitationSchema>;

export const BetaConsentSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  acceptedAt: z.string().datetime({ offset: true }),
  withdrawnAt: z.string().datetime({ offset: true }).nullable(),
});
export type BetaConsent = z.infer<typeof BetaConsentSchema>;

export const BetaParticipantSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  programId: z.string().min(1),
  contactHash: z.string().length(64),
  accessTokenHash: z.string().length(64).optional(),
  platform: z.string().min(1),
  consent: BetaConsentSchema,
  enrolledAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }),
});
export type BetaParticipant = z.infer<typeof BetaParticipantSchema>;
export type BetaEnrollment = BetaParticipant & { accessToken: string };

const DatabaseSchema = z.object({
  schemaVersion: z.literal(1),
  programs: z.array(BetaProgramSchema),
  invitations: z.array(BetaInvitationSchema),
  participants: z.array(BetaParticipantSchema),
});
type Database = z.infer<typeof DatabaseSchema>;

const emptyDatabase = (): Database => ({
  schemaVersion: 1,
  programs: [],
  invitations: [],
  participants: [],
});

async function load(directory: string): Promise<Database> {
  try {
    return DatabaseSchema.parse(
      JSON.parse(
        await readFile(join(directory, "beta-participants.json"), "utf8"),
      ),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return emptyDatabase();
    throw new Error("beta participant store is invalid or unreadable", {
      cause: error,
    });
  }
}

async function save(directory: string, database: Database) {
  const valid = DatabaseSchema.parse(database);
  const destination = join(directory, "beta-participants.json");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
}

export type CreateProgramInput = Omit<
  BetaProgram,
  "schemaVersion" | "createdAt"
>;

export async function createBetaProgram(
  directory: string,
  input: CreateProgramInput,
  now = new Date(),
) {
  const program = BetaProgramSchema.parse({
    ...input,
    schemaVersion: 1,
    createdAt: now.toISOString(),
  });
  const database = await load(directory);
  if (database.programs.some((entry) => entry.id === program.id))
    throw new Error("beta program already exists");
  database.programs.push(program);
  await save(directory, database);
  return program;
}

export async function createBetaInvitation(
  directory: string,
  programId: string,
  ttlMs: number,
  now = new Date(),
) {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0)
    throw new Error("invitation ttl must be positive");
  const database = await load(directory);
  if (!database.programs.some((entry) => entry.id === programId))
    throw new Error("unknown beta program");
  const token = randomBytes(32).toString("base64url");
  const invitation = BetaInvitationSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    programId,
    tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    revokedAt: null,
    enrolledParticipantId: null,
    createdAt: now.toISOString(),
  });
  database.invitations.push(invitation);
  await save(directory, database);
  return { invitation, token };
}

export async function revokeBetaInvitation(
  directory: string,
  invitationId: string,
  now = new Date(),
) {
  const database = await load(directory);
  const invitation = database.invitations.find(
    (entry) => entry.id === invitationId,
  );
  if (!invitation) throw new Error("unknown invitation");
  if (!invitation.revokedAt) invitation.revokedAt = now.toISOString();
  await save(directory, database);
  return invitation;
}

export async function enrollBetaParticipant(
  directory: string,
  input: {
    token: string;
    contact: string;
    platform: string;
    consentVersion: string;
  },
  now = new Date(),
) {
  const database = await load(directory);
  const invitation = database.invitations.find(
    (entry) => entry.tokenHash === hash(input.token),
  );
  if (!invitation) throw new Error("invalid invitation");
  if (invitation.revokedAt) throw new Error("invitation revoked");
  if (Date.parse(invitation.expiresAt) <= now.getTime())
    throw new Error("invitation expired");
  if (invitation.enrolledParticipantId)
    throw new Error("invitation already used");
  const program = database.programs.find(
    (entry) => entry.id === invitation.programId,
  );
  if (!program) throw new Error("beta program unavailable");
  if (program.expiresAt && Date.parse(program.expiresAt) <= now.getTime())
    throw new Error("beta program expired");
  if (!program.allowedPlatforms.includes(input.platform))
    throw new Error("platform is not eligible");
  if (input.consentVersion !== program.consentVersion)
    throw new Error("current consent version is required");
  if (
    database.participants.filter((entry) => entry.programId === program.id)
      .length >= program.maxParticipants
  )
    throw new Error("beta program is full");
  const contactHash = hash(input.contact.trim().toLowerCase());
  if (
    database.participants.some(
      (entry) =>
        entry.programId === program.id && entry.contactHash === contactHash,
    )
  )
    throw new Error("participant already enrolled");
  const accessToken = randomBytes(32).toString("base64url");
  const participant = BetaParticipantSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    programId: program.id,
    contactHash,
    accessTokenHash: hash(accessToken),
    platform: input.platform,
    consent: {
      schemaVersion: 1,
      version: input.consentVersion,
      acceptedAt: now.toISOString(),
      withdrawnAt: null,
    },
    enrolledAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  });
  invitation.enrolledParticipantId = participant.id;
  database.participants.push(participant);
  await save(directory, database);
  return { ...participant, accessToken } satisfies BetaEnrollment;
}

export async function withdrawBetaConsent(
  directory: string,
  participantId: string,
  accessToken: string,
  now = new Date(),
) {
  const database = await load(directory);
  const participant = database.participants.find(
    (entry) => entry.id === participantId,
  );
  if (!participant || participant.accessTokenHash !== hash(accessToken))
    throw new Error("participant authorization failed");
  if (!participant.consent.withdrawnAt)
    participant.consent.withdrawnAt = now.toISOString();
  await save(directory, database);
  return participant;
}

export async function getBetaParticipant(
  directory: string,
  participantId: string,
  programId: string,
  accessToken: string,
) {
  const participant = (await load(directory)).participants.find(
    (entry) =>
      entry.id === participantId &&
      entry.programId === programId &&
      entry.accessTokenHash === hash(accessToken),
  );
  if (!participant) throw new Error("participant authorization failed");
  return participant;
}

export async function listBetaParticipants(
  directory: string,
  programId: string,
) {
  return (await load(directory)).participants.filter(
    (entry) => entry.programId === programId,
  );
}
