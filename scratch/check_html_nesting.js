import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');

const stack = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const re = /<(\/?)div([^>]*)>/gi;
  let m;
  while ((m = re.exec(line))) {
    const close = m[1] === '/';
    const attrs = m[2] || '';
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : null;
    if (!close) stack.push({ line: i + 1, id });
    else {
      const top = stack.pop();
      if (!top) {
        console.error('Extra closing div at line', i + 1);
        process.exit(1);
      }
    }
  }
}

const summaryLine = lines.findIndex((l) => l.includes('id="ab-summary-overlay"')) + 1;
const startLine = lines.findIndex((l) => l.includes('id="ab-start-overlay"')) + 1;

console.log('ab-start-overlay opens at line', startLine);
console.log('ab-summary-overlay opens at line', summaryLine);

// Find parent chain at summary line by re-parsing simply
let depthAtSummary = 0;
let parentIds = [];
const stack2 = [];
for (let i = 0; i < summaryLine; i++) {
  const line = lines[i];
  const re = /<(\/?)div([^>]*)>/gi;
  let m;
  while ((m = re.exec(line))) {
    const close = m[1] === '/';
    const attrs = m[2] || '';
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : null;
    if (!close) stack2.push(id);
    else stack2.pop();
  }
}
console.log('Open div stack when summary starts:', stack2.filter(Boolean).slice(-5));

// Check if ab-summary is inside ab-start
let insideStart = false;
const stack3 = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('id="ab-summary-overlay"')) {
    insideStart = stack3.includes('ab-start-overlay');
    break;
  }
  const re = /<(\/?)div([^>]*)>/gi;
  let m;
  while ((m = re.exec(line))) {
    const close = m[1] === '/';
    const attrs = m[2] || '';
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : null;
    if (!close && id) stack3.push(id);
    else if (close) stack3.pop();
  }
}

console.log('ab-summary inside ab-start?', insideStart);
console.log('Remaining unclosed divs:', stack.length);
