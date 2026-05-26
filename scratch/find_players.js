import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';
import { DAILY_CHALLENGE_DATA } from '../src/data/daily_challenge.js';

const pitchers = new Set();
const batters = new Set();

const addPitches = (pitches) => {
  pitches.forEach(p => {
    if (p.pitcher) pitchers.add(p.pitcher);
    if (p.batter) batters.add(p.batter);
  });
};

WEEKLY_CHALLENGE_DATA.forEach(game => addPitches(game.pitches));
addPitches(DAILY_CHALLENGE_DATA.pitches);

console.log("PITCHERS:");
console.log(JSON.stringify(Array.from(pitchers).sort()));
console.log("\nBATTERS:");
console.log(JSON.stringify(Array.from(batters).sort()));
