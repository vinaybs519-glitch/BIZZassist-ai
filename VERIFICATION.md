# Verification

Verified on 18 November 2026 using Node.js 24.20.0 on Windows.

- Latest `npm test` after Supabase client integration: **17 passed, 0 failed**.
- `node --check public/app.js`: passed.
- Running server homepage: HTTP **200** on local port 3217.
- Tests cover authentication/logout, customer isolation, privilege restrictions, registration, ticket creation/classification, assignment, workflow validation, replies/reopening, event history, article management, role management, cross-origin rejection, SQLite persistence and AI provider failure/malformed-output fallback.

The first test attempt was blocked from accessing its temporary local HTTP server by the execution environment. The complete test suite passed after local networking was permitted.

The earlier browser connection problem was resolved by starting the preview with local network access. Actual browser checks passed: administrator sign-in/team view, logout, customer sign-in after switching roles, ticket submission, saved conversation reply, dialog cleanup, and knowledge chatbot answers with source links. Desktop and 390 × 844 mobile dashboards were inspected visually.

## Fixes in this review

- Reset account pages, filters and chat state between accounts.
- Removed demo sign-in buttons from registration, where required name validation blocked them.
- Cleared modal scroll locks on screen changes and guarded error rendering after session expiry or dialog closure.
- Restored the AI refresh button after failures.
- Rejected malformed user/article/assignee IDs and malformed origins with client errors.
- Returned 404 for nonexistent article edits/deletions instead of falsely reporting success.
- Used offline fallback for non-string or empty provider content.
- Limited analysis payloads to subject/body instead of the entire internal ticket record.
- Added default-port fallback and readable startup errors for busy configured ports.

New regression tests cover malformed AI responses, invalid IDs, missing articles, malformed origins and startup port conflicts. Browser verification tickets exist only in the local preview database; the ZIP excludes databases and secrets. Browser checks cover representative flows, not every browser/device combination.

No live AI-provider request was made because no provider credential was supplied. The offline assistant and failure fallback were tested. Configure an available provider model and credential to verify live model behavior.

This is a runnable local project, not a hosted deployment. Read README.md for production setup requirements and the scope of implemented features.

## Supabase integration — 19 November 2026

- Added selectable SQLite / Supabase PostgreSQL backend with bound SQL parameters and verified TLS.
- Tested the migration against embedded PostgreSQL (PGlite), including repeat application and denied access for anon/authenticated/service_role API roles.
- Tested PostgreSQL login, registration, customer isolation, staff assignment/status changes, replies, AI summary refresh, knowledge writes, role updates, logout and health checks through the HTTP backend.
- Tested SQLite-to-PostgreSQL import, password-hash preservation, ID sequence reset and refusal to overwrite nonempty target tables.
- Live Supabase account/project creation, credentials, pooler networking and TLS have not been verified. The Supabase integration is not yet connected in this chat, and no connection string has been supplied.

## Supplied publishable key

- Installed exact versions of `@supabase/supabase-js` and `@supabase/ssr`; configured the supplied public project credentials in ignored `.env.local`.
- Live Supabase Auth settings request: HTTP 200.
- Live zero-row Data API/SDK read of `public.todos`: HTTP 404 / PGRST205 (table missing). No rows were read, created or changed.
- Added administrator-only connection diagnostics to the website. It distinguishes public API checks from active ticket storage.
- Three additional tests cover configuration validation, secret-key rejection, isolated clients, diagnostic status and outage handling.
- The PostgreSQL connection string remains absent, so live tickets still use SQLite. Supabase SSR auth is not activated; current application sessions remain authoritative.
