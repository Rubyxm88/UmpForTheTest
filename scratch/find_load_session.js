import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function loadSavedSessionFromLocal') || line.includes('const loadSavedSessionFromLocal')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found loadSavedSessionFromLocal at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 40; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('loadSavedSessionFromLocal function not found.');
}
