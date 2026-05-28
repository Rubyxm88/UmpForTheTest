import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const gameJs = fs.readFileSync('src/js/game.js', 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...gameJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]));

const missing = [...jsIds].filter((id) => !htmlIds.has(id)).sort();

console.log('JS getElementById count:', jsIds.size);
console.log('HTML id count:', htmlIds.size);
console.log('\nReferenced in JS but MISSING from HTML:');
missing.forEach((id) => console.log('  -', id));
