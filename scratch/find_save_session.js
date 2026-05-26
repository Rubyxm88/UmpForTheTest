import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function saveChallengeSessionToLocal') || line.includes('const saveChallengeSessionToLocal')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found saveChallengeSessionToLocal at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 30; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('saveChallengeSessionToLocal function not found.');
}
