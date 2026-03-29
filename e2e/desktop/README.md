# Nexu Desktop E2E Automation

End-to-end test suite for the packaged desktop app. Dependencies are isolated and do not affect the main repo's `pnpm install`.

## Quick Start

```bash
cd e2e/desktop
npm install           # Install Playwright (one-time)
npm run download      # Download latest nightly DMG + ZIP (~500MB)
npm run test:smoke    # Run smoke to verify the basics
```

## Prerequisites

- macOS (ARM64 or x86_64)
- Node.js >= 22 (`nvm install 22`)
- **Accessibility permission**: System Settings → Privacy & Security → Accessibility → enable for Terminal / iTerm (required for osascript to dismiss quit dialogs)

## Test Modes

| Command | What it tests |
|---------|--------------|
| `npm run test:smoke` | DMG install → codesign verify → spctl Gatekeeper check → cold start → runtime health |
| `npm run test:login` | Smoke → click "Use Nexu Account" → browser OAuth → wait connected → workspace redirect → Agent running |
| `npm run test:model` | Smoke → fake provider setup → model A/B switch → verify runtime-model.json |
| `npm run test:update` | Smoke → version downgrade → local update feed → check + download + install |
| `npm run test:resilience` | Smoke → 5 edge-case scenarios (see details below) |
| `npm test` | All of the above (full) |
| `npm run cleanup` | Kill all Nexu processes, bootout launchd services, free ports |

## Testing Different Builds

### Nightly (default)

```bash
npm run download && npm test
```

### Beta / Stable

Override download URLs via environment variables:

```bash
# Beta
NEXU_DESKTOP_E2E_DMG_URL=https://desktop-releases.nexu.io/beta/arm64/nexu-latest-beta-mac-arm64.dmg \
NEXU_DESKTOP_E2E_ZIP_URL=https://desktop-releases.nexu.io/beta/arm64/nexu-latest-beta-mac-arm64.zip \
npm run download && npm test

# Stable
NEXU_DESKTOP_E2E_DMG_URL=https://desktop-releases.nexu.io/stable/arm64/nexu-latest-stable-mac-arm64.dmg \
NEXU_DESKTOP_E2E_ZIP_URL=https://desktop-releases.nexu.io/stable/arm64/nexu-latest-stable-mac-arm64.zip \
npm run download && npm test
```

### Local Builds (unsigned)

Copy DMG and ZIP into `artifacts/` and skip signature checks:

```bash
# Build in the main repo
pnpm dist:mac:unsigned:arm64

# Copy to E2E artifacts
cp apps/desktop/release/*.dmg apps/desktop/release/*.zip e2e/desktop/artifacts/

# Run tests (skip codesign/spctl)
cd e2e/desktop
NEXU_DESKTOP_E2E_SKIP_CODESIGN=true npm run test:model
```

### Resilience Mode (Edge Cases)

`test:resilience` verifies the app's ability to recover from abnormal conditions:

| Scenario | What it simulates | Expected behavior |
|----------|------------------|-------------------|
| **Crash Recovery** | `kill -9` the Electron main process (Force Quit simulation) | launchd services survive; app attaches or rebuilds on restart |
| **Orphan Cleanup** | Kill Electron, leave controller/openclaw as orphan processes | App detects and cleans up orphans on restart, starts fresh |
| **Port Conflict** | Occupy port 50800 with a dummy listener before launching | App detects EADDRINUSE, picks an alternative port or exits gracefully |
| **Stale State** | Write a fake `runtime-ports.json` pointing to non-existent services | App detects stale session, ignores fake state, performs fresh start |
| **Double Launch** | Start a second instance while the app is already running | Second instance exits (single-instance lock), first instance unaffected |

### Login Mode Notes

`test:login` requires completing OAuth login in a browser:

1. On first run, the script opens a browser to the nexu.io login page
2. Complete login in the browser
3. The script detects login success automatically and continues
4. Login state is persisted in `.tmp/home/` and reused across runs
5. To force re-login, delete `.tmp/home/.nexu/`

## CI

GitHub Actions workflow: `.github/workflows/desktop-e2e.yml`

### Automatic Triggers

E2E runs automatically after builds, **without blocking** the build/release status:

| Trigger | When | What it tests |
|---------|------|---------------|
| `desktop-nightly.yml` | After nightly build completes | Downloads nightly → `model` mode |
| `desktop-release.yml` | After release publishes | Downloads matching channel (beta/stable) → `model` mode |
| Scheduled | Daily at 03:00 UTC (11:00 CST) | Downloads nightly → `model` mode |

Build/Release workflows **asynchronously dispatch** the E2E workflow. E2E success/failure does not affect the build/release green status.

### Manual Trigger

When triggering manually from the GitHub Actions page, three parameters are available:

| Parameter | Options | Description |
|-----------|---------|-------------|
| **Source** | `download` (default) / `build` | `download` fetches a published build; `build` checks out the current branch and builds unsigned locally |
| **Channel** | `nightly` (default) / `beta` / `stable` | Only applies to `download` source — selects which channel to fetch |
| **Mode** | `smoke` / `login` / `model` (default) / `update` / `resilience` / `full` | Which test scenarios to run |

#### Source = download (test published builds)

```
Trigger → download signed build for the selected channel → run E2E
```

Typical use case: verify a just-published nightly/beta/stable build works correctly.

#### Source = build (test current branch)

```
Trigger → checkout current branch → pnpm install → build unsigned → run E2E (skip codesign)
```

Typical use case: verify changes on a feature branch don't break the packaged app, without publishing first.

### Failure Diagnostics

On CI failure, `captures/` is automatically uploaded as a GitHub Actions artifact (retained for 14 days). Download from the Artifacts section of the Actions run page.

### Mac mini Self-hosted Runner Setup

```bash
# One-time setup
cd e2e/desktop
npm install

# Enable Accessibility permission (System Settings → Privacy & Security → Accessibility)
# Grant permission to the GitHub Actions runner process or its parent shell

# Daily usage (CI triggers automatically, or run manually)
npm run download && npm test
```

## Diagnostics and Debugging

The test runner automatically captures diagnostics into `captures/`:

### Always Captured

| File | Content |
|------|---------|
| `captures/screen-recording.mov` | System-level full-screen recording (OS dialogs, browser login, quit prompts — all visible) |
| `captures/packaged-app.log` | Electron main process full log |
| `captures/packaged-logs/` | Desktop runtime logs |
| `captures/runtime-unit-logs/` | Per-unit logs (controller, openclaw) |
| `captures/codesign-verify.log` | codesign verification details |
| `captures/spctl-assess.log` | Gatekeeper assessment result |
| `captures/kill-all.log` | Process cleanup log |

### Captured at Test End

| File | Content |
|------|---------|
| `captures/state-snapshot/dot-nexu/config.json` | Nexu config (API keys redacted) |
| `captures/state-snapshot/openclaw-state/openclaw.json` | OpenClaw runtime config |
| `captures/state-snapshot/openclaw-state/nexu-runtime-model.json` | Currently selected model |
| `captures/state-snapshot/runtime-snapshot.txt` | Process list, port usage, launchd status, controller/openclaw health |

### Captured on Failure Only

| File | Content |
|------|---------|
| `captures/failure-screenshot.png` | System screenshot at the moment of failure |
| `captures/{scenario}-failure-screenshot.png` | Playwright screenshot of the webview page |
| `captures/{scenario}-failure-page.html` | Page HTML at failure time |

### How to Debug

1. **Watch the recording** — `screen-recording.mov` shows the entire test, including OS dialogs
2. **Check screenshots** — failure screenshots quickly reveal UI state
3. **Read packaged-app.log** — search for `error`, `fail`, `ERR_`
4. **Check state snapshot** — `runtime-snapshot.txt` shows who owns which port at failure time
5. **Check runtime-model.json** — for model switch failures, inspect `selectedModelRef`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXU_DESKTOP_E2E_DMG_URL` | nightly arm64 DMG | DMG download URL |
| `NEXU_DESKTOP_E2E_ZIP_URL` | nightly arm64 ZIP | ZIP download URL |
| `NEXU_DESKTOP_E2E_SKIP_CODESIGN` | `false` | Set to `true` to skip signature verification (for unsigned local builds) |

## Project Structure

```
e2e/desktop/
├── package.json              # Entry point: npm install / npm test / npm run download
├── .gitignore                # node_modules, artifacts, captures, .tmp
├── README.md
├── scripts/
│   ├── setup.sh              # Environment check + Playwright browser install
│   ├── download-nightly.sh   # Download signed build artifacts
│   ├── run-e2e.sh            # Main test runner (bash)
│   └── kill-all.sh           # Cleanup: launchd + processes + ports
├── tests/
│   └── packaged-e2e.mjs      # Playwright scenarios (login, model switch, update)
├── artifacts/                # Downloaded DMG/ZIP (gitignored)
├── captures/                 # Test logs and diagnostics (gitignored)
└── .tmp/                     # Persistent HOME directory for login state (gitignored)
```
