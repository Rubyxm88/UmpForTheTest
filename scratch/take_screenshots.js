import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:\\Users\\endsi\\.gemini\\antigravity\\brain\\fee9ab02-867d-44c5-b0e5-f7fe8e1fa60e';

// Ensure dir exists
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

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
  page.on('console', msg => console.log('BROWSER_CONSOLE:', msg.text()));

  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');

  // Go to site
  console.log("Navigating to http://localhost:5182/ ...");
  await page.goto('http://localhost:5182/', { waitUntil: 'networkidle2' });

  // Wait for loader to clear
  console.log("Waiting for loader to clear...");
  await page.waitForFunction(() => {
    const loader = document.getElementById('app-launch-loader');
    return !loader || loader.classList.contains('hidden') || window.getComputedStyle(loader).display === 'none';
  }, { timeout: 10000 });

  // Setup localStorage and profile in IndexedDB directly to bypass login UI completely
  console.log("Bypassing login by writing directly to IndexedDB & localStorage...");
  await page.evaluate(async () => {
    localStorage.setItem('ump_username', 'UMP_RUBY');
    localStorage.setItem('pitch_ump_favorite_team_UMP_RUBY', 'Orioles');
    localStorage.setItem('pitch_ump_favorite_team', 'Orioles');
    localStorage.setItem('pitch_ump_last_handle', 'UMP_RUBY');
    
    // Import DB dynamically and save profile
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

  // Reload page to apply changes
  console.log("Reloading page with active session...");
  await page.reload({ waitUntil: 'networkidle2' });

  console.log("Waiting for loader to clear after reload...");
  await page.waitForFunction(() => {
    const loader = document.getElementById('app-launch-loader');
    return !loader || loader.classList.contains('hidden') || window.getComputedStyle(loader).display === 'none';
  }, { timeout: 10000 });

  // Wait a short moment
  await new Promise(r => setTimeout(r, 1000));

  // Take screenshot 1: Welcome Screen (Resume Session Mode)
  console.log("Taking screenshot of Welcome Screen (Resume Mode)...");
  await page.screenshot({ path: path.join(screenshotDir, 'mobile_welcome.png') });

  // Click start button on Welcome Screen to transition to Dashboard
  console.log("Clicking Start button on Welcome screen...");
  await page.evaluate(() => {
    const btn = document.getElementById('btn-welcome-start');
    if (btn) btn.click();
  });

  // Wait to see if we reached the dashboard start-screen
  console.log("Waiting for Dashboard to load...");
  await page.waitForFunction(() => {
    const el = document.getElementById('start-screen');
    return el && !el.classList.contains('hidden') && window.getComputedStyle(el).display !== 'none';
  }, { timeout: 10000 });

  // Take screenshot 2: Dashboard
  console.log("Taking screenshot of Dashboard...");
  await page.screenshot({ path: path.join(screenshotDir, 'mobile_dashboard.png') });

  // Click start Weekly Challenge
  console.log("Starting weekly challenge...");
  await page.evaluate(() => {
    const btn = document.getElementById('btn-start-weekly-challenge');
    if (btn) btn.click();
  });
  
  // Wait for matchup overlay to show up
  await page.waitForFunction(() => {
    const el = document.getElementById('ab-start-overlay');
    return el && !el.classList.contains('hidden') && window.getComputedStyle(el).opacity !== '0';
  }, { timeout: 5000 });

  // Take screenshot 3: Pre-At-Bat matchup preview
  console.log("Taking screenshot of Pre-At-Bat Matchup...");
  await page.screenshot({ path: path.join(screenshotDir, 'mobile_matchup.png') });

  // Click Ready/Confirm Start
  console.log("Confirming at-bat start...");
  await page.evaluate(() => {
    const btn = document.getElementById('btn-ab-start-confirm');
    if (btn) btn.click();
  });
  
  // Wait for pitch flight (approx 4.5 seconds) to reach decision pending state
  console.log("Waiting for pitch flight (4.5s)...");
  await new Promise(r => setTimeout(r, 4500));

  // Take screenshot 4: Gameplay (decision pending)
  console.log("Taking screenshot of Gameplay HUD & pitch location...");
  await page.screenshot({ path: path.join(screenshotDir, 'mobile_gameplay.png') });

  // Make calls until at-bat is finished. Let's make 15 calls just to finish it.
  for (let i = 0; i < 15; i++) {
    const isFinished = await page.evaluate(() => {
      const summary = document.getElementById('ab-summary-overlay');
      return summary && !summary.classList.contains('hidden') && window.getComputedStyle(summary).opacity !== '0';
    });

    if (isFinished) {
      console.log("At-Bat summary screen detected!");
      break;
    }

    console.log(`Making pitch decision call ${i + 1}...`);
    
    // Wait for strike button or continue button to be visible
    const decisionState = await page.evaluate(() => {
      const strikeBtn = document.getElementById('btn-call-strike');
      const continueBtn = document.getElementById('btn-decision-continue');
      
      const strikeVisible = strikeBtn && window.getComputedStyle(strikeBtn).display !== 'none';
      const continueVisible = continueBtn && window.getComputedStyle(continueBtn).display !== 'none';
      
      return { strikeVisible, continueVisible };
    });

    if (decisionState.continueVisible) {
      console.log("Continue button visible. Clicking Continue...");
      await page.evaluate(() => {
        const btn = document.getElementById('btn-decision-continue');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 4000)); // wait for next pitch flight
    } else if (decisionState.strikeVisible) {
      console.log("Call Strike button visible. Clicking Strike...");
      await page.evaluate(() => {
        const btn = document.getElementById('btn-call-strike');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log("Waiting for pitch flight or decision prompt...");
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Take screenshot 5: At Bat Complete Summary overlay
  console.log("Taking screenshot of At-Bat Complete Summary overlay...");
  await page.screenshot({ path: path.join(screenshotDir, 'mobile_at_bat_complete.png') });

  console.log("All screenshots taken successfully!");
  await browser.close();
}

run().catch(err => {
  console.error("ERROR running screenshot script:", err);
  process.exit(1);
});
