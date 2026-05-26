import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function advanceGameFlow') || line.includes('const advanceGameFlow')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found advanceGameFlow at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 60; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('advanceGameFlow function not found.');
}
