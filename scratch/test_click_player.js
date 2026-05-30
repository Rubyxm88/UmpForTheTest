import puppeteer from 'puppeteer-core';

async function run() {
  console.log("Launching headless Chrome...");
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    defaultViewport: {
      width: 375,
      height: 812,
      isMobile: true,
      hasTouch: true
    }
  });

  const page = await browser.newPage();
  
  // Track console messages and errors
  const errors = [];
  page.on('console', msg => {
    console.log('BROWSER_CONSOLE:', msg.text());
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    console.log('BROWSER_PAGE_ERROR:', err.message);
    errors.push(err.message);
  });

  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');

  // Go to site (Vite dev server runs on 5173 by default)
  console.log("Navigating to http://localhost:5173/ ...");
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });

  // Setup localStorage and profile in IndexedDB directly to bypass login UI completely
  console.log("Bypassing login...");
  await page.evaluate(async () => {
    localStorage.setItem('ump_username', 'UMP_RUBY');
    localStorage.setItem('pitch_ump_favorite_team_UMP_RUBY', 'Orioles');
    localStorage.setItem('pitch_ump_favorite_team', 'Orioles');
    localStorage.setItem('pitch_ump_last_handle', 'UMP_RUBY');
    
    const { saveProfile, hashPIN } = await import('/src/js/db.js');
    const pinHash = await hashPIN('1234');
    await saveProfile({
      handle: 'UMP_RUBY',
      pinHash: pinHash,
      xp: 230,
      level: 1,
      favoriteTeam: 'Orioles',
      overallAccuracy: 95,
      maxStreak: 12,
      completedWeekly: 1,
      dnfs: 0,
      history: []
    });
  });

  console.log("Reloading page with active session...");
  await page.reload({ waitUntil: 'networkidle2' });

  // Wait a short moment
  await new Promise(r => setTimeout(r, 1000));

  // Click start button on Welcome Screen to transition to Dashboard
  console.log("Clicking Start button...");
  await page.evaluate(() => {
    const btn = document.getElementById('btn-welcome-start');
    if (btn) btn.click();
  });

  // Wait for Dashboard to load
  await page.waitForFunction(() => {
    const el = document.getElementById('start-screen');
    return el && !el.classList.contains('hidden') && window.getComputedStyle(el).display !== 'none';
  }, { timeout: 5000 });

  // Click start Weekly Challenge
  console.log("Starting weekly challenge...");
  await page.evaluate(() => {
    const btn = document.getElementById('btn-start-weekly-challenge');
    if (btn) btn.click();
  });
  
  // Wait for matchup overlay to show up
  console.log("Waiting for matchup overlay...");
  await page.waitForFunction(() => {
    const el = document.getElementById('ab-start-overlay');
    return el && !el.classList.contains('hidden') && window.getComputedStyle(el).opacity !== '0';
  }, { timeout: 5000 });

  // Check the element contents of the pitcher card
  const cardDetails = await page.evaluate(() => {
    const card = document.getElementById('ab-start-pitcher-card');
    const nameEl = document.getElementById('ab-start-pitcher');
    const handEl = document.getElementById('ab-start-pitcher-hand');
    return {
      cardExists: !!card,
      cardCursor: card ? card.style.cursor : null,
      nameText: nameEl ? nameEl.textContent : null,
      handText: handEl ? handEl.textContent : null,
    };
  });
  console.log("Card details before click:", cardDetails);

  // Click the Pitcher player card to open the popout
  console.log("Clicking Pitcher card...");
  await page.click('#ab-start-pitcher-card');

  // Wait a moment for layout updates
  await new Promise(r => setTimeout(r, 500));

  // Inspect the popout container
  const popoutDetails = await page.evaluate(() => {
    const popout = document.querySelector('#ab-start-pitcher-card .player-card-popout');
    if (!popout) return { exists: false };
    const rect = popout.getBoundingClientRect();
    const closeBtn = popout.querySelector('.btn-close-popout');
    const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
    return {
      exists: true,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      closeBtnExists: !!closeBtn,
      closeBtnRect: closeRect ? { x: closeRect.x, y: closeRect.y } : null
    };
  });
  console.log("Popout details after click:", JSON.stringify(popoutDetails, null, 2));

  if (!popoutDetails.exists) {
    throw new Error("FAIL: Popout did not open on pitcher card click.");
  }

  // Click the close button inside the popout
  console.log("Clicking popout close button...");
  await page.click('#ab-start-pitcher-card .btn-close-popout');
  await new Promise(r => setTimeout(r, 500));

  // Verify if popout is removed
  const popoutRemoved = await page.evaluate(() => {
    return !document.querySelector('#ab-start-pitcher-card .player-card-popout');
  });
  console.log("Popout successfully removed after close click:", popoutRemoved);
  if (!popoutRemoved) {
    throw new Error("FAIL: Popout was not removed after close button click.");
  }

  // Re-open by clicking card again
  console.log("Clicking Pitcher card to re-open...");
  await page.click('#ab-start-pitcher-card');
  await new Promise(r => setTimeout(r, 500));

  // Click outside (e.g. click the title) to test dismissal
  console.log("Clicking outside the card (on title)...");
  await page.click('#ab-start-title');
  await new Promise(r => setTimeout(r, 500));

  // Verify if popout is dismissed
  const popoutDismissed = await page.evaluate(() => {
    return !document.querySelector('#ab-start-pitcher-card .player-card-popout');
  });
  console.log("Popout successfully dismissed after click outside:", popoutDismissed);
  if (!popoutDismissed) {
    throw new Error("FAIL: Popout was not dismissed after clicking outside.");
  }

  console.log("Errors detected:", errors);

  await browser.close();
}

run().catch(err => {
  console.error("Script execution error:", err);
  process.exit(1);
});
