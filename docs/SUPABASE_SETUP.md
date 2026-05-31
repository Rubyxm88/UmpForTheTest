# Supabase setup — UmpSim3000

Your Supabase project **UmpSim3000** (`wrtwqfvicftxpduukzwm`) is provisioned with:

| Table | Purpose |
|-------|---------|
| `profiles` | Handle + PIN hash + favorite team |
| `user_stats` | XP, accuracy, streaks + `stats_json` (history, daily, teams) |
| `leaderboard_entries` | Weekly / daily / all-time scores |

The game talks to **Vercel serverless routes** under `/api/*`, which use the **service role** key (never exposed to the browser).

## 1. Vercel environment variables

In [Vercel](https://vercel.com) → your project → **Settings → Environment Variables**, add:

| Name | Value |
|------|--------|
| `SUPABASE_URL` | `https://wrtwqfvicftxpduukzwm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → **Project Settings → API → service_role** (secret) |
| `SESSION_SECRET` | Long random string (e.g. `openssl rand -hex 32`) |

Apply to **Production** and **Preview**.

Redeploy after saving.

### Admin panel (`/admin`)

Apply the `admin_accounts` migration (`supabase/migrations/20260531000000_admin_accounts.sql`).

Default login until you change it: **admin** / **admin** (you will be prompted to set a new password).

Optional env overrides:

- `ADMIN_USERNAME` — default `admin`
- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` — override bootstrap credentials

Admin routes use the `ump_admin_session` cookie (separate from player `ump_session`).

## 2. Local development

**Option A — full stack (recommended)**

```bash
npm install
cp .env.example .env.local
# Fill SUPABASE_SERVICE_ROLE_KEY and SESSION_SECRET in .env.local

npx vercel dev
```

`vercel dev` serves the Vite app and `/api` routes together.

**Option B — Vite + local API (recommended for `/admin`)**

```bash
npm run dev:full
```

Runs a small Node API on port 3000 and Vite on 5173. Open admin at `http://localhost:5173/admin`.

**Option C — Vite only (no API)**

```bash
npm run dev
```

Auth, leaderboards, and `/admin` login will fail until you use `dev:full`, `dev:api`, or deploy to Vercel.

## 3. API routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/register` | POST | Create account `{ handle, pin }` |
| `/api/auth/login` | POST | Login, sets `ump_session` cookie |
| `/api/auth/logout` | POST | Clear session |
| `/api/auth/me` | GET | Current user + stats |
| `/api/stats` | GET/PUT | Load/save stats (authenticated) |
| `/api/leaderboard` | GET | `?board=weekly&username=HANDLE` |
| `/api/leaderboard` | POST | Submit score (authenticated) |

## 4. Migrations

SQL lives in `supabase/migrations/`. The initial schema was applied to your remote project via the Supabase MCP.

To link the CLI later:

```bash
npx supabase link --project-ref wrtwqfvicftxpduukzwm
```

## 5. Weekly leaderboard reset

Update `scripts/weekly-curator.js` to delete rows for the old week (or rely on `period_key` per ISO week so old weeks remain historical).

## 6. Security notes

- Do **not** commit `.env` or service role keys.
- RLS is enabled; writes go through the API with the service role.
- `leaderboard_entries` allows public **SELECT** for possible future direct reads.
