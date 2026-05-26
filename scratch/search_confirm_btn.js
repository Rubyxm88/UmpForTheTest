import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('btnAbStartConfirm') || line.includes('btn-ab-start-confirm') || line.includes('confirm') || line.includes('abStartConfirm')) {
    if (line.includes('addEventListener') || line.includes('document.getElementById') || line.includes('=')) {
      console.log(`Line ${i + 1}: ${line.trim()}`);
    }
  }
});
