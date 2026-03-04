import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, "package.json");
    const packageJsonText = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonText) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readGitCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const buildVersion = process.env.VITE_APP_VERSION ?? readPackageVersion();
const gitCommitHash = process.env.VITE_GIT_COMMIT_HASH ?? readGitCommitHash();

export default defineConfig({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(buildVersion),
    __APP_GIT_COMMIT_HASH__: JSON.stringify(gitCommitHash),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/openapi.json": "http://localhost:3000",
    },
  },
});
