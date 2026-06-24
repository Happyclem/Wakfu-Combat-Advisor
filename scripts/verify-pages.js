// Vérification visuelle locale des pages de l'app (dev only — voir package.json).
// Charge chaque page dans Chromium (Playwright), capture les erreurs console / page,
// et enregistre une capture d'écran dans screenshots/. Sort en code != 0 si une page
// produit une erreur console ou d'exécution.
//
//   npm run verify                  → vérifie index/theory/live
//   node scripts/verify-pages.js theory.html live.html
//   HEADED=1 node scripts/verify-pages.js theory.html   → fenêtre visible
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const pages = process.argv.slice(2);
if (!pages.length) pages.push('index.html', 'theory.html', 'live.html');

// Certaines erreurs console sont du bruit hors-ligne (icônes WakfuAssets en remote) :
// on les ignore pour ne signaler que les VRAIES erreurs JS.
const IGNORE = [
  /net::ERR_/i, /Failed to load resource/i, /raw\.githubusercontent\.com/i,
  /favicon/i, /ERR_INTERNET_DISCONNECTED/i, /ERR_NAME_NOT_RESOLVED/i,
];
const ignore = m => IGNORE.some(re => re.test(m));

(async () => {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  let fail = 0;
  for (const page of pages) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) { console.error('SKIP ', page, '(introuvable)'); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
    const p = await ctx.newPage();
    const errors = [];
    p.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) errors.push('console: ' + m.text()); });
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await p.goto('file://' + file.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 15000 }).catch(e => errors.push('goto: ' + e.message));
    await p.waitForTimeout(400); // laisse l'init + premiers renders se faire
    const shot = path.join(SHOTS, page.replace(/\.html$/, '') + '.png');
    await p.screenshot({ path: shot, fullPage: true }).catch(() => {});
    if (errors.length) {
      fail++;
      console.error('FAIL ', page);
      errors.forEach(e => console.error('   ', e));
    } else {
      console.log('OK   ', page, '→', path.relative(ROOT, shot));
    }
    await ctx.close();
  }
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
