// Vérifie la SYNCHRONISATION inter-fenêtres : une modif faite dans theory.html doit
// apparaître dans live.html (et vice-versa), via localStorage + l'événement 'storage'.
// Les deux pages doivent partager le même contexte (même origine file://).
//   node scripts/verify-sync.js
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const url = f => 'file://' + path.join(ROOT, f).replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(); // contexte partagé → localStorage partagé
  const theory = await ctx.newPage();
  const live = await ctx.newPage();
  let fail = 0;
  const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) fail++; };

  await theory.goto(url('theory.html'), { waitUntil: 'networkidle' });
  await live.goto(url('live.html'), { waitUntil: 'networkidle' });

  // 1) Dans Theory : choisir une classe + niveau et appliquer.
  await theory.selectOption('#clssel', 'iop');
  await theory.fill('#lvlinp', '200');
  await theory.click('#applycls');
  await theory.waitForTimeout(300);

  // 2) Dans Theory : saisir une stat de base (ex. PA / Maîtrise) dans l'onglet Personnage.
  await theory.click('.dz-tab:has-text("Personnage")').catch(() => {});
  await theory.waitForTimeout(200);
  const statInput = theory.locator('#perstats .stbase').first();
  await statInput.fill('123');
  await statInput.dispatchEvent('input');
  await theory.waitForTimeout(300);

  // 3) Live doit avoir reçu la classe + la stat (storage event → load + renderAll).
  await live.waitForTimeout(900); // laisse passer le debounce/anti-focus
  await live.click('.dz-tab:has-text("Personnage")').catch(() => {});
  await live.waitForTimeout(200);

  const liveClassFromStorage = await live.evaluate(() => JSON.parse(localStorage.getItem('wca') || '{}').build?.class);
  check('Live voit la classe choisie dans Theory (iop)', liveClassFromStorage === 'iop');

  const liveHasStatField = await live.locator('#perstats .stbase').count();
  check('Live affiche l\'onglet Personnage (champs de stats)', liveHasStatField > 0);

  const liveStatVal = await live.locator('#perstats .stbase').first().inputValue().catch(() => '');
  check('Live reflète la stat saisie dans Theory (123)', liveStatVal === '123');

  // 4) Sens inverse : modifier un bonus dans Live → Theory le reçoit.
  await live.click('#brow-monture');
  await live.waitForTimeout(300);
  await theory.waitForTimeout(900);
  const theoryMonture = await theory.evaluate(() => JSON.parse(localStorage.getItem('wca') || '{}').bonuses?.monture);
  check('Theory reçoit le bonus Monture activé dans Live', theoryMonture === true);

  await browser.close();
  console.log(fail ? `\n${fail} échec(s).` : '\nSync OK dans les deux sens.');
  process.exit(fail ? 1 : 0);
})();
