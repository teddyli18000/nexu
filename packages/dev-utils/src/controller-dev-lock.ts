import { readFile } from "node:fs/promises";

import { type DevLock, removeDevLock, writeDevLock } from "./dev-lock.js";
import { controllerDevLockPath } from "./dev-paths.js";

export function readControllerDevLock(): Promise<DevLock> {
  return readDevLock(controllerDevLockPath);
}

export function writeControllerDevLock(lock: DevLock): Promise<void> {
  return writeDevLock(controllerDevLockPath, lock);
}

export function removeControllerDevLock(): Promise<void> {
  return removeDevLock(controllerDevLockPath);
}

async function readDevLock(lockPath: string): Promise<DevLock> {
  const content = await readFile(lockPath, "utf8");
  return JSON.parse(content) as DevLock;
}
