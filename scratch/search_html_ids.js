import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');

lines.forEach((line, i) => {
  if (line.includes('id="ab-') || line.includes('id="hud-') || line.includes('id="umpcard-') || line.includes('card-')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
