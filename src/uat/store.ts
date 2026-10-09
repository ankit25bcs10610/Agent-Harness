import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { UatRecordSchema, type UatRecord, type UatStatus } from "./types";

export function createUatRecord(
  input: Omit<UatRecord, "recordId" | "finishedAt"> & {
    finishedAt?: string | null;
  },
): UatRecord {
  return UatRecordSchema.parse({
    ...input,
    recordId: randomUUID(),
    finishedAt: input.finishedAt ?? null,
  });
}

export async function saveUatRecord(
  record: UatRecord,
  directory: string,
): Promise<string> {
  const valid = UatRecordSchema.parse(record);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${valid.recordId}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, destination);
  return destination;
}

export async function loadUatRecords(directory: string): Promise<UatRecord[]> {
  const files = (await Bun.file(join(directory, "index.json")).exists())
    ? [join(directory, "index.json")]
    : [];
  const records: UatRecord[] = [];
  for (const path of files) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (Array.isArray(parsed))
        records.push(...parsed.map((item) => UatRecordSchema.parse(item)));
    } catch {
      // Corrupt local evidence is omitted, never converted to a pass.
    }
  }
  return records;
}

export function finishUatRecord(
  record: UatRecord,
  status: UatStatus,
  evidence: string[],
  failure?: string,
): UatRecord {
  return UatRecordSchema.parse({
    ...record,
    status,
    evidence,
    ...(failure ? { failure } : {}),
    finishedAt: new Date().toISOString(),
  });
}
