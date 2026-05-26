import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let list = [];
lines.forEach((line, i) => {
  if (line.includes('function startOverviewTimeBankCounter') || line.includes('function startSummaryTimerCounter')) {
    list.push(i);
  }
});

list.forEach(startLine => {
  console.log(`Found function at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 25; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
});
