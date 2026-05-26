import fs from 'fs';

const content = fs.readFileSync('src/data/daily_challenge.js', 'utf8');

const totalMatches = content.match(/is_swing/g) || [];
const trueMatches = content.match(/"is_swing"\s*:\s*true/g) || [];

console.log('DAILY CHALLENGE PITCHES ANALYSIS:');
console.log('Total Pitches:', totalMatches.length);
console.log('Swing Pitches:', trueMatches.length);
console.log('Swing Percentage:', (trueMatches.length / totalMatches.length * 100).toFixed(2) + '%');

const contentWeekly = fs.readFileSync('src/data/weekly_challenge.js', 'utf8');
const totalMatchesWeekly = contentWeekly.match(/is_swing/g) || [];
const trueMatchesWeekly = contentWeekly.match(/"is_swing"\s*:\s*true/g) || [];

console.log('\nWEEKLY CHALLENGE PITCHES ANALYSIS:');
console.log('Total Pitches:', totalMatchesWeekly.length);
console.log('Swing Pitches:', trueMatchesWeekly.length);
console.log('Swing Percentage:', (trueMatchesWeekly.length / totalMatchesWeekly.length * 100).toFixed(2) + '%');
