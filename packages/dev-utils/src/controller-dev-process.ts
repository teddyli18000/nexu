import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  readControllerDevLock,
  removeControllerDevLock,
  writeControllerDevLock,
} from "./controller-dev-lock.js";
import {
  createRunId,
  ensureParentDirectory,
  getControllerDevLogPath,
  repoRootPath,
} from "./dev-paths.js";

const require = createRequire(import.meta.url);

export type ControllerDevSnapshot = {
  service: "controller";
  status: "running" | "stopped" | "stale";
  pid?: number;
  workerPid?: number;
  runId?: string;
  logFilePath?: string;
};

function createNodeOptions(): string {
  const existing = process.env.NODE_OPTIONS?.trim();

  if (existing) {
    return `${existing} --conditions=development`;
  }

  return "--conditions=development";
}

function createControllerCommand(): { command: string; args: string[] } {
  const tsxPackageJsonPath = require.resolve("tsx/package.json", {
    paths: [repoRootPath],
  });
  const tsxCliPath = join(dirname(tsxPackageJsonPath), "dist", "cli.mjs");
  const supervisorPath = join(
    repoRootPath,
    "scripts",
    "dev",
    "src",
    "controller-supervisor.ts",
  );

  return {
    command: process.execPath,
    args: [tsxCliPath, supervisorPath],
  };
}

async function terminateProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "inherit",
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`taskkill exited with code ${code ?? 1}`));
      });
    });

    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

export async function getControllerPortPid(): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("netstat", ["-ano"], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    let stdout = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`netstat exited with code ${code ?? 1}`));
    });
  });

  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes(":3010") || !line.includes("LISTENING")) {
      continue;
    }

    const columns = line.trim().split(/\s+/);
    const pidText = columns.at(-1);

    if (!pidText) {
      continue;
    }

    const pid = Number(pidText);

    if (Number.isNaN(pid)) {
      continue;
    }

    return pid;
  }

  throw new Error("controller dev server did not open port 3010");
}

async function waitForControllerPortPid(): Promise<number> {
  for (let index = 0; index < 30; index += 1) {
    try {
      return await getControllerPortPid();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("controller dev server did not open port 3010");
}

async function waitForProcessStart(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 1000);

    function cleanup(): void {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      cleanup();
      reject(
        new Error(
          `controller dev process exited early (code: ${code ?? "none"}, signal: ${signal ?? "none"})`,
        ),
      );
    }

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function startControllerDevProcess(): Promise<ControllerDevSnapshot> {
  try {
    const existingSnapshot = await getCurrentControllerDevSnapshot();

    if (existingSnapshot.status === "running") {
      throw new Error(
        "controller dev process is already running; run `pnpm dev stop` first",
      );
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const runId = createRunId();
  const logFilePath = getControllerDevLogPath(runId);
  const commandSpec = createControllerCommand();

  await ensureParentDirectory(logFilePath);

  const logFd = openSync(logFilePath, "a");
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: repoRootPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      NEXU_DEV_CONTROLLER_RUN_ID: runId,
      NEXU_DEV_CONTROLLER_LOG_PATH: logFilePath,
    },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });

  try {
    await waitForProcessStart(child);
  } finally {
    child.unref();
    closeSync(logFd);
  }

  if (!child.pid) {
    throw new Error("controller dev process did not expose a pid");
  }

  const workerPid = await waitForControllerPortPid();

  await writeControllerDevLock({
    pid: child.pid,
    runId,
  });

  return {
    service: "controller",
    status: "running",
    pid: child.pid,
    workerPid,
    runId,
    logFilePath,
  };
}

export async function stopControllerDevProcess(): Promise<ControllerDevSnapshot> {
  const snapshot = await getCurrentControllerDevSnapshot();

  if (snapshot.status !== "running" || !snapshot.pid) {
    throw new Error("controller dev process is not running");
  }

  await terminateProcess(snapshot.pid);

  try {
    const workerPid = await getControllerPortPid();
    await terminateProcess(workerPid);
  } catch {}

  await removeControllerDevLock();

  return snapshot;
}

export async function restartControllerDevProcess(): Promise<ControllerDevSnapshot> {
  try {
    const snapshot = await getCurrentControllerDevSnapshot();

    if (snapshot.status === "running") {
      await stopControllerDevProcess();
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  return startControllerDevProcess();
}

export async function getCurrentControllerDevSnapshot(): Promise<ControllerDevSnapshot> {
  try {
    const lock = await readControllerDevLock();
    const logFilePath = getControllerDevLogPath(lock.runId);

    try {
      process.kill(lock.pid, 0);
    } catch {
      return {
        service: "controller",
        status: "stale",
        pid: lock.pid,
        runId: lock.runId,
        logFilePath,
      };
    }

    let workerPid: number | undefined;

    try {
      workerPid = await getControllerPortPid();
    } catch {}

    return {
      service: "controller",
      status: "running",
      pid: lock.pid,
      workerPid,
      runId: lock.runId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        service: "controller",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readControllerDevLog(): Promise<string> {
  const snapshot = await getCurrentControllerDevSnapshot();

  if (!snapshot.logFilePath) {
    throw new Error("controller dev log is unavailable");
  }

  return readFile(snapshot.logFilePath, "utf8");
}
