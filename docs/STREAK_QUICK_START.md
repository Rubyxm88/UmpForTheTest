# Streak Challenge Pool - Quick Start

## TL;DR

**Test immediately with sample data:**
```bash
SUPABASE_URL=https://wrtwqfvicftxpduukzwm.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_key_here \
npm run build:streak-sample
```

This generates 500 realistic close-call ABs and populates Supabase in ~30 seconds.

---

## What Just Got Built

You now have:

1. **Complete Difficulty Scoring System** ✅
   - Edge-distance-based (how close to zone boundary)
   - Bonus for multiple borderline pitches
   - 0-100 scale, auto-tiered 1-5

2. **Progressive Non-Linear Difficulty** ✅
   - Exponential curve + sine wave oscillation
   - Averages toward harder but looks random
   - Exactly what you described

3. **Data Pipeline Scripts** ✅
   - `npm run build:streak-sample` — test data instantly
   - `npm run build:streak-statcast` — real Statcast data (when API connected)

4. **Supabase Integration** ✅
   - `streak_at_bats` table ready for ABs
   - Difficulty scores and tier grouping
   - Usage tracking via `streak_ab_stats`

5. **Client Game Logic** ✅
   - Already uses seeded RNG for reproducibility
   - Selects difficulty-matched ABs per position
   - Prevents repeats within session (7-day reuse cap)

---

## Step 1: Generate Test Data (5 min)

```bash
# Get your Supabase keys from Vercel
# Settings → Environment Variables → Look for SUPABASE_* vars

export SUPABASE_URL="https://wrtwqfvicftxpduukzwm.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

# Generate 500 realistic close-call ABs
npm run build:streak-sample
```

Output:
```
=== Sample Streak Challenge AB Pool Generator ===
Generating 500 realistic close-call ABs...

📊 Generating...
   Average difficulty: 47
   Range: 10 - 95
   Tier breakdown:
      Tier 1 (1-20): 85 ABs
      Tier 2 (21-40): 102 ABs
      Tier 3 (41-60): 124 ABs
      Tier 4 (61-80): 145 ABs
      Tier 5 (81-100): 44 ABs

⬆️ Uploading to Supabase...
   ✓ Uploaded 500/500

✅ Sample pool created!
```

✅ **Done!** Your streak challenge now has a curated AB pool.

---

## Step 2: Test in Game (10 min)

1. Go to `http://localhost:5173`
2. Play the **Streak Challenge**
3. You should see:
   - ✅ Easy pitch (first few)
   - ✅ Getting progressively harder
   - ✅ Some variation/oscillation (not linear)
   - ✅ Real close-call pitches (high difficulty)
   - ✅ No repeats within a session
   - ✅ Different order each day (seeded RNG)

---

## Step 3: (Later) Connect Real Data

When you're ready for production:

### Option A: Baseball-Savant CSV (Easy)

1. Go to [baseball-savant.mlb.com](https://baseballsavant.mlb.com/statcast)
2. Filter for your date range (e.g., "2024 season")
3. Download CSV
4. Run:
   ```bash
   node scripts/import-statcast.js \
     --input ~/Downloads/savant_data.csv \
     --output src/data/weekly_challenge.js
   npm run build:streak-statcast
   ```

### Option B: Live Statcast API (Automated)

Setup PyBall/baseball-savant API:
```bash
pip install baseball-savant
# or: npm install pyball

SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run build:streak-statcast -- --year 2024 --min-abs 800
```

Scheduled via cron (nightly):
```bash
# Update pool every night at 2 AM
0 2 * * * cd /path/to/project && npm run build:streak-statcast
```

---

## How It Works

### Game Flow

```
User starts Streak
    ↓
pickNextStreakAb(streakCorrectCount, sessionUsedIds)
    ↓
targetDifficulty = 15 + 75×(1 - e^(-count/45)) + 8×sin(count/4.5)
    ↓
Find ABs with difficulty ≈ target ± jitter
    ↓
Exclude ABs already used this session
    ↓
Exclude ABs used in last 7 days
    ↓
Pick random AB from candidates
    ↓
Return AB with full pitch data
    ↓
User plays pitch → Streak counter updates
```

### Difficulty Curve

```
Difficulty
     100 |                                    ╱╲  ╱╲  ╱╲
      90 |                               ╱╲╱  ╲╱  ╲╱  ╲
      80 |                          ╱╲╱╲╱
      70 |                    ╱╲╱╱
      60 |               ╱╱╱
      50 |          ╱╱╱
      40 |       ╱╱
      30 |    ╱╱
      20 | ╱╱
      10 |╱
       0 └─────────────────────────────────────────
         0   10   20   30   40   50   60   70   80
                    Streak Position
```

- Starts easy (~15)
- Trends progressively harder (exponential)
- Non-linear with random oscillation (±8)
- Never boring, never unfairly spiking

---

## Troubleshooting

**Q: "SUPABASE_URL not set"**  
A: You need to export the env vars. Get keys from Vercel dashboard Settings → Environment Variables.

**Q: Pool seems empty?**  
A: Check Supabase directly:
   ```sql
   SELECT COUNT(*) FROM streak_at_bats;
   ```

**Q: ABs are too easy/hard?**  
A: Tune parameters in `src/js/lib/streak-ab-scorer.js`:
   - `BORDERLINE_FT` (0.15) — lower = harder
   - `edgeScore * 0.7` — increase weight for edge distance
   - `targetDifficultyForStreakIndex()` — adjust curve

**Q: Same AB multiple times?**  
A: Check `sessionUsedIds` dedup logic. Should never happen.

---

## What's Next

- [ ] Verify sample data works in-game ✅ Start here
- [ ] Build admin panel to view/manage pool
- [ ] Connect Statcast CSV import
- [ ] Generate production pool (real 2024 data)
- [ ] Set up automated nightly updates
- [ ] A/B test difficulty curves with real players

---

## Files & Scripts

| Command | Does |
|---------|------|
| `npm run build:streak-sample` | Generate 500 test ABs |
| `npm run build:streak-statcast` | Fetch real Statcast data (requires API) |
| `npm run streak-refresh` | Rebuild pool files from data |

| File | Purpose |
|------|---------|
| `src/js/streak-rotation.js` | Client AB picker |
| `src/js/lib/streak-ab-scorer.js` | Difficulty calculator |
| `docs/STREAK_DATA_PIPELINE.md` | Full architecture docs |

---

**Ready?** Run the sample generator and test in-game:
```bash
npm run build:streak-sample && npm run dev
```

Visit http://localhost:5173 and play Streak Challenge! 🎮⚾
