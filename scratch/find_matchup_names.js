import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');

// Find getMatchupNames definition
const lines = gameJs.split('\n');
let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function getMatchupNames') || line.includes('const getMatchupNames')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found getMatchupNames at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 40; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('getMatchupNames function not found.');
}
