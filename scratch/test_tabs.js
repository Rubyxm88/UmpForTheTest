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

  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  console.log('Clearing localStorage and IndexedDB database caches...');
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem('ump_username', 'TEST_UMP');
    localStorage.setItem('pitch_ump_favorite_team_TEST_UMP', 'Orioles');
    localStorage.setItem('pitch_ump_favorite_team', 'Orioles');
    const today = new Date().toLocaleDateString();
    localStorage.setItem(`daily_login_bonus_TEST_UMP_${today}`, 'claimed');

    const databases = await window.indexedDB.databases();
    for (const db of databases) {
      window.indexedDB.deleteDatabase(db.name);
    }
  });

  console.log('Reloading page for clean state...');
  await page.reload({ waitUntil: 'domcontentloaded' });

  console.log('Waiting 3 seconds for launch loader to fade out...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('Checking for welcome screen button...');
  const comparison = await page.evaluate(() => {
    const el1 = document.getElementById('btn-welcome-start');
    const el2 = document.getElementById('btn-streak-summary-advance');
    const getElDetails = (el) => {
      if (!el) return 'NOT_FOUND';
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        id: el.id,
        tagName: el.tagName,
        outerHTML: el.outerHTML.substring(0, 200),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents
        }
      };
    };
    
    // Check element at center of el1
    let elementAtEl1Center = 'NONE';
    if (el1) {
      const rect = el1.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      elementAtEl1Center = hit ? {
        id: hit.id,
        tagName: hit.tagName,
        className: hit.className,
        parentChain: (() => {
          const chain = [];
          let current = hit;
          while (current) {
            chain.push(`${current.tagName}${current.id ? '#' + current.id : ''}`);
            current = current.parentElement;
          }
          return chain.join(' -> ');
        })()
      } : 'NONE';
    }

    return {
      welcomeBtn: getElDetails(el1),
      streakAdvanceBtn: getElDetails(el2),
      elementAtWelcomeBtnCenter: elementAtEl1Center,
      areSame: el1 === el2,
      overlayStyles: {
        streakSummaryOverlay: (() => {
          const el = document.getElementById('streak-summary-overlay');
          if (!el) return 'NOT_FOUND';
          return {
            className: el.className,
            computedPointerEvents: window.getComputedStyle(el).pointerEvents,
            computedOpacity: window.getComputedStyle(el).opacity,
            computedDisplay: window.getComputedStyle(el).display
          };
        })(),
        welcomeScreen: (() => {
          const el = document.getElementById('welcome-screen');
          if (!el) return 'NOT_FOUND';
          return {
            className: el.className,
            computedPointerEvents: window.getComputedStyle(el).pointerEvents,
            computedOpacity: window.getComputedStyle(el).opacity,
            computedDisplay: window.getComputedStyle(el).display
          };
        })()
      },
      streakBtnChain: (() => {
        let el = document.getElementById('btn-streak-summary-advance');
        const res = [];
        while (el) {
          res.push({
            id: el.id,
            tagName: el.tagName,
            className: el.className,
            computedPointerEvents: window.getComputedStyle(el).pointerEvents
          });
          el = el.parentElement;
        }
        return res;
      })()
    };
  });

  console.log('DOM COMPARISON:\n', JSON.stringify(comparison, null, 2));

  console.log('Clicking Welcome Start Button...');
  const btnText = await page.evaluate(() => {
    const btn = document.getElementById('btn-welcome-start');
    return btn ? btn.textContent.trim() : 'NOT_FOUND';
  });

  console.log('Welcome start button text:', btnText);

  console.log('Clicking Welcome Start Button...');
  await page.click('#btn-welcome-start');

  console.log('Waiting 3 seconds for transition to settle...');
  await new Promise(r => setTimeout(r, 3000));

  const diagnostics = await page.evaluate(() => {
    const playBtn = document.getElementById('tab-btn-play');
    const playContent = document.getElementById('tab-content-play');
    const startScreen = document.getElementById('start-screen');
    const navTabs = document.getElementById('dashboard-nav-tabs');

    const getElDetails = (el) => {
      if (!el) return 'NOT_FOUND';
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        id: el.id,
        tagName: el.tagName,
        className: el.className,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          position: style.position
        }
      };
    };

    // Find any elements on top of the play button
    const rect = playBtn ? playBtn.getBoundingClientRect() : null;
    let elementAtPoint = 'N/A';
    if (rect) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const el = document.elementFromPoint(centerX, centerY);
      elementAtPoint = el ? {
        id: el.id,
        tagName: el.tagName,
        className: el.className,
        parentChain: (() => {
          const chain = [];
          let current = el;
          while (current) {
            chain.push(`${current.tagName}${current.id ? '#' + current.id : ''}`);
            current = current.parentElement;
          }
          return chain.join(' -> ');
        })()
      } : 'NONE';
    }

    return {
      playBtn: getElDetails(playBtn),
      playContent: getElDetails(playContent),
      startScreen: getElDetails(startScreen),
      navTabs: getElDetails(navTabs),
      elementAtCenterOfPlayBtn: elementAtPoint,
      activeTab: typeof window.activeTab !== 'undefined' ? window.activeTab : 'undefined'
    };
  });

  console.log('DIAGNOSTICS:\n', JSON.stringify(diagnostics, null, 2));

  const checkTabsState = async () => {
    return await page.evaluate(() => {
      const getTabState = (btnId, contentId) => {
        const btn = document.getElementById(btnId);
        const content = document.getElementById(contentId);
        if (!btn || !content) return { exists: false };
        const hasActiveCls = btn.classList.contains('ump-tab--active') || btn.classList.contains('tab-btn-active');
        const isHidden = content.classList.contains('hidden');
        return {
          exists: true,
          active: hasActiveCls,
          visible: !isHidden,
          classes: btn.className,
          contentClasses: content.className
        };
      };
      return {
        play: getTabState('tab-btn-play', 'tab-content-play'),
        leaderboard: getTabState('tab-btn-leaderboard', 'tab-content-leaderboard'),
        stats: getTabState('tab-btn-stats', 'tab-content-stats')
      };
    });
  };

  console.log('--- Phase 1: Click Standings (Leaderboard) Tab ---');
  await page.click('#tab-btn-leaderboard');
  await new Promise(r => setTimeout(r, 800));
  let state = await checkTabsState();
  console.log('State after clicking Standings:\n', JSON.stringify(state, null, 2));
  if (!state.leaderboard.active || !state.leaderboard.visible) {
    throw new Error('FAILED: Standings tab was clicked but did not become active or visible!');
  }
  if (state.play.active || state.play.visible || state.stats.active || state.stats.visible) {
    throw new Error('FAILED: Play or Profile tabs are still active/visible after switching to Standings!');
  }

  console.log('--- Phase 2: Click Profile (Stats) Tab ---');
  await page.click('#tab-btn-stats');
  await new Promise(r => setTimeout(r, 800));
  state = await checkTabsState();
  console.log('State after clicking Profile:\n', JSON.stringify(state, null, 2));
  if (!state.stats.active || !state.stats.visible) {
    throw new Error('FAILED: Profile tab was clicked but did not become active or visible!');
  }
  if (state.play.active || state.play.visible || state.leaderboard.active || state.leaderboard.visible) {
    throw new Error('FAILED: Play or Standings tabs are still active/visible after switching to Profile!');
  }

  console.log('--- Phase 3: Click Play Tab ---');
  await page.click('#tab-btn-play');
  await new Promise(r => setTimeout(r, 800));
  state = await checkTabsState();
  console.log('State after clicking Play:\n', JSON.stringify(state, null, 2));
  if (!state.play.active || !state.play.visible) {
    throw new Error('FAILED: Play tab was clicked but did not become active or visible!');
  }
  if (state.leaderboard.active || state.leaderboard.visible || state.stats.active || state.stats.visible) {
    throw new Error('FAILED: Standings or Profile tabs are still active/visible after switching back to Play!');
  }

  console.log('ALL TAB SWITCHING TESTS PASSED SUCCESSFULLY!');

  await browser.close();
}

run().catch(console.error);
