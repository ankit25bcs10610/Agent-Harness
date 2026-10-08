import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config";
import {
  deserializeContract,
  serializeContract,
  type ChangeContract,
} from "./types";

function contractFile(root: string, id: string, revision: number) {
  return join(root, `${id}.r${revision}.json`);
}

export async function saveContract(
  contract: ChangeContract,
  directory = PATHS.contractsDir,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const destination = contractFile(
    directory,
    contract.contractId,
    contract.revision,
  );
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, serializeContract(contract), {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, destination);
  return destination;
}

export async function loadContract(
  id: string,
  revision?: number,
  directory = PATHS.contractsDir,
): Promise<ChangeContract | undefined> {
  const candidates = (await readdir(directory).catch(() => []))
    .filter((file) => file.startsWith(`${id}.r`) && file.endsWith(".json"))
    .map((file) => Number(file.slice(`${id}.r`.length, -5)))
    .filter(
      (value) =>
        Number.isInteger(value) &&
        (revision === undefined || value === revision),
    )
    .sort((a, b) => b - a);
  const selected = candidates[0];
  if (selected === undefined) return undefined;
  try {
    return deserializeContract(
      await readFile(contractFile(directory, id, selected), "utf8"),
    );
  } catch {
    return undefined;
  }
}

export async function listContracts(
  directory = PATHS.contractsDir,
): Promise<ChangeContract[]> {
  const files = (await readdir(directory).catch(() => [])).filter((file) =>
    file.endsWith(".json"),
  );
  const loaded = await Promise.all(
    files.map(async (file) => {
      try {
        return deserializeContract(
          await readFile(join(directory, file), "utf8"),
        );
      } catch {
        return undefined;
      }
    }),
  );
  const latest = new Map<string, ChangeContract>();
  for (const contract of loaded) {
    if (!contract) continue;
    const current = latest.get(contract.contractId);
    if (!current || contract.revision > current.revision)
      latest.set(contract.contractId, contract);
  }
  return [...latest.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
