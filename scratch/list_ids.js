import fs from 'fs';
const html = fs.readFileSync('index.html', 'utf8');
const regex = /id="([^"]+)"/g;
const ids = [];
let match;
while ((match = regex.exec(html)) !== null) {
  ids.push(match[1]);
}
console.log("Found HTML IDs:", ids.join("\n"));
