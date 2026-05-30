import puppeteer from 'puppeteer-core';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = '5173';
const url = `http://localhost:${port}/`;

async function run() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  const page = await browser.newPage();
  
  // Track console logs
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));

  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Helper to get element info under the tab buttons
  async function checkTabButtonInterception() {
    return await page.evaluate(() => {
      const tabs = ['play', 'leaderboard', 'stats'];
      const results = {};
      tabs.forEach(t => {
        const id = `tab-btn-${t}`;
        const btn = document.getElementById(id);
        if (!btn) {
          results[id] = { error: 'Not found' };
          return;
        }
        const rect = btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const elementAtPoint = document.elementFromPoint(centerX, centerY);
        
        results[id] = {
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            bottom: rect.bottom,
            right: rect.right
          },
          centerX,
          centerY,
          elAtPoint: elementAtPoint ? {
            id: elementAtPoint.id,
            tagName: elementAtPoint.tagName,
            className: elementAtPoint.className,
            outerHTML: elementAtPoint.outerHTML.substring(0, 100)
          } : null,
          computedStyle: {
            pointerEvents: window.getComputedStyle(btn).pointerEvents,
            zIndex: window.getComputedStyle(btn).zIndex,
            opacity: window.getComputedStyle(btn).opacity,
            display: window.getComputedStyle(btn).display
          }
        };
      });
      return results;
    });
  }

  // 1. Handle login if welcome screen is showing
  console.log('Checking for login...');
  const username = 'DIAG_UMP';
  await page.evaluate(async (uname) => {
    const handleInput = document.getElementById('login-handle');
    const pinInput = document.getElementById('login-pin');
    const btnStart = document.getElementById('btn-welcome-start');
    if (handleInput && pinInput && btnStart) {
      handleInput.value = uname;
      pinInput.value = '1234';
      btnStart.click();
      
      // Wait for create confirm
      await new Promise(r => setTimeout(r, 600));
      const btnCreate = document.getElementById('btn-login-confirm-create');
      if (btnCreate && !btnCreate.closest('.hidden')) {
        btnCreate.click();
      }
    }
  }, username);

  // Wait for transition to STATES.START or STATES.TEAM_SELECT
  console.log('Waiting for menu screen transition...');
  await page.waitForFunction(() => {
    const startScreen = document.getElementById('start-screen');
    const teamSelect = document.getElementById('team-select-screen');
    const isStartVisible = startScreen && !startScreen.classList.contains('hidden') && startScreen.classList.contains('opacity-100');
    const isTeamSelectVisible = teamSelect && !teamSelect.classList.contains('hidden') && teamSelect.classList.contains('opacity-100');
    return isStartVisible || isTeamSelectVisible;
  }, { timeout: 10000 });

  // If in team select, click confirm
  const inTeamSelect = await page.evaluate(() => {
    const teamSelect = document.getElementById('team-select-screen');
    return teamSelect && !teamSelect.classList.contains('hidden') && teamSelect.classList.contains('opacity-100');
  });

  if (inTeamSelect) {
    console.log('In favorite team select screen. Selecting team and clicking confirm...');
    await page.evaluate(() => {
      // Set favorite team and select active team
      window.selectedTeamId = 'BAL';
      // Find BAL button in grid and click it if possible
      const grid = document.getElementById('team-grid-container');
      if (grid) {
        const balBtn = Array.from(grid.querySelectorAll('[data-team-id]')).find(el => el.getAttribute('data-team-id') === 'BAL');
        if (balBtn) balBtn.click();
      }
      const btn = document.getElementById('btn-confirm-team');
      if (btn) btn.click();
    });
    console.log('Waiting for STATES.START after team select...');
    await page.waitForFunction(() => {
      const startScreen = document.getElementById('start-screen');
      return startScreen && !startScreen.classList.contains('hidden') && startScreen.classList.contains('opacity-100');
    }, { timeout: 10000 });
  }

  console.log('--- Initial State Check (Play Tab Active) ---');
  let info = await checkTabButtonInterception();
  console.log(JSON.stringify(info, null, 2));

  // 2. Click Standings
  console.log('Clicking Standings Tab with mouse...');
  const standingsBtn = await page.$('#tab-btn-leaderboard');
  await standingsBtn.click();
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 1000));

  console.log('--- After Switching to Standings Tab Check ---');
  info = await checkTabButtonInterception();
  console.log(JSON.stringify(info, null, 2));

  // 3. Try to click Play Tab using page.click (which does hit testing)
  console.log('Attempting to click Play Tab using page.click...');
  try {
    await page.click('#tab-btn-play');
    console.log('Click on Play Tab succeeded in Puppeteer!');
  } catch (err) {
    console.error('Click on Play Tab failed in Puppeteer:', err.message);
  }

  // Check state again
  await new Promise(r => setTimeout(r, 1000));
  const activeTab = await page.evaluate(() => {
    const active = document.querySelector('.ump-tab--active');
    return active ? { id: active.id, text: active.textContent } : null;
  });
  console.log('Currently active tab after click attempt:', activeTab);

  await browser.close();
}

run().catch(console.error);
