# BizAssist AI

A responsive customer support application with customer, staff and administrator workspaces. Built with Node.js 24, a lightweight browser interface, and either local SQLite or Supabase PostgreSQL. No frontend build step required.

For the cloud database setup and existing-data import, see **[SUPABASE.md](SUPABASE.md)**.

## Start

1. Install Node.js **24 or later**.
2. Open a terminal in this folder.
3. Run `npm ci` to install the locked dependencies.
4. Optionally copy `.env.example` to `.env` and edit the settings. For Supabase, follow SUPABASE.md instead.
5. Run `npm start`.
6. Visit the local address printed by the server (normally **http://127.0.0.1:3000**).

Run `npm test` for automated integration tests. `npm run dev` also starts the app; restart the process after server edits and refresh the browser after interface edits.

If the default port 3000 is busy, the app tries the next ten ports and prints the actual address. An explicitly configured PORT is respected; if busy, it produces a readable error. Change PORT in .env and restart.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | customer@bizassist.demo | BizAssist123! |
| Support staff | staff@bizassist.demo | BizAssist123! |
| Administrator | admin@bizassist.demo | BizAssist123! |

Demo accounts and six sample tickets are created only if the user table is empty and `DEMO_MODE` is not `false`. New registrations always receive the customer role. An administrator can promote registered users from Team & access. The demo buttons appear only in demo mode.

## What works

- Registration, password hashing using salted scrypt, server-side sessions with HttpOnly cookies, sign-in and sign-out.
- Customer-specific ticket access. Staff and administrators can manage all tickets; only administrators manage roles and knowledge articles.
- Ticket submission, search, priority/status filters, assigned-to-me view, assignment, conversation replies, event history, and dashboard totals.
- Status workflow: Open → In Progress / Waiting / Resolved; In Progress → Open / Waiting / Resolved; Waiting → Open / In Progress / Resolved; Resolved → Open / Closed; Closed → Open. Customer replies reopen resolved or closed tickets.
- AI classification and priority on creation, summaries, editable reply suggestions, and summary/draft refresh using recent replies. Suggested replies are never automatically sent.
- Searchable knowledge base, administrator article creation/editing/deletion, and a chatbot with linked source articles.
- SQLite persistence at `data/bizassist.db` by default, or Supabase PostgreSQL for all application data. Database files and credentials are excluded from version control.
- Responsive layouts, keyboard-operable ticket rows, labelled forms, modal focus trapping, error messages and empty states.

## AI provider configuration

Offline mode is the default and needs no key. It uses keyword classification, urgency rules, an extractive summary, a reply template and keyword retrieval from knowledge articles. It is intentionally labelled **Offline assistant** / **Offline knowledge search**; it is not a language model.

For an OpenAI-compatible provider, configure the server environment:

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=your-provider-model-id
AI_API_KEY=your-secret-key
```

The provider must implement `POST /chat/completions` with the messages format. Keys stay on the server. Ticket subject/body and up to ten recent conversation messages may be sent for analysis; chatbot requests send the question and relevant knowledge articles. Inform your users before enabling external processing. Requests time out after 12 seconds. Missing keys, network failures, non-success responses and invalid analysis JSON automatically use the offline fallback. AI-generated content should be reviewed for accuracy. The chatbot has no account access and cannot perform actions. Its conversation remains in browser memory until logout/reload; ticket conversations persist in the selected database.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| PORT | 3000 | Listening port |
| HOST | 127.0.0.1 | Bind address; use 0.0.0.0 for a container |
| DATABASE_PATH | project/data/bizassist.db | Persistent SQLite file |
| DATABASE_PROVIDER | sqlite | sqlite or supabase |
| SUPABASE_DB_URL | empty | Server-only PostgreSQL connection URL |
| SUPABASE_SSL_CA_PATH | empty | Optional trusted Supabase root certificate path |
| DEMO_MODE | true for SQLite; false for Supabase | Demo seeding and demo sign-in buttons |
| COOKIE_SECURE | false | Set true when served over HTTPS |
| AI_PROVIDER | offline | offline or openai-compatible |
| AI_BASE_URL | https://api.openai.com/v1 | Trusted provider API base URL |
| AI_MODEL | gpt-4o-mini | Provider model ID; configure an available model |
| AI_API_KEY | empty | Server-only provider credential |

## Non-demo setup

Set `DEMO_MODE=false` and use a fresh database path. Register your first account, stop the server, then run:

```sh
node scripts/promote-admin.js you@example.com
```

This explicit local administration command promotes an existing registered user; it does not create a public administrator signup route. It reads `.env` automatically. Restart the server and sign in.

## Deployment and operations

This deliverable runs locally; no hosted deployment is included. For deployment, run Node 24 with a persistent writable volume for SQLite, place it behind HTTPS, set `COOKIE_SECURE=true`, disable demo mode and use a new database. Preserve the original Host/Origin relationship at the reverse proxy. Back up SQLite using SQLite's backup facilities or stop the app before copying its database files (WAL files may contain recent changes). Do not commit `.env` or databases. All app instances need access to the same database; this version is designed for a single server.

Authentication/AI rate limits are per-process and reset on restart. Sessions expire after 24 hours. Role changes take effect immediately because the server checks the database on each request. The app uses prepared queries, output escaping, JSON-only mutation routes, same-origin mutation checks, a restrictive content security policy and request-size limits.

Before using for a public business service, add your organisation's email verification, password recovery, MFA, monitoring, retention policies and deployment-specific abuse controls. There is no email delivery, attachment upload, billing integration or automatic SLA system. Account recovery currently requires an administrator/support process. Demo totals are calculated from stored tickets, not simulated operational metrics.

## Project structure

```text
server.js                 HTTP API, sessions and permissions
database.js               SQLite / Supabase PostgreSQL adapter
supabase/migrations/      Private cloud schema and access restrictions
SUPABASE.md               Cloud setup, migration and import instructions
ai.js                     Provider adapter, offline analysis and knowledge search
public/index.html         Application document
public/app.js             Role-aware interface and application flows
public/style.css          Responsive design system
scripts/promote-admin.js  Initial administrator setup
tests/app.test.js         Integration, security, persistence and AI fallback tests
```

Tests use isolated in-memory or temporary databases and do not modify the running application's data. Node may print an experimental SQLite warning depending on your Node version.
