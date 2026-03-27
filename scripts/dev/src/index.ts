import {
  getCurrentControllerDevSnapshot,
  getCurrentWebDevSnapshot,
  isSupportedDevCommand,
  readControllerDevLog,
  readWebDevLog,
  restartControllerDevProcess,
  restartWebDevProcess,
  startControllerDevProcess,
  startWebDevProcess,
  stopControllerDevProcess,
  stopWebDevProcess,
} from "@nexu/dev-utils";
import { cac } from "cac";

const cli = cac("scripts-dev");

cli.command("start", "Start the local dev flow").action(async () => {
  const controllerFact = await startControllerDevProcess();
  console.log(`[scripts-dev] controller started (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
  console.log(
    `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
  );

  const webFact = await startWebDevProcess();
  console.log(`[scripts-dev] web started (${webFact.pid})`);
  console.log(`[scripts-dev] web run id: ${webFact.runId}`);
  console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
});

cli.command("restart", "Restart the local dev flow").action(async () => {
  const controllerFact = await restartControllerDevProcess();
  console.log(`[scripts-dev] controller restarted (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
  console.log(
    `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
  );

  const webFact = await restartWebDevProcess();
  console.log(`[scripts-dev] web restarted (${webFact.pid})`);
  console.log(`[scripts-dev] web run id: ${webFact.runId}`);
  console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
});

cli.command("stop", "Stop the local dev flow").action(async () => {
  const webFact = await stopWebDevProcess();
  console.log(`[scripts-dev] web stopped (${webFact.pid})`);
  console.log(`[scripts-dev] web last run id: ${webFact.runId}`);

  const controllerFact = await stopControllerDevProcess();
  console.log(`[scripts-dev] controller stopped (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller last run id: ${controllerFact.runId}`);
});

cli.command("status", "Show the local dev status").action(async () => {
  const controllerSnapshot = await getCurrentControllerDevSnapshot();
  const webSnapshot = await getCurrentWebDevSnapshot();

  console.log(`[scripts-dev] controller status: ${controllerSnapshot.status}`);
  if (controllerSnapshot.pid) {
    console.log(
      `[scripts-dev] controller supervisor pid: ${controllerSnapshot.pid}`,
    );
  }
  if (controllerSnapshot.workerPid) {
    console.log(
      `[scripts-dev] controller worker pid: ${controllerSnapshot.workerPid}`,
    );
  }
  if (controllerSnapshot.runId) {
    console.log(`[scripts-dev] controller run id: ${controllerSnapshot.runId}`);
  }
  if (controllerSnapshot.logFilePath) {
    console.log(
      `[scripts-dev] controller log file: ${controllerSnapshot.logFilePath}`,
    );
  }

  console.log(`[scripts-dev] web status: ${webSnapshot.status}`);
  if (webSnapshot.pid) {
    console.log(`[scripts-dev] web pid: ${webSnapshot.pid}`);
  }
  if (webSnapshot.listenerPid) {
    console.log(`[scripts-dev] web listener pid: ${webSnapshot.listenerPid}`);
  }
  if (webSnapshot.runId) {
    console.log(`[scripts-dev] web run id: ${webSnapshot.runId}`);
  }
  if (webSnapshot.logFilePath) {
    console.log(`[scripts-dev] web log file: ${webSnapshot.logFilePath}`);
  }
});

cli
  .command("logs [target]", "Print the local dev logs")
  .action(async (target?: string) => {
    if (!target) {
      throw new Error("log target is required; use `pnpm dev logs web`");
    }

    if (target !== "web") {
      if (target !== "controller") {
        throw new Error(`unsupported log target: ${target}`);
      }

      const snapshot = await getCurrentControllerDevSnapshot();

      if (!snapshot.logFilePath) {
        throw new Error("controller log file is unavailable");
      }

      console.log(`[scripts-dev] log file: ${snapshot.logFilePath}`);
      const content = await readControllerDevLog();
      process.stdout.write(content);
      return;
    }

    const snapshot = await getCurrentWebDevSnapshot();

    if (!snapshot.logFilePath) {
      throw new Error("web log file is unavailable");
    }

    console.log(`[scripts-dev] log file: ${snapshot.logFilePath}`);
    const content = await readWebDevLog();
    process.stdout.write(content);
  });

cli.command("help", "Show the CLI help output").action(() => {
  cli.outputHelp();
});

cli.help();

const fallbackCommand = process.argv[2];

if (fallbackCommand && !isSupportedDevCommand(fallbackCommand)) {
  console.error(`[scripts-dev] Unknown command: ${fallbackCommand}`);
  process.exit(1);
}

cli.parse();
