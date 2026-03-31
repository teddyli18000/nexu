import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePnpmCommand } from "./platforms/filesystem-compat.mjs";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";
import { createPlatformCommandSpec } from "./platforms/process-compat.mjs";
import {
  createDesktopBuildContext,
  getSharedBuildSteps,
} from "./platforms/shared/build-capabilities.mjs";
import { createWindowsBuildCapabilities } from "./platforms/win/build-capabilities.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const require = createRequire(import.meta.url);
const buildTargetPlatform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});
const pnpmCommand = resolvePnpmCommand({
  env: process.env,
  platform: process.platform,
});
const preferExistingBuildArtifacts =
  process.env.NEXU_DESKTOP_USE_EXISTING_BUILDS === "1" ||
  process.env.NEXU_DESKTOP_USE_EXISTING_BUILDS?.toLowerCase() === "true";
const preferExistingRuntimeInstall =
  process.env.NEXU_DESKTOP_USE_EXISTING_RUNTIME_INSTALL === "1" ||
  process.env.NEXU_DESKTOP_USE_EXISTING_RUNTIME_INSTALL?.toLowerCase() ===
    "true";
const preferExistingSidecars =
  process.env.NEXU_DESKTOP_USE_EXISTING_SIDECARS === "1" ||
  process.env.NEXU_DESKTOP_USE_EXISTING_SIDECARS?.toLowerCase() === "true";

const rmWithRetriesOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
};

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  console.log(`[dist:win][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[dist:win][timing] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

async function ensureExistingPath(path, label) {
  try {
    await lstat(path);
  } catch {
    throw new Error(`[dist:win] Missing ${label}: ${path}`);
  }
}

async function ensureExistingBuildArtifacts() {
  await Promise.all([
    ensureExistingPath(
      resolve(repoRoot, "packages/dev-utils/dist"),
      "dev-utils build",
    ),
    ensureExistingPath(
      resolve(repoRoot, "packages/shared/dist"),
      "shared build",
    ),
    ensureExistingPath(
      resolve(repoRoot, "apps/controller/dist"),
      "controller build",
    ),
    ensureExistingPath(resolve(repoRoot, "apps/web/dist"), "web build"),
    ensureExistingPath(resolve(electronRoot, "dist"), "desktop renderer build"),
    ensureExistingPath(
      resolve(electronRoot, "dist-electron/main"),
      "desktop main build",
    ),
    ensureExistingPath(
      resolve(electronRoot, "dist-electron/preload"),
      "desktop preload build",
    ),
  ]);
}

async function ensureExistingRuntimeInstall() {
  await Promise.all([
    ensureExistingPath(
      resolve(repoRoot, "openclaw-runtime/node_modules"),
      "openclaw-runtime install",
    ),
    ensureExistingPath(
      resolve(repoRoot, "openclaw-runtime/.postinstall-cache.json"),
      "openclaw-runtime cache",
    ),
  ]);
}

async function ensureExistingOpenclawSidecar(runtimeDistRoot, options = {}) {
  const openclawSidecarRoot = resolve(runtimeDistRoot, "openclaw");

  try {
    await ensureExistingPath(
      resolve(openclawSidecarRoot, "archive.json"),
      "openclaw sidecar archive metadata",
    );
    return;
  } catch (error) {
    if (!options.allowUnarchived) {
      throw error;
    }
  }

  await Promise.all([
    ensureExistingPath(
      resolve(openclawSidecarRoot, "package.json"),
      "openclaw sidecar package",
    ),
    ensureExistingPath(
      resolve(openclawSidecarRoot, "node_modules", "openclaw", "openclaw.mjs"),
      "openclaw sidecar entry",
    ),
  ]);
}

async function ensureExistingSidecars(runtimeDistRoot, options = {}) {
  await Promise.all([
    ensureExistingPath(
      resolve(runtimeDistRoot, "controller", "package.json"),
      "controller sidecar",
    ),
    ensureExistingOpenclawSidecar(runtimeDistRoot, {
      allowUnarchived: options.allowUnarchivedOpenclaw,
    }),
    ensureExistingPath(
      resolve(runtimeDistRoot, "web", "package.json"),
      "web sidecar",
    ),
  ]);
}

async function canReuseExistingArtifacts(ensureFn, label) {
  try {
    await ensureFn();
    return true;
  } catch (error) {
    console.log(
      `[dist:win] ${label} unavailable, rebuilding: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function dereferencePnpmSymlinks() {
  const sharpPath = resolve(electronRoot, "node_modules/sharp");
  const imgPath = resolve(electronRoot, "node_modules/@img");
  let pnpmImgPath = null;

  const sharpStat = await lstat(sharpPath).catch((error) => {
    throw new Error(
      `[dist:win] Missing required sharp dependency at ${sharpPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (sharpStat.isSymbolicLink()) {
    const realSharpPath = await realpath(sharpPath);
    pnpmImgPath = resolve(dirname(realSharpPath), "@img");
    console.log(
      `[dist:win] dereferencing pnpm symlink: ${sharpPath} -> ${realSharpPath}`,
    );
    await rm(sharpPath, rmWithRetriesOptions);
    await cp(realSharpPath, sharpPath, {
      recursive: true,
      dereference: true,
    });
  }

  const sharpImgPath = pnpmImgPath ?? resolve(sharpPath, "node_modules/@img");
  const sharpImgStat = await lstat(sharpImgPath).catch(() => null);

  if (!sharpImgStat) {
    const existingImgStat = await lstat(imgPath).catch(() => null);

    if (existingImgStat) {
      console.log(
        `[dist:win] reusing existing top-level @img dependency at ${imgPath}`,
      );
      return;
    }

    throw new Error(
      `[dist:win] Missing required @img dependency at ${sharpImgPath} and top-level fallback ${imgPath}`,
    );
  }

  if (sharpImgStat) {
    console.log(
      `[dist:win] copying @img from sharp's node_modules: ${sharpImgPath} -> ${imgPath}`,
    );
    await rm(imgPath, rmWithRetriesOptions);
    await cp(sharpImgPath, imgPath, { recursive: true, dereference: true });
  }
}

function redactBuildConfigForLog(config) {
  return {
    NEXU_CLOUD_URL: config.NEXU_CLOUD_URL,
    NEXU_LINK_URL: config.NEXU_LINK_URL,
    NEXU_DESKTOP_APP_VERSION: config.NEXU_DESKTOP_APP_VERSION,
    NEXU_DESKTOP_AUTO_UPDATE_ENABLED: config.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
    NEXU_DESKTOP_BUILD_SOURCE: config.NEXU_DESKTOP_BUILD_SOURCE,
    NEXU_DESKTOP_BUILD_BRANCH: config.NEXU_DESKTOP_BUILD_BRANCH,
    NEXU_DESKTOP_BUILD_COMMIT: config.NEXU_DESKTOP_BUILD_COMMIT,
    NEXU_DESKTOP_BUILD_TIME: config.NEXU_DESKTOP_BUILD_TIME,
    hasSentryDsn: typeof config.NEXU_DESKTOP_SENTRY_DSN === "string",
    hasUpdateFeedUrl: typeof config.NEXU_UPDATE_FEED_URL === "string",
  };
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function getGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const commandSpec = createPlatformCommandSpec({
      command,
      args,
      env: options.env ?? process.env,
      platform: buildTargetPlatform === "win" ? "win32" : process.platform,
    });
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${commandSpec.command} ${commandSpec.args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function runElectronBuilder(args, options = {}) {
  const electronBuilderCli = require.resolve("electron-builder/cli.js", {
    paths: [electronRoot, repoRoot],
  });
  await run(process.execPath, [electronBuilderCli, ...args], options);
}

async function ensureWindowsPwdShim() {
  if (buildTargetPlatform !== "win") {
    return null;
  }

  const shimDir = resolve(repoRoot, ".cache", "nexu-dev", "bin");
  const shimPath = resolve(shimDir, "pwd.cmd");
  await mkdir(shimDir, { recursive: true });
  await writeFile(shimPath, "@echo off\r\necho %CD%\r\n", "utf8");
  return shimDir;
}

async function ensureBuildConfig() {
  const configPath = resolve(electronRoot, "build-config.json");
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  const envPath = resolve(electronRoot, ".env");
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {}

  const merged = { ...fileEnv, ...process.env };
  const gitBranch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const gitCommit = getGitValue(["rev-parse", "HEAD"]);

  const config = {
    NEXU_CLOUD_URL: merged.NEXU_CLOUD_URL ?? "https://nexu.io",
    NEXU_LINK_URL: merged.NEXU_LINK_URL ?? null,
    NEXU_DESKTOP_APP_VERSION:
      merged.NEXU_DESKTOP_APP_VERSION ??
      (typeof desktopPackage.version === "string"
        ? desktopPackage.version
        : undefined) ??
      merged.npm_package_version ??
      undefined,
    ...(merged.NEXU_DESKTOP_SENTRY_DSN
      ? { NEXU_DESKTOP_SENTRY_DSN: merged.NEXU_DESKTOP_SENTRY_DSN }
      : {}),
    ...(merged.NEXU_UPDATE_FEED_URL
      ? { NEXU_UPDATE_FEED_URL: merged.NEXU_UPDATE_FEED_URL }
      : {}),
    ...(merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED
      ? {
          NEXU_DESKTOP_AUTO_UPDATE_ENABLED:
            merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
        }
      : {}),
    NEXU_DESKTOP_BUILD_SOURCE: merged.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dist",
    ...((merged.NEXU_DESKTOP_BUILD_BRANCH ?? gitBranch)
      ? {
          NEXU_DESKTOP_BUILD_BRANCH:
            merged.NEXU_DESKTOP_BUILD_BRANCH ?? gitBranch,
        }
      : {}),
    ...((merged.NEXU_DESKTOP_BUILD_COMMIT ?? gitCommit)
      ? {
          NEXU_DESKTOP_BUILD_COMMIT:
            merged.NEXU_DESKTOP_BUILD_COMMIT ?? gitCommit,
        }
      : {}),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(
    "[dist:win] generated build-config.json from env:",
    JSON.stringify(redactBuildConfigForLog(config)),
  );
}

async function getElectronVersion() {
  const electronPackageJsonPath = require.resolve("electron/package.json", {
    paths: [electronRoot, repoRoot],
  });
  const electronPackageJson = JSON.parse(
    await readFile(electronPackageJsonPath, "utf8"),
  );
  if (typeof electronPackageJson.version !== "string") {
    throw new Error(
      `Unable to determine Electron version from ${electronPackageJsonPath}.`,
    );
  }
  return electronPackageJson.version;
}

async function getWindowsBuildVersion() {
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  const rawVersion =
    typeof desktopPackage.version === "string"
      ? desktopPackage.version
      : process.env.npm_package_version;

  if (typeof rawVersion !== "string" || rawVersion.trim().length === 0) {
    return "0.0.0.0";
  }

  const numericParts = rawVersion
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (numericParts.length < 4) {
    numericParts.push(0);
  }

  return numericParts.slice(0, 4).join(".");
}

async function cleanupReleaseIntermediates(releaseRoot) {
  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const removableNames = entries
    .filter((entry) => {
      if (entry.isDirectory()) {
        return false;
      }

      return (
        entry.name === "builder-debug.yml" ||
        entry.name.endsWith(".__uninstaller.exe") ||
        entry.name.endsWith(".nsis.7z")
      );
    })
    .map((entry) => entry.name);

  await Promise.all(
    removableNames.map((name) =>
      rm(resolve(releaseRoot, name), rmWithRetriesOptions),
    ),
  );

  if (removableNames.length > 0) {
    console.log(
      `[dist:win] removed release intermediates: ${removableNames.join(", ")}`,
    );
  }
}

async function main() {
  const rawArgs = new Set(process.argv.slice(2));
  const localMode = rawArgs.has("--local");
  const dirOnly =
    localMode || rawArgs.has("--dir-only") || rawArgs.has("--target=dir");
  const timings = [];
  if (buildTargetPlatform !== "win") {
    throw new Error(
      `[dist:win] Windows packaging must run with target platform "win": host=${process.platform}, target=${buildTargetPlatform}.`,
    );
  }
  const buildContext = createDesktopBuildContext({
    electronRoot,
    repoRoot,
    processEnv: process.env,
  });
  const env = buildContext.env;
  const releaseRoot = buildContext.resolveReleaseRoot();
  const buildCapabilities = createWindowsBuildCapabilities({
    env,
    releaseRoot,
    processPlatform: process.platform,
  });
  const runtimeDistRoot = buildContext.resolveRuntimeDistRoot();
  const electronBuilderEnv = buildCapabilities.createElectronBuilderEnv();
  const windowsPwdShimDir = await ensureWindowsPwdShim();
  const allowUnarchivedOpenclawSidecar = localMode;
  const shouldReuseExistingBuildArtifacts =
    preferExistingBuildArtifacts ||
    (localMode &&
      (await canReuseExistingArtifacts(
        ensureExistingBuildArtifacts,
        "workspace build artifacts",
      )));
  const shouldReuseExistingRuntimeInstall =
    preferExistingRuntimeInstall ||
    (localMode &&
      (await canReuseExistingArtifacts(
        ensureExistingRuntimeInstall,
        "openclaw runtime install",
      )));
  const shouldReuseExistingSidecars =
    preferExistingSidecars ||
    (localMode &&
      (await canReuseExistingArtifacts(
        () =>
          ensureExistingSidecars(runtimeDistRoot, {
            allowUnarchivedOpenclaw: allowUnarchivedOpenclawSidecar,
          }),
        "prepared runtime sidecars",
      )));

  if (localMode) {
    console.log(
      `[dist:win] local mode enabled dirOnly=${dirOnly} reuseBuilds=${shouldReuseExistingBuildArtifacts} reuseRuntimeInstall=${shouldReuseExistingRuntimeInstall} reuseSidecars=${shouldReuseExistingSidecars}`,
    );
  }

  await timedStep(
    "clean release directories",
    async () => {
      await rm(releaseRoot, rmWithRetriesOptions);
      if (!shouldReuseExistingSidecars) {
        await rm(runtimeDistRoot, rmWithRetriesOptions);
      }
    },
    timings,
  );

  await timedStep(
    "build shared workspace steps",
    async () => {
      if (
        shouldReuseExistingBuildArtifacts &&
        shouldReuseExistingRuntimeInstall
      ) {
        await ensureExistingBuildArtifacts();
        await ensureExistingRuntimeInstall();
        console.log(
          "[dist:win] reusing existing workspace builds and runtime install",
        );
        return;
      }

      for (const [command, args] of getSharedBuildSteps({ repoRoot })) {
        const isBuildStep =
          args.includes("build") &&
          (args.includes("@nexu/dev-utils") ||
            args.includes("@nexu/shared") ||
            args.includes("@nexu/controller"));
        const isRuntimeInstallStep = args.includes("openclaw-runtime:install");

        if (isBuildStep && shouldReuseExistingBuildArtifacts) {
          continue;
        }

        if (isRuntimeInstallStep && shouldReuseExistingRuntimeInstall) {
          continue;
        }

        await run(command === "pnpm" ? pnpmCommand : command, args, { env });
      }
    },
    timings,
  );
  await timedStep(
    "build @nexu/web",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await timedStep(
        "build @nexu/web:tsc",
        async () => {
          await run(
            pnpmCommand,
            ["--dir", repoRoot, "--filter", "@nexu/web", "exec", "tsc", "-b"],
            { env: buildCapabilities.webBuildEnv },
          );
        },
        timings,
      );
      await timedStep(
        "build @nexu/web:vite",
        async () => {
          await run(
            pnpmCommand,
            [
              "--dir",
              repoRoot,
              "--filter",
              "@nexu/web",
              "exec",
              "vite",
              "build",
            ],
            { env: buildCapabilities.webBuildEnv },
          );
        },
        timings,
      );
    },
    timings,
  );
  await timedStep(
    "build @nexu/desktop",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await run(pnpmCommand, ["run", "build"], { cwd: electronRoot, env });
    },
    timings,
  );
  await timedStep(
    "prepare runtime sidecars",
    async () => {
      if (shouldReuseExistingSidecars) {
        await ensureExistingSidecars(runtimeDistRoot, {
          allowUnarchivedOpenclaw: allowUnarchivedOpenclawSidecar,
        });
        console.log("[dist:win] reusing existing prepared runtime sidecars");
        return;
      }

      await run(
        "node",
        [resolve(scriptDir, "prepare-runtime-sidecars.mjs"), "--release"],
        {
          cwd: electronRoot,
          env: {
            ...buildCapabilities.sidecarReleaseEnv,
            ...(localMode
              ? {
                  NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR: "false",
                }
              : {}),
          },
        },
      );
    },
    timings,
  );
  await timedStep(
    "generate build config",
    async () => {
      await ensureBuildConfig();
    },
    timings,
  );
  await timedStep(
    "dereference pnpm symlinks",
    async () => {
      await dereferencePnpmSymlinks();
    },
    timings,
  );

  const electronVersion = await timedStep(
    "resolve electron version",
    async () => getElectronVersion(),
    timings,
  );
  const buildVersion = await timedStep(
    "resolve windows build version",
    async () => getWindowsBuildVersion(),
    timings,
  );

  await timedStep(
    "run electron-builder",
    async () => {
      const electronBuilderArgs = [
        ...buildCapabilities.createElectronBuilderArgs({
          electronVersion,
          buildVersion,
          dirOnly,
        }),
        ...(localMode
          ? ["--config.npmRebuild=false", "--config.nodeGypRebuild=false"]
          : []),
      ];
      await runElectronBuilder(electronBuilderArgs, {
        cwd: electronRoot,
        env: {
          ...electronBuilderEnv,
          DEBUG:
            electronBuilderEnv.DEBUG ?? "electron-builder,electron-builder:*",
          ...(windowsPwdShimDir
            ? {
                PATH: `${windowsPwdShimDir};${electronBuilderEnv.PATH ?? process.env.PATH ?? ""}`,
              }
            : {}),
        },
      });
    },
    timings,
  );
  await timedStep(
    "clean release intermediates",
    async () => {
      await cleanupReleaseIntermediates(releaseRoot);
    },
    timings,
  );

  console.log("[dist:win][timing] summary");
  for (const timing of timings) {
    console.log(
      `[dist:win][timing] ${timing.stepName}=${formatDurationMs(timing.durationMs)}`,
    );
  }
}

await main();
