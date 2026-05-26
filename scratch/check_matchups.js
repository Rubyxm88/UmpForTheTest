import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';

console.log('Checking Weekly Challenge data...');
let count = 0;
WEEKLY_CHALLENGE_DATA.forEach(game => {
  game.pitches.forEach(p => {
    if (p.pitcher === 'Zack Wheeler' && (p.batter === 'Trea Turner' || p.batter === 'Kyle Schwarber' || p.batter === 'Bryce Harper' || p.batter === 'Alec Bohm' || p.batter === 'Bryson Stott' || p.batter === 'Nick Castellanos' || p.batter === 'J.T. Realmuto' || p.batter === 'Brandon Marsh' || p.batter === 'Johan Rojas')) {
      console.log('Found teammate matchup:', p.pitcher, 'vs', p.batter, 'Pitch ID:', p.id, 'Pitch type:', p.pitch_type, 'Speed:', p.speed_mph);
      count++;
    }
  });
});
console.log('Total teammate matchups found:', count);
