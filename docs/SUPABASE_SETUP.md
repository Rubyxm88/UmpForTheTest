# Supabase setup — UmpSim3000

Your Supabase project **UmpSim3000** (`wrtwqfvicftxpduukzwm`) is provisioned with:

| Table | Purpose |
|-------|---------|
| `profiles` | Handle + PIN hash + favorite team |
| `user_stats` | XP, accuracy, streaks + `stats_json` (history, daily, teams) |
| `leaderboard_entries` | Weekly / daily / all-time scores |

The game talks to **Vercel serverless routes** under `/api/*`, which use the **service role** key (never exposed to the browser).

## 1. Vercel environment variables (no plan upgrade)

Production admin **cannot save passwords** or weekly bundles until Vercel has a Supabase **service** key (not just `SUPABASE_URL`).

**Do not use** `vercel integration add supabase` for this repo. That marketplace flow **provisions a new Supabase database** through Vercel and can prompt you to **upgrade your Vercel plan**. You already have **UmpSim3000** on Supabase — only copy keys into Vercel env vars (Hobby-friendly).

### Steps

1. Supabase → [UmpSim3000 API keys](https://supabase.com/dashboard/project/wrtwqfvicftxpduukzwm/settings/api-keys) → copy **`service_role`** (secret, not `anon`).

2. In the repo, edit `.env.local`:

   ```
   SUPABASE_URL=https://wrtwqfvicftxpduukzwm.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<paste service_role here>
   ```

3. Push to Vercel and redeploy:

   ```bash
   npm run vercel:env
   npx vercel deploy --prod
   ```

4. Verify (no secrets printed):

   ```bash
   npm run vercel:supabase
   ```

Or set the same two variables manually in [Vercel → umpsim3000 → Environment Variables](https://vercel.com/randy-phillips-projects/umpsim3000/settings/environment-variables) (Production). `SESSION_SECRET` is already set.

Apply to **Production** and **Preview** if you use preview deploys.

### Vercel Supabase integration (optional, not used here)

Only use the marketplace integration if you intentionally want Vercel to bill/provision a **new** Supabase project. For **UmpSim3000**, use manual env vars above.

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

## 4. Migrations & production connector

SQL lives in `supabase/migrations/`. Remote **UmpSim3000** already has these applied; use the scripts below for new environments or drift checks.

| Command | Purpose |
|---------|---------|
| `npm run supabase:migrate` | Verify required tables exist (uses `.env.local` service key) |
| `npm run supabase:migrate -- --push` | Apply pending SQL via Supabase CLI (`db push`) |
| `npm run vercel:env` | Copy `SUPABASE_URL` + service key to Vercel **production** and **preview** |
| `npm run vercel:supabase` | Confirm Vercel production has both env vars |
| `npm run connect:prod` | Schema check → Vercel env → verify → probe `/api/weekly-challenge` |

**One-shot (recommended after pulling repo):**

```bash
cp .env.example .env.local
# paste SUPABASE_SERVICE_ROLE_KEY
npm run connect:prod
npx vercel deploy --prod
```

Link the CLI for `db push`:

```bash
npx supabase login
npx supabase link --project-ref wrtwqfvicftxpduukzwm
```

Config: `supabase/config.toml` (`project_id = wrtwqfvicftxpduukzwm`).

**Do not** use `vercel integration add supabase` for this project — it provisions a **new** database. Use manual env vars only (Hobby-friendly).

## 5. Weekly challenge admin (required on Vercel)

Production admin cannot write to `src/data/` (read-only filesystem). Apply migration `supabase/migrations/20260601120000_weekly_challenge_admin.sql`, which creates:

- `weekly_challenge_bundles` — full challenge payloads (meta + games JSON)
- `weekly_challenge_assignments` — which ISO week uses which bundle

With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set on Vercel, **Build full bundle** and **Assign** persist to Supabase. Reassigning the current week resets `leaderboard_entries` for that `period_key`.

Players load the assigned bundle at runtime via `GET /api/weekly-challenge` (no git deploy required on Vercel). The bundled `src/data/weekly_challenge.js` remains the offline fallback when Supabase is unset or no week is assigned.

Local dev still mirrors bundles to `src/data/weekly_bundles/` when the filesystem is writable.

## 7. Streak pool (20k+ path)

Migrations:

- `20260601000000_streak_pool.sql` — `streak_at_bats`, `streak_daily_rotations`
- `20260601130000_streak_analytics.sql` — `streak_ab_stats`, `streak_sessions`

After applying migrations:

```bash
npm run streak-pool:ingest   # uploads src/data/streak_pool.js → Supabase
```

Admin → **Streak pool** shows readiness, AB play stats, and logged sessions. The game still ships a small bundle (`STREAK_POOL_META.totalAbs`); full 20k requires ingest plus a future client change to load ABs via `GET /api/streak-pool?abId=…` instead of the JS bundle.

## 8. Security notes

- Do **not** commit `.env` or service role keys.
- RLS is enabled; writes go through the API with the service role.
- `leaderboard_entries` allows public **SELECT** for possible future direct reads.
