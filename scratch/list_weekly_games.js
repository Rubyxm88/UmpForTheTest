import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';

console.log('WEEKLY_CHALLENGE_DATA games:');
WEEKLY_CHALLENGE_DATA.forEach((game, gi) => {
  console.log(`Game ${gi}: ${game.title} - Description: ${game.description} - Pitches: ${game.pitches.length}`);
  const uniqueBatters = new Set();
  const uniquePitchers = new Set();
  game.pitches.forEach(p => {
    uniqueBatters.add(p.batter);
    uniquePitchers.add(p.pitcher);
  });
  console.log(`  Pitchers:`, Array.from(uniquePitchers));
  console.log(`  Batters:`, Array.from(uniqueBatters));
});
