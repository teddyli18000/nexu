# Frontend

## Stack

React 19 + Ant Design + Vite 6. React Router for routing, React Query for server state, better-auth client for sessions.

## API client

Always use the generated SDK from `apps/web/lib/api/`. Never use raw `fetch`.

The SDK is generated from the API's OpenAPI spec:

1. API defines Zod schemas → auto-generates OpenAPI spec
2. `pnpm generate-types` runs `@hey-api/openapi-ts` → generates TypeScript client at `apps/web/lib/api/`
3. Frontend imports from generated `sdk.gen.ts`

After any API route/schema change: `pnpm generate-types` then `pnpm typecheck`.

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Landing | Public info page |
| `/auth` | Auth | Register / login |
| `/invite` | Invite | Invite code registration |
| `/workspace/bot` | Bot Config | Bot creation and settings |
| `/workspace/channels` | Channels | Connected Slack workspaces, "Add to Slack" |
| `/workspace/channels/slack/callback` | OAuth Callback | Handles Slack redirect |

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

## Conventions

- **State:** React Query for all server state. No manual `fetch` + `useState` patterns.
- **Auth:** `apps/web/src/lib/auth-client.ts` for session management.
- **Toasts:** sonner. **Icons:** lucide-react.
- **Styling:** Tailwind CSS + Ant Design components.
- **Components:** Reusable UI components in `src/components/ui/` (Radix UI primitives).

## Key files

- `src/main.tsx` — React entry point
- `src/app.tsx` — Router setup
- `src/lib/auth-client.ts` — better-auth client
- `lib/api/` — Auto-generated SDK (do not edit manually)

## Debug Panel (Dev only)

A floating Debug Panel is integrated in `apps/web/src/main.tsx` and rendered only when:

- `import.meta.env.DEV === true`
- `VITE_DEBUG_PANEL_ENABLED !== "false"`

### Features

- Environment info: mode, build version, git commit hash
- API monitor: recent request list (URL, status, duration, request/response payload)
- State tree viewer: expandable nested objects
- Web Vitals: FCP / LCP / CLS
- Console capture: `console.log/warn/error`

### Shortcut

- Toggle visibility: `Ctrl + Shift + D`

### Reporting API

Use the API in `apps/web/src/lib/debug-panel.ts` from any component:

```ts
import { reportDebugState } from "@/lib/debug-panel";

reportDebugState("feature.checkout", {
  step: "payment",
  selectedPlan: "pro",
  isSubmitting: false,
});
```

Useful exports:

- `reportDebugState(path, value)`
- `clearDebugState(path?)`
- `reportDebugApiRequest(payload)` (manual reporting if needed)
- `reportDebugConsole(level, args)` (manual reporting if needed)
