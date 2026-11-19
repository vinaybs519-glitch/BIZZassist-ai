# Connect BizAssist to Supabase

## Supplied API configuration

Your project URL and publishable key belong in the ignored `.env.local` file. Start/dev commands load this file after `.env`. Copy `.env.local.example` to `.env.local` and replace the placeholders with your own project's public settings. Local configuration is not included in the public repository.

The requested `@supabase/supabase-js` and `@supabase/ssr` packages are installed with exact versions in the lockfile. `supabase-client.js` provides a fresh, session-isolated anonymous client and read-only connection checks. Run `npm run supabase:check`, or sign in as an administrator and open **Team & access → Supabase connection → Check connection**.

Live checks on 19 November 2026: the Auth settings API returned HTTP 200 with the supplied publishable key. A zero-row SDK query to the example `todos` table returned PGRST205 / HTTP 404: the table is missing from the exposed schema. An initial HEAD-only probe returned 204 and was not reliable; the checker now uses GET with limit 0. No live application rows were written or imported.

The copied guide is for Next.js. This application uses Node's HTTP server and plain browser JavaScript, so importing `next/headers`, adding `page.tsx`, or using Next middleware would not run. BizAssist continues using its existing server-managed HttpOnly sessions; `@supabase/ssr` is installed as requested but is not active middleware. There are no Supabase user sessions to refresh in this architecture. If migrating to Supabase Auth later, the refresh path must actually call a verified auth method and propagate the resulting cookies; constructing a client alone is insufficient.

The publishable key accesses only data allowed through Supabase's Data API/RLS. It cannot create the private schema, run its migration, or replace the PostgreSQL connection string required by the existing backend. Ticket storage therefore remains SQLite until the setup below is completed.

This integration stores users, sessions, tickets, assignments, replies, activity history and knowledge articles in **Supabase PostgreSQL**. The browser continues calling the Node backend at `/api/*`. All role and ownership checks remain on that backend. No database credential is sent to the browser.

BizAssist's existing password/session authentication is retained. This is a database integration, **not a switch to Supabase Auth**, social login, Realtime or Storage. Existing customers can retain their passwords when you import the local database.

## 1. Create or select your Supabase project

Open the [Supabase dashboard](https://supabase.com/dashboard), sign in, and create a project in your organisation (or select an existing project). Choose the project name, region and database password yourself. Use a plan appropriate for your account; no project or paid resource has been created by this code.

You can also install and connect the Supabase integration in Codex to allow assistance with project selection and applying the schema. That connection alone does not provide this local backend's database password.

## 2. Configure the backend locally

Install Node.js 24+, then run in this project folder:

```sh
npm ci
```

Copy `.env.supabase.example` to `.env`. If `.env` already exists, edit it instead of overwriting your AI settings.

In your Supabase project's **Connect** dialog, copy its **Session pooler** PostgreSQL connection string. The session pooler is suitable for this persistent Node server and commonly supports IPv4 environments. Use the exact host/user values displayed by your project. A direct connection is also supported if your network can reach it.

Put the completed string only in your local `.env`:

```dotenv
DATABASE_PROVIDER=supabase
SUPABASE_DB_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@YOUR_SESSION_POOLER_HOST:5432/postgres
DEMO_MODE=false
```

Replace the password placeholder with your database password, URL-encoding special characters. Do not paste credentials into chat or commit `.env`. The ordinary `https://...supabase.co` project URL and API keys do **not** substitute for a PostgreSQL connection string. This integration does not require an API secret or service-role key.

TLS certificate verification stays enabled. If your connection requires the Supabase root certificate, download it from your project's database connection/settings interface and set:

```dotenv
SUPABASE_SSL_CA_PATH=C:/path/to/prod-supabase.cer
```

Do not disable TLS verification to work around certificate errors.

## 3. Create the tables

```sh
npm run db:migrate
npm run db:check
```

The migration can also be pasted from `supabase/migrations/001_bizassist.sql` into Supabase's SQL Editor and run as the database owner. It creates the private `bizassist` schema and six tables. It does not modify `public` or Supabase Auth tables. It is transactional and can be reapplied without deleting existing data.

The backend uses the database-owner connection from the Connect dialog. That credential is powerful: keep it server-only. Browser/API roles have no access to the schema or tables, and row-level security is enabled without public policies. The backend enforces application permissions before every protected operation. Do not add `bizassist` to the Data API's exposed schemas.

## 4. Optional: import your existing local data

Do this **after migration and before starting the server against Supabase**. The target tables must be empty, including knowledge articles. Stop the old app while importing to avoid a changing source database. Keep a backup of the SQLite database.

```sh
npm run db:import-sqlite -- ./data/bizassist.db
```

The importer copies accounts with their existing password hashes, articles, tickets, messages and events. It preserves record IDs and resets PostgreSQL identity sequences. Existing login sessions are not copied; users sign in again. The source database is opened read-only. An import into nonempty target tables is rejected; existing cloud data is never overwritten. Inserts are committed together or rolled back on failure.

If you import demo accounts, their known demo passwords remain valid. For a real deployment, use a fresh database and register real accounts instead of importing demo data.

## 5. Start and verify

```sh
npm start
```

Open the local address printed by the server. In a fresh database, register your customer account. Then use a separate terminal in the project folder:

```sh
npm run admin:promote -- you@example.com
```

Sign out and sign in to see the administrator workspace. Register other users through the app and assign staff roles in Team & access.

Create a ticket and post a reply. In Supabase's Table Editor, select the **bizassist** schema and inspect `tickets` and `messages`. Or use SQL Editor:

```sql
select id, subject, status, customer_id, assignee_id, updated_at
from bizassist.tickets order by id desc;

select id, ticket_id, user_id, body, created_at
from bizassist.messages order by id desc;
```

`GET /api/health` reports `{"status":"ok","database":"supabase"}` only after a successful database query. During connection failures it reports HTTP 503. `npm run db:check` prints table row counts without displaying credentials. Supabase mode never silently switches to SQLite when a connection fails.

## Deployment

Supabase hosts the database; it does not automatically host this Node website. Deploy the Node application separately and configure the same server environment variables there. Use HTTPS and `COOKIE_SECURE=true` for the deployed app. Continue using `COOKIE_SECURE=false` only for local HTTP development. `npm ci --omit=dev` installs the production PostgreSQL driver without the test database.

Backups/retention and external AI settings remain your project settings. Process-local rate limits are intended for the existing single-server deployment; use a shared rate-limit store before scaling to multiple servers.

## Testing and current status

`npm test` runs both local SQLite and embedded PostgreSQL integration tests. It checks the same migration, SQL adapter, role isolation, session lifecycle, ticket workflow and import logic without connecting to your live Supabase project. Live connection/TLS verification still requires your configured project connection string. No live project connection is claimed until `db:check` succeeds against it.

References: [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres TLS configuration](https://node-postgres.com/features/ssl).
