// stamp-assets.js — cache-busting des assets locaux (CSS/JS) dans les pages HTML.
// ──────────────────────────────────────────────────────────────────────────────
// Problème : en ouvrant l'app par double-clic (file://), le navigateur garde wca.js /
// wca.css en cache. Après une mise à jour, un simple rechargement ressert l'ANCIENNE
// version (il faut un Ctrl+Maj+R). Ce script réécrit les références `href`/`src` des
// assets LOCAUX en y ajoutant `?v=<hash du contenu>` : dès qu'un fichier change, son
// hash change → l'URL change → le navigateur recharge la bonne version, tout seul.
//
// Idempotent : relançable sans effet si rien n'a changé. À lancer après chaque modif
// de wca.js / wca.css / data-*.js (appelé automatiquement en fin de build-data.js).
//   node stamp-assets.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PAGES = ['index.html', 'theory.html', 'live.html'];

// Hash court (8 hex) du contenu d'un fichier local, ou null s'il n'existe pas.
const hashCache = new Map();
function assetHash(file) {
  if (hashCache.has(file)) return hashCache.get(file);
  const p = path.join(ROOT, file);
  let h = null;
  if (fs.existsSync(p)) h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
  hashCache.set(file, h);
  return h;
}

// Réécrit les attributs href=/src= pointant un asset local .css/.js en ajoutant ?v=<hash>.
// Conserve une éventuelle query existante autre que `v` (rare ici). Ignore les URL absolues.
function stamp(html) {
  return html.replace(/\b(href|src)="([^"?#]+\.(?:css|js))(\?[^"#]*)?(#[^"]*)?"/g,
    (m, attr, file, query, frag) => {
      if (/^[a-z]+:\/\//i.test(file) || file.startsWith('//')) return m; // URL externe → on ne touche pas
      const h = assetHash(file);
      if (!h) return m; // asset introuvable → on laisse tel quel
      // Reconstruit la query en remplaçant/ajoutant v=, en préservant les autres params.
      const params = new URLSearchParams(query ? query.slice(1) : '');
      params.set('v', h);
      return `${attr}="${file}?${params.toString()}${frag || ''}"`;
    });
}

let changed = 0;
for (const page of PAGES) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = stamp(before);
  if (after !== before) { fs.writeFileSync(p, after); changed++; console.log(`  ✓ ${page} — assets tamponnés`); }
  else console.log(`  · ${page} — déjà à jour`);
}
console.log(changed ? `✅ ${changed} page(s) mise(s) à jour (cache-busting).` : '✅ Rien à changer (déjà tamponné).');
