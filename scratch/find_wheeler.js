import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';
import { DAILY_CHALLENGE_DATA } from '../src/data/daily_challenge.js';
import { ORIOLES_GAME_DATA } from '../src/data/orioles_game.js';
import { PITCH_DATA } from '../src/data/pitches.js';

console.log('Searching in WEEKLY_CHALLENGE_DATA...');
if (Array.isArray(WEEKLY_CHALLENGE_DATA)) {
  WEEKLY_CHALLENGE_DATA.forEach((game, gi) => {
    if (Array.isArray(game.pitches)) {
      game.pitches.forEach((p, pi) => {
        if (p.pitcher && p.pitcher.includes('Wheeler') && p.batter && p.batter.includes('Turner')) {
          console.log(`Weekly Challenge Game ${gi} (pitch ${pi}, ID ${p.id}): ${p.pitcher} vs ${p.batter}`);
        }
      });
    }
  });
}

console.log('Searching in DAILY_CHALLENGE_DATA...');
const dailyPitches = Array.isArray(DAILY_CHALLENGE_DATA) ? DAILY_CHALLENGE_DATA : (DAILY_CHALLENGE_DATA && DAILY_CHALLENGE_DATA.pitches);
if (Array.isArray(dailyPitches)) {
  dailyPitches.forEach((p, pi) => {
    if (p.pitcher && p.pitcher.includes('Wheeler') && p.batter && p.batter.includes('Turner')) {
      console.log(`Daily Challenge (pitch ${pi}, ID ${p.id}): ${p.pitcher} vs ${p.batter}`);
    }
  });
}

console.log('Searching in ORIOLES_GAME_DATA...');
const oriolesPitches = Array.isArray(ORIOLES_GAME_DATA) ? ORIOLES_GAME_DATA : (ORIOLES_GAME_DATA && ORIOLES_GAME_DATA.pitches);
if (Array.isArray(oriolesPitches)) {
  oriolesPitches.forEach((p, pi) => {
    if (p.pitcher && p.pitcher.includes('Wheeler') && p.batter && p.batter.includes('Turner')) {
      console.log(`Orioles Game (pitch ${pi}, ID ${p.id}): ${p.pitcher} vs ${p.batter}`);
    }
  });
}

console.log('Searching in PITCH_DATA...');
const pitchDataPitches = Array.isArray(PITCH_DATA) ? PITCH_DATA : (PITCH_DATA && PITCH_DATA.pitches);
if (Array.isArray(pitchDataPitches)) {
  pitchDataPitches.forEach((p, pi) => {
    if (p.pitcher && p.pitcher.includes('Wheeler') && p.batter && p.batter.includes('Turner')) {
      console.log(`Pitch Data (pitch ${pi}, ID ${p.id}): ${p.pitcher} vs ${p.batter}`);
    }
  });
}
console.log('Done searching.');
