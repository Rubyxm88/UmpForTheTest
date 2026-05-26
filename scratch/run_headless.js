import { spawn } from 'child_process';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://localhost:5173/?test_autostart=1';

console.log(`Launching Chrome from: ${chromePath}`);
console.log(`Loading URL: ${url}`);

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--enable-logging=stderr',
  '--v=1',
  url
]);

chrome.stdout.on('data', (data) => {
  console.log(`STDOUT: ${data.toString()}`);
});

chrome.stderr.on('data', (data) => {
  const msg = data.toString();
  // Filter out noisy chromium debug messages, keep console messages and errors
  if (msg.includes('CONSOLE') || msg.includes('Error') || msg.includes('exception') || msg.includes('TEST:')) {
    console.log(`STDERR: ${msg.trim()}`);
  }
});

setTimeout(() => {
  console.log('Terminating Chrome...');
  chrome.kill();
  process.exit(0);
}, 10000);
