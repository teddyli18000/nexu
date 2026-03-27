# AGENTS.md

This file captures local guidance for the `scripts/dev` CLI surface.

## CLI style

- Keep the CLI layer simple, explicit, and easy to scan.
- Define commands inline with `cli.command(...)`; do not hide command registration behind loops or abstractions.
- Prefer direct readable control flow over reusable helpers unless repetition becomes truly costly.
- Aim for simple, clean, nearly-strong code rather than cleverness.
- Fail fast when inputs are invalid or execution breaks.
- Do not add defensive orchestration here; let logs expose errors clearly.

## Architecture split

- Keep the local-dev control plane centered in `scripts/dev/`; do not do a broad repo-wide `scripts/` migration.
- Root `package.json` provides the single external entrypoint `pnpm dev ...` and should stay thin.
- `scripts/dev/src/` is the CLI assembly layer only.
- Reusable script utilities belong in `packages/dev-utils/src/`.
- Keep command behavior thin in `scripts/dev`; move shared logic down into `@nexu/dev-utils`.
- Runtime outputs belong under `.tmp/dev/`.

## Command surface

- Keep the command surface small and intentional.
- Preferred commands are `pnpm dev start`, `pnpm dev restart`, `pnpm dev stop`, and `pnpm dev logs <web|controller>`.
- Validate behavior through the real command surface instead of temporary harness scripts.
- Before introducing desktop concerns, stabilize the controller + web workflow first.

## Runtime model

- Root entrypoint stays `pnpm dev ...`.
- The CLI executes through `pnpm --dir ./scripts/dev exec tsx ./src/index.ts`.
- `scripts/dev` may use its own `tsconfig.json` features such as `paths`.
- Logs should live under `.tmp/dev/logs/<run_id>/...`.
- Lightweight facts and state should live under `.tmp/dev/facts/`.
