import fs from 'fs';

const sceneJs = fs.readFileSync('src/js/scene.js', 'utf8');
const lines = sceneJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('Camera.position') || line.includes('Camera.lookAt')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
