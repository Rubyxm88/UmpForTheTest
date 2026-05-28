import { spawn } from 'child_process';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = process.env.PORT || process.env.VITE_PORT || '5173';
const url = `http://localhost:${port}/?run_test=1`;

console.log(`Launching Chrome from: ${chromePath}`);
console.log(`Loading URL: ${url}`);

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--enable-logging=stderr',
  '--v=1',
  url
]);

let successDetected = false;
let failureDetected = false;

chrome.stdout.on('data', (data) => {
  const msg = data.toString();
  console.log(`STDOUT: ${msg.trim()}`);
});

chrome.stderr.on('data', (data) => {
  const msg = data.toString();
  // Filter and print test console statements and errors
  if (msg.includes('CONSOLE') || msg.includes('Error') || msg.includes('exception') || msg.includes('TEST:')) {
    console.log(`BROWSER_LOG: ${msg.trim()}`);
  }
  if (msg.includes('TEST: SUCCESS - All automated integration tests passed!')) {
    successDetected = true;
  }
  if (msg.includes('TEST: ERROR') || msg.includes('Uncaught') || msg.includes('exception')) {
    failureDetected = true;
  }
});

// Force exit after 35 seconds to prevent hanging
const timeoutId = setTimeout(() => {
  console.log('TEST FAILURE: Timeout reached (35s). Terminating Chrome...');
  chrome.kill();
  process.exit(1);
}, 35000);

const checkInterval = setInterval(() => {
  if (successDetected) {
    console.log('TEST SUCCESS: All integration tests passed.');
    clearTimeout(timeoutId);
    clearInterval(checkInterval);
    chrome.kill();
    process.exit(0);
  }
  if (failureDetected) {
    console.log('TEST FAILURE: Error detected during integration test.');
    clearTimeout(timeoutId);
    clearInterval(checkInterval);
    chrome.kill();
    process.exit(1);
  }
}, 500);
