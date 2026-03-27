import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRootPath = fileURLToPath(
  new URL("../../../", import.meta.url),
);
export const devTmpPath = join(repoRootPath, ".tmp", "dev");
export const devLogsPath = join(devTmpPath, "logs");
export const webDevLockPath = join(devTmpPath, "web.pid");
export const controllerDevLockPath = join(devTmpPath, "controller.pid");

export function getWebDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "web.log");
}

export function getControllerDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "controller.log");
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
