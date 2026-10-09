import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = names
    .filter((name) => name === "index.json" || /^[0-9a-f-]+\.json$/i.test(name))
    .map((name) => join(directory, name));
  const records: UatRecord[] = [];
  const seen = new Set<string>();
  for (const path of files) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of values) {
        const record = UatRecordSchema.parse(item);
        if (!seen.has(record.recordId)) {
          seen.add(record.recordId);
          records.push(record);
        }
      }
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
