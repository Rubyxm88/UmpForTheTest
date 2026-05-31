import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 5173;
const url = `http://localhost:${port}/`;

async function run() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERR:', err.toString()));

  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    localStorage.setItem('ump_username', 'TEST_UMP');
    localStorage.setItem('pitch_ump_favorite_team_TEST_UMP', 'Orioles');
    localStorage.setItem('pitch_ump_favorite_team', 'Orioles');
    const today = new Date().toLocaleDateString();
    localStorage.setItem(`daily_login_bonus_TEST_UMP_${today}`, 'claimed');
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  await page.waitForFunction(() => {
    const btn = document.getElementById('btn-welcome-start');
    return btn && btn.textContent.trim().includes('PRESS START');
  }, { timeout: 20000 });

  await page.click('#btn-welcome-start');
  await new Promise(r => setTimeout(r, 2000));

  // Start weekly challenge
  await page.waitForSelector('#btn-start-weekly-challenge', { visible: true, timeout: 10000 });
  await page.click('#btn-start-weekly-challenge');
  await new Promise(r => setTimeout(r, 2500));

  const diag = await page.evaluate(() => {
    const btn = document.getElementById('btn-ab-start-confirm');
    const overlay = document.getElementById('ab-start-overlay');
    const getStyle = (el) => el ? window.getComputedStyle(el) : null;

    const hitTest = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const chain = [];
      let cur = hit;
      while (cur) {
        chain.push(`${cur.tagName}${cur.id ? '#' + cur.id : ''}${cur.className ? '.' + String(cur.className).split(' ').slice(0, 2).join('.') : ''}`);
        cur = cur.parentElement;
      }
      return { cx, cy, hit: chain[0], chain: chain.slice(0, 8) };
    };

    const blockers = ['main-top-nav', 'start-screen', 'welcome-screen', 'hud-middle', 'app-launch-loader', 'canvas-container']
      .map(id => {
        const el = document.getElementById(id);
        if (!el) return { id, found: false };
        const s = getStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          id,
          found: true,
          rect: { w: rect.width, h: rect.height, top: rect.top },
          pointerEvents: s.pointerEvents,
          opacity: s.opacity,
          visibility: s.visibility,
          zIndex: s.zIndex,
          display: s.display,
          classes: el.className
        };
      });

    return {
      overlay: overlay ? {
        classes: overlay.className,
        pointerEvents: getStyle(overlay).pointerEvents,
        opacity: getStyle(overlay).opacity,
        visibility: getStyle(overlay).visibility,
        zIndex: getStyle(overlay).zIndex,
        position: getStyle(overlay).position
      } : null,
      btn: btn ? {
        rect: btn.getBoundingClientRect(),
        pointerEvents: getStyle(btn).pointerEvents,
        visibility: getStyle(btn).visibility
      } : null,
      btnHit: hitTest(btn),
      blockers,
      currentState: typeof window.currentState !== 'undefined' ? window.currentState : 'n/a'
    };
  });

  console.log(JSON.stringify(diag, null, 2));

  // Try programmatic click vs puppeteer click
  const clickResult = await page.evaluate(() => {
    const btn = document.getElementById('btn-ab-start-confirm');
    let called = false;
    const orig = window.confirmAtBatStart;
    if (typeof window.confirmAtBatStart === 'function') {
      window.confirmAtBatStart = () => { called = true; };
    }
    btn?.click();
    window.confirmAtBatStart = orig;
    return { programmaticCalled: called, overlayStillVisible: document.getElementById('ab-start-overlay')?.classList.contains('opacity-100') };
  });
  console.log('Programmatic click result:', clickResult);

  try {
    await page.click('#btn-ab-start-confirm', { timeout: 3000 });
    console.log('Puppeteer click succeeded');
  } catch (e) {
    console.log('Puppeteer click FAILED:', e.message);
  }

  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
