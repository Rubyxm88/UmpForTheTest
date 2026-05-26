import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('weeklyPlaylistABs') || line.includes('currentPitch =') || line.includes('currentPitchIndex =')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
