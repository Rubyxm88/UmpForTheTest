import fs from 'fs';

const sceneJs = fs.readFileSync('src/js/scene.js', 'utf8');
const lines = sceneJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function createBaseballTexture') || line.includes('const createBaseballTexture')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found createBaseballTexture at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 30; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('createBaseballTexture function not found.');
}
