import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function showAtBatStartScreen') || line.includes('const showAtBatStartScreen')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found showAtBatStartScreen at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 50; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('showAtBatStartScreen function not found.');
}
