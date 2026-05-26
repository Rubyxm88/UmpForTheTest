import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');

// Find all matches for pitcher or batter text content updates
const lines = gameJs.split('\n');
lines.forEach((line, i) => {
  if (line.includes('pitcher') || line.includes('batter') || line.includes('matchup') || line.includes('HUD') || line.includes('hud')) {
    if (line.includes('.textContent') || line.includes('.innerHTML') || line.includes('=')) {
      console.log(`Line ${i + 1}: ${line.trim()}`);
    }
  }
});
