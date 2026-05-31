import fs from 'fs';
const t = fs.readFileSync('src/data/weekly_challenge.js', 'utf8');
const urls = [...t.matchAll(/film_room_url": "https:\/\/www\.mlb\.com\/video\/game\/(\d+)"/g)].map((m) => Number(m[1]));
console.log(JSON.stringify(urls));
