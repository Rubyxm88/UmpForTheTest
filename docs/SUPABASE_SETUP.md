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

## 2. Local development

**Option A — full stack (recommended)**

```bash
npm install
cp .env.example .env.local
# Fill SUPABASE_SERVICE_ROLE_KEY and SESSION_SECRET in .env.local

npx vercel dev
```

`vercel dev` serves the Vite app and `/api` routes together.

**Option B — Vite only (no API)**

```bash
npm run dev
```

Auth and leaderboards will not sync until you use `vercel dev` or deploy to Vercel.

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
