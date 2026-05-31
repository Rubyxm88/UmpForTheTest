import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = '5182';
const url = `http://localhost:${port}/`;

async function run() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  const page = await browser.newPage();
  
  // Track console logs and errors
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER_ERROR:', err.toString()));

  // Prepopulate localStorage to skip login and ensure Orioles team
  console.log('Prepopulating localStorage...');
  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    localStorage.setItem('ump_username', 'TEST_UMP');
    localStorage.setItem('pitch_ump_favorite_team_TEST_UMP', 'Orioles');
    localStorage.setItem('pitch_ump_favorite_team', 'Orioles');
    // Pre-claim daily login bonus
    const today = new Date().toLocaleDateString();
    localStorage.setItem(`daily_login_bonus_TEST_UMP_${today}`, 'claimed');
  });

  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for the Welcome Start Button text to update (indicating initialization complete)
  console.log('Waiting for welcome screen button text to change to PRESS START [PLAY]...');
  try {
    await page.waitForFunction(() => {
      const btn = document.getElementById('btn-welcome-start');
      return btn && btn.textContent.trim() === 'PRESS START [PLAY]';
    }, { timeout: 15000 });
    console.log('Welcome start button is ready!');
  } catch (e) {
    console.log('Timeout waiting for button text update. Proceeding anyway.');
  }

  console.log('Clicking Welcome Start Button...');
  await page.click('#btn-welcome-start');

  // Wait 4 seconds for transitions to settle
  console.log('Waiting 4 seconds for transition to settle...');
  await new Promise(r => setTimeout(r, 4000));

  // Dump screens state and page-level variables
  const diagnostics = await page.evaluate(() => {
    const screens = ['welcome-screen', 'team-select-screen', 'start-screen'];
    const screenInfo = {};
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (!el) {
        screenInfo[s] = 'NOT_FOUND';
      } else {
        const style = window.getComputedStyle(el);
        screenInfo[s] = {
          classes: el.className,
          display: style.display,
          opacity: style.opacity,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          isHidden: el.classList.contains('hidden')
        };
      }
    });

    return {
      screens: screenInfo,
      localStorage: { ...localStorage },
      activeFavoriteTeam: typeof window.activeFavoriteTeam !== 'undefined' ? window.activeFavoriteTeam : 'undefined',
      currentState: typeof window.currentState !== 'undefined' ? window.currentState : 'undefined'
    };
  });
  console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

  await browser.close();
}

run().catch(console.error);
