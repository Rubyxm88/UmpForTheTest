import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('STATES.ABS_REVIEW') && (line.includes('case') || line.includes('if'))) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
