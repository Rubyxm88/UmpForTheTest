# Streak Challenge Data Pipeline

## Overview

The Streak Challenge uses a **curated AB pool** of real, difficult, close-call pitches. The system:

1. **Sources** real game data from Statcast/UmpScorecard
2. **Filters** for close-call pitches (ump call ≠ correct call)
3. **Scores** each AB by difficulty (0-100, based on zone edge proximity)
4. **Stores** in Supabase `streak_at_bats` table
5. **Generates** daily rotations with progressive, non-linear difficulty
6. **Serves** to players via on-demand difficulty-matched selection

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Data Sources                                                │
│ • Statcast (MLB pitch tracking)                             │
│ • UmpScorecard (ump call tracking)                          │
│ • Baseball Savant (public query tool)                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Pipeline Scripts (scripts/)                                 │
│ • import-statcast.js: CSV → JS format                       │
│ • build-streak-pool-from-statcast.mjs: Fetch & score ABs   │
│ • generate-sample-streak-pool.mjs: Sample data for testing  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Scoring Engine (src/js/lib/streak-ab-scorer.js)             │
│ • Difficulty calculation (0-100)                            │
│ • Eligibility validation                                     │
│ • Tier grouping (1-5)                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase Storage                                            │
│ • streak_at_bats: AB pool with difficulty scores           │
│ • streak_ab_stats: Usage tracking                          │
│ • streak_daily_rotations: Daily seed & order               │
│ • streak_sessions: User game sessions                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Game Runtime (src/js/streak-rotation.js)                    │
│ • pickNextStreakAb(): Select difficulty-matched AB         │
│ • Seeded RNG: Reproducible per session                     │
│ • Session dedup: No repeats within game                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Player Experience                                           │
│ • Difficulty starts easy, trends harder                    │
│ • Random oscillation keeps it unpredictable                │
│ • Real close-call pitches (not trivial)                   │
│ • Infinite pool (never repeats within session)             │
└─────────────────────────────────────────────────────────────┘
```

## Difficulty Scoring

Each AB is scored on how difficult it is to make the correct call:

**Formula:**
```
difficulty = 70% × edgeScore + borderlineBonus + lengthBonus + criticalBonus

where:
  edgeScore = 100 - (minEdgeFt / BORDERLINE_FT) × 60
  borderlineCount = # pitches within 0.15 ft of zone edge
  borderlineBonus = min(20, borderlineCount × 6)
  lengthBonus = min(10, (pitchCount - 2) × 2)
  criticalBonus = min(10, criticalCount × 5)
```

**Close-Call Detection:**
- `calculateCrossingPoint()`: Where ball crosses plate (physics-based)
- `edgeDistanceFt()`: Distance from nearest zone boundary
- Borderline threshold: ≤ 0.15 ft from edge

**Eligibility Criteria:**
- ✓ At least 2 pitches total
- ✓ At least 1 non-swing pitch
- ✓ First pitch is not a swing
- ✓ Not all swings
- ✓ At least 1 borderline pitch in taken pitches
- ✓ At least 1 ump-correct disagreement

## Progressive Difficulty

Target difficulty **increases non-linearly** with streak position:

```javascript
const progressive = 15 + 75 * (1 - Math.exp(-i / 45));  // Exponential curve
const oscillation = 8 * Math.sin(i / 4.5);              // Wave pattern
targetDifficulty = progressive + oscillation;
```

**Effect:**
- Position 0: ~15-20 difficulty (easy start)
- Position 10: ~28-35 difficulty
- Position 20: ~38-46 difficulty
- Position 50: ~55-63 difficulty
- Position 100: ~70+ difficulty
- Oscillation: ±8 around target (unpredictable)

Looks random but averages toward harder ✓

## Data Integration Methods

### Option 1: Statcast CSV (Easy)

**Steps:**
1. Download CSV from [baseball-savant.mlb.com](https://baseballsavant.mlb.com/statcast)
   - Filters: Date range, Pitcher name, etc.
2. Run import script:
   ```bash
   node scripts/import-statcast.js \
     --input savant_data.csv \
     --output src/data/weekly_challenge.js \
     --mode weekly
   ```
3. Run pool builder:
   ```bash
   node scripts/streak-pool-builder.js
   ```

**Pros:** Simple, no API key needed  
**Cons:** Manual download, one-time only

### Option 2: Sample Data (Testing)

Generate realistic test data immediately:

```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=xxx \
node scripts/generate-sample-streak-pool.mjs --count 500
```

Creates 500 realistic close-call ABs with proper difficulty distribution.

**Pros:** Instant testing, no external APIs  
**Cons:** Not real game data

### Option 3: Statcast API (Production)

Connect to live Statcast/PyBall for automated updates:

```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=xxx \
node scripts/build-streak-pool-from-statcast.mjs --year 2024 --min-abs 500
```

**Requires:**
- Baseball-savant API credentials
- Or PyBall library setup
- Nightly/weekly cron job

**Pros:** Automated, always fresh data  
**Cons:** Requires API setup, rate limits

## Current Status

✅ **Scoring system:** Complete and tested  
✅ **Database schema:** All tables ready  
✅ **Game runtime:** Client-side picker and RNG  
❌ **Data source:** No ABs in database yet  
❌ **Admin tools:** UI for pool management  
❌ **Statcast integration:** API not connected

## Next Steps

### Immediate (This Week)
1. Run sample generator to populate test data
2. Test difficulty progression in game
3. Verify non-linear distribution feels right

### Short-term (Next Week)  
1. Build admin panel to view/manage pool
2. Connect Statcast CSV import
3. Generate first production pool from real 2024 data
4. Deploy updated pool to Vercel

### Medium-term (Later)
1. Set up automated Statcast ingestion
2. Move from JSON files to database queries
3. A/B test different difficulty curves
4. Analytics dashboard for AB usage

## Admin Panel Plan

Once we populate the pool, the admin interface will allow:

```
┌─ AB Pool Browser
│  ├─ Search by difficulty, date, pitcher, batter
│  ├─ View AB details + both ump & correct calls
│  ├─ See difficulty score breakdown
│  └─ Manually adjust if needed
│
├─ Pool Statistics
│  ├─ Distribution chart (difficulty histogram)
│  ├─ Total available ABs
│  ├─ Recently used ABs
│  └─ Coverage gaps
│
└─ Generate New Pool
   ├─ Auto-ingest from Statcast
   ├─ Review ABs before deploy
   ├─ Set min/max difficulty
   └─ Deploy to production
```

## Troubleshooting

**Q: No close-call ABs found?**  
A: Statcast API not configured. Use CSV import or sample generator instead.

**Q: Pool seems too easy/hard?**  
A: Adjust BORDERLINE_FT (0.15 ft) in streak-ab-scorer.js, or lower/raise min difficulty threshold.

**Q: Same AB appearing twice in same session?**  
A: `sessionUsedIds` Set should prevent this. Check if AB IDs are unique.

**Q: Difficulty not progressing smoothly?**  
A: Verify target difficulty formula in streak-rotation.js lines 140-145. Wave amplitude or period may need tuning.

## Files Reference

| File | Purpose |
|------|---------|
| `src/js/streak-rotation.js` | Client-side AB picker and RNG |
| `src/js/lib/streak-ab-scorer.js` | Difficulty scoring algorithm |
| `scripts/import-statcast.js` | CSV → JS format converter |
| `scripts/build-streak-pool-from-statcast.mjs` | Statcast fetch & score pipeline |
| `scripts/generate-sample-streak-pool.mjs` | Sample data generator |
| `src/data/streak_pool.js` | Embedded AB pool (JSON) |
| `src/data/streak_rotation.js` | Daily rotation metadata |

---

**Ready to start?** Run the sample generator to test immediately:
```bash
npm run build:streak-sample
```
