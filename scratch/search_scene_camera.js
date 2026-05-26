import fs from 'fs';

const sceneJs = fs.readFileSync('src/js/scene.js', 'utf8');
const lines = sceneJs.split('\n');

lines.forEach((line, i) => {
  if (line.includes('camera') || line.includes('Camera') || line.includes('zoom') || line.includes('Zoom')) {
    if (line.includes('function') || line.includes('const') || line.includes('let') || line.includes('=')) {
      console.log(`Line ${i + 1}: ${line.trim()}`);
    }
  }
});
