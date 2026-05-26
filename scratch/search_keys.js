import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('keydown') || line.includes('keyup') || line.includes('keyCode') || line.includes('Space') || line.includes('.key ')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
