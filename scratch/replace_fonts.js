import { readFileSync, writeFileSync } from 'fs';

const file = 'src/style.css';
let css = readFileSync(file, 'utf8');

// Replace hardcoded Press Start 2P with variable
// Note: keep the one with !important separate
css = css.replaceAll("font-family: 'Press Start 2P', monospace !important;", "font-family: var(--ump-font-pixel) !important;");
css = css.replaceAll("font-family: 'Press Start 2P', monospace;", "font-family: var(--ump-font-pixel);");

// Replace hardcoded VT323 with variable
css = css.replaceAll("font-family: 'VT323', 'Courier New', monospace;", "font-family: var(--ump-font-body);");
css = css.replaceAll("font-family: 'VT323', monospace;", "font-family: var(--ump-font-body);");

writeFileSync(file, css, 'utf8');

// Count remaining references
const remaining = (css.match(/'Press Start 2P'/g) || []).length;
const remainingVT = (css.match(/'VT323'/g) || []).length;
console.log(`Replaced Press Start 2P references. Remaining: ${remaining}`);
console.log(`Replaced VT323 references. Remaining: ${remainingVT}`);
