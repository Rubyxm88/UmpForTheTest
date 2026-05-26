import fs from 'fs';

const gameJs = fs.readFileSync('src/js/game.js', 'utf8');
const lines = gameJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function hideQuickPreviewPanel') || line.includes('const hideQuickPreviewPanel')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found hideQuickPreviewPanel at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 15; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('hideQuickPreviewPanel function not found.');
}
