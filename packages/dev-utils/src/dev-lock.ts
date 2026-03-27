import { rm, writeFile } from "node:fs/promises";

import { ensureParentDirectory } from "./dev-paths.js";

export type DevLock = {
  pid: number;
  runId: string;
};

export async function writeDevLock(
  lockPath: string,
  lock: DevLock,
): Promise<void> {
  await ensureParentDirectory(lockPath);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function removeDevLock(lockPath: string): Promise<void> {
  await rm(lockPath, { force: true });
}
