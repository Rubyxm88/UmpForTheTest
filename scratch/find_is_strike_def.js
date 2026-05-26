import fs from 'fs';
import path from 'path';

const files = ['src/js/game.js', 'src/js/scene.js', 'src/js/physics.js'];
files.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('isStrike') || line.includes('isStrikeABS')) {
      console.log(`${f} Line ${i + 1}: ${line.trim()}`);
    }
  });
});
