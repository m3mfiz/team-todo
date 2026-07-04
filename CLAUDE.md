# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

Run from the repo root (npm workspaces):

- `npm run dev` — server (`tsx watch` on :3002) + client (Vite on :5173, proxies `/api` → :3002) concurrently. `npm run dev:server` / `npm run dev:client` for one side.
- `npm run build` — client production build (tsc + Vite) into `packages/client/dist`. The server has **no build step** — production runs `.ts` sources via `tsx`.
- `npm run db:setup` — migrate + seed (idempotent). Requires `.env` at repo root (copy `.env.example`; `JWT_SECRET`/`JWT_REFRESH_SECRET` must be ≥32 chars and different; `ADMIN_PASSWORD` is mandatory when `NODE_ENV=production`).
- `npm test` — both suites: server (vitest, integration against a real temp SQLite per file) then client (vitest, node env + jsdom for component tests).
- Single file: `npm -w packages/server run test -- src/__tests__/tasks.test.ts`; single test: `... -- -t "name fragment"`.
- `npm run typecheck` — `tsc --noEmit` for both packages. This is the only static check (no ESLint).
- `node scripts/smoke.mjs [baseUrl]` — e2e smoke (19 checks) against a running server (default `http://127.0.0.1:3002`; pass `https://todo.ask4k.live` + `ADMIN_PASSWORD` env for prod). Self-contained: creates two throwaway members via the admin API and deletes them.

Node ≥18 locally, Node 22 in prod — dependencies are pinned to work on both (Fastify 4, not 5; Vite 5; vitest 1.x).

## Architecture

Monorepo, two npm workspaces. UI language is Russian; design language is Things 3 (binding spec: `audit/things-design-audit.md`; server/stack decisions: `audit/server-audit.md`).

### Server (`packages/server`, Fastify 4 + better-sqlite3, ESM via tsx)

Internal imports **must** include the `.ts` extension (ESM + tsx). Layering: `routes/*` parse input with Zod (body, params — never used unvalidated) and call `services/*`; services take `db` as a parameter (no module singletons — `createDb()` factory in `db/index.ts`) and throw `AppError` (`utils/errors.ts`). The global error handler in `index.ts` maps ZodError→400, AppError→its status, framework 4xx→status preserved but raw message forwarded **only for 429** (others get generic `STATUS_CODES` text), else 500. Order of those branches matters.

`buildApp({dbPath?})` in `index.ts` is the composition root: CORS, rate-limit (`global:false`, opted in per route: login 5/min, refresh 10/min, keyed by `req.ip` with `trustProxy:'loopback'` so tests fake IPs via `x-forwarded-for`), db+migrate, auth plugin, routes, push init, reminder cron (gated off under `VITEST`), static SPA serving of `client/dist` with fallback. Migrations are idempotent plain SQL in `db/index.ts::migrate` (SQLite has no `ADD COLUMN IF NOT EXISTS` — column additions are guarded via `PRAGMA table_info`).

**Auth** (`plugins/auth.ts`, `services/auth.service.ts`): 15-min access JWT + 7-day refresh JWT (separate secrets, registered as two @fastify/jwt namespaces), refresh tokens stored SHA-256-hashed with rotation; reusing a revoked token triggers **family revocation** (all the user's tokens). Refresh re-reads the user from the DB, so role changes/deletion take effect on next refresh. Unknown-username login burns a dummy bcrypt compare (timing equalization). `app.authenticate` and `app.requireAdmin` are preHandler decorators.

**Domain rules** (the core invariants — `services/task.service.ts`):
- Visibility: member sees tasks where they are assignee, creator, or `assignee_id IS NULL` ("everyone"); admin sees all. Invisible task → **404, not 403** (no existence leak). Tests lock this.
- Permissions: field edits = creator or admin; **assignee and deadline changes = admin only** (members can set a deadline at creation, never move it); status = admin/creator/assignee, or any member for everyone-tasks; delete = creator or admin.
- **Per-member completion of everyone-tasks** (`task_completions` table): a member's status PATCH on an `assignee_id IS NULL` task marks/unmarks only themselves; global status flips to `done` (entering the admin's logbook) only when **all living members** have marked it — computed inside a transaction. Unmarking reopens globally but preserves others' marks. Admin status PATCH on such tasks is a global force, marks untouched. Shared-task JSON carries `completions[]` + `myCompleted`; personal tasks never do.
- **Soft-delete of users** (`services/user-admin.service.ts`, admin routes): sets `deleted_at`, renames username to `<name>#del<id>` (frees the login), revokes refresh tokens, deletes push subscriptions, then re-sweeps open everyone-tasks. Every user-facing read (`login`, `getUserById`, `/api/users`, assignee validation, push recipients, completion counting) filters `deleted_at IS NULL`. Seeded members are **bootstrap-only**: `db/seed.ts` skips member creation if any member row exists (live or deleted) — otherwise deploys would resurrect deleted users.

**Push** (`services/push.service.ts`, `notify.service.ts`, `reminder-cron.ts`): web-push with optional VAPID env keys — missing/invalid keys silently disable every push path (and skip the `push_sent_log` dedupe claim, so enabling keys later doesn't find notifications "already sent"). New-task pushes are fire-and-forget after the 201 (recipients = assignee or everyone-except-creator; provably a subset of task visibility). Deadline reminders run daily 09:00 (process TZ, Europe/Moscow in prod) for open tasks exactly 7/3/1 days out, deduped per (task,user,kind) via `INSERT OR IGNORE` claim-then-send. Dead subscriptions (404/410) are auto-deleted.

**Tests** (`__tests__/`): each file builds a full app via `setup.ts::buildTestApp()` against a unique temp SQLite file. Every `login()` gets a unique `x-forwarded-for` (rate-limit isolation); reserve a dedicated IP when testing 429 itself. Tests read the root `.env` (so VAPID is "enabled" — notify tests inject a fake sender). The API contract is locked by tests: bare JSON shapes (array for GET /api/tasks, object for task responses), numeric ids (string `assigneeId` → 400).

### Client (`packages/client`, React 18 + Vite 5 PWA, no router/state libs)

`api.ts` — typed fetch wrapper: session in localStorage (`team-todo-session`), single-flight refresh-on-401 with retry, `onSessionLost` callback. Ids are **numbers** end-to-end; `<select>.value` is coerced with `Number()` at the boundary (regression-tested server-side).

`App.tsx` holds all state (no router — `view: 'tasks' | 'users'` + tab state). Before grouping, tasks pass through `grouping.ts::toViewTasks(tasks, {isAdmin, userId})` — a pure mapper that, for members, turns shared-task `myCompleted` into effective done-status/completion-date so `computeGroups` (also pure, tested) stays role-agnostic. Optimistic complete/reopen snapshots the **raw** task list and rolls back on error; completed rows linger ~1.4s (leaving set) before moving to Журнал.

`TaskRow.tsx`: expanding a task opens a **read-only view first** (no autofocus); editing is per-field — tap title/notes (creator/admin) or Срок/Кому rows (admin) to activate a focused control; Сохранить sends one dirty-guarded PATCH. The «Выполнение» block renders per-member completion dots for shared tasks.

PWA: `vite.config.ts` uses **injectManifest** with `src/sw.ts` (precache + push/notificationclick handlers). The config carries load-bearing Node-18 shims (`createRequire`, guarded `globalThis.crypto`, `nodeMajor` gates for minify) — don't remove them; the crypto shim must stay conditional or Node 20+ builds crash. `push.ts` handles the subscribe flow (permission via user gesture — iOS requirement; pushes on iPhone work only in the installed PWA, iOS 16.4+).

Styling: single `styles.css`, Things visual language via CSS variables with a `prefers-color-scheme: dark` true-black theme — never hardcode colors; form controls ≥16px font (iOS zoom), touch targets ≥44px.

Client tests: pure-logic tests run in node env; `api.test.ts` must NOT statically import `api.ts` (module-level localStorage read) — it uses `vi.resetModules()` + pre-seeded stubs + dynamic import per test. Component tests use jsdom (`TaskRow.test.tsx`).

## Production (todo.ask4k.live)

Host `138.16.178.200` (shared with lab-booking on :3001 — do not touch its config), user `m3mfis`, ssh alias `prod` (key `~/.ssh/id_ed25519_github`). PM2 process `team-todo` on port **3002** behind Caddy (`todo.ask4k.live` site block), TZ Europe/Moscow, SQLite in `~/team-todo/data/` (not in git). Deploy:

```bash
ssh prod 'cd ~/team-todo && git checkout -- package-lock.json && git pull --ff-only && npm install && npm run db:setup && npm run build && pm2 restart team-todo --update-env'
```

The `git checkout -- package-lock.json` is required — prod's npm rewrites the lockfile. `npm run build` runs the full typecheck (both packages) before the client build, so a type error aborts the deploy before `pm2 restart`. Prod `.env` holds real JWT/VAPID secrets and `ADMIN_PASSWORD` (chmod 600).

## Gotchas

- Node 18 `fetch` resolves `localhost` to `::1` but the server listens on IPv4 — use `127.0.0.1` in scripts.
- Killing the dev server from a script: `pkill -f '[t]sx src/index.ts'` — without the `[t]` bracket the pattern matches the invoking shell and kills it.
- Login rate-limit (5/min/IP) also catches manual curl sessions right after a smoke run — wait a minute or vary `x-forwarded-for` (only honored from loopback).
- `git push`/`pull` to GitHub from this box goes via `ssh.github.com:443` (outbound port 22 is blocked on the VPN egress; see `~/.ssh/config`).
