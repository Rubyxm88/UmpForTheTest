import fs from 'fs';

const sceneJs = fs.readFileSync('src/js/scene.js', 'utf8');
const lines = sceneJs.split('\n');

let startLine = -1;
lines.forEach((line, i) => {
  if (line.includes('function updateCameraTransition') || line.includes('const updateCameraTransition')) {
    startLine = i;
  }
});

if (startLine !== -1) {
  console.log(`Found updateCameraTransition at line ${startLine + 1}`);
  for (let i = startLine; i < startLine + 20; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} else {
  console.log('updateCameraTransition function not found.');
}
