import { readFile } from "node:fs/promises";

import { type DevLock, removeDevLock, writeDevLock } from "./dev-lock.js";
import { webDevLockPath } from "./dev-paths.js";

export function readWebDevLock(): Promise<DevLock> {
  return readDevLock(webDevLockPath);
}

export function writeWebDevLock(lock: DevLock): Promise<void> {
  return writeDevLock(webDevLockPath, lock);
}

export function removeWebDevLock(): Promise<void> {
  return removeDevLock(webDevLockPath);
}

async function readDevLock(lockPath: string): Promise<DevLock> {
  const content = await readFile(lockPath, "utf8");
  return JSON.parse(content) as DevLock;
}
