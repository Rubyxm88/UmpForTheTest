import fs from 'fs';

const sceneJs = fs.readFileSync('src/js/scene.js', 'utf8');
const lines = sceneJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('ballMesh') || line.includes('SphereGeometry')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
