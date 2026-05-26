import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('wasSwingContact') || line.includes('isSwingPlay') || line.includes('contact') || line.includes('swing') || line.includes('GROUNDOUT')) {
    if (line.includes('if') || line.includes('const') || line.includes('let') || line.includes('=')) {
      console.log(`Line ${i + 1}: ${line.trim()}`);
    }
  }
});
