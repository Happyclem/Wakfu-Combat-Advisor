/**
 * extract-build-wakfuli.js — Wakfuli v7
 *
 * Import 100 % automatique : classe + niveau (depuis le titre de page) et les
 * ~36 stats du panneau de caractéristiques.
 *
 * À coller dans F12 → Console sur la page  ITEMS  d'un build, avec le panneau
 * de caractéristiques affiché :
 *   https://wakfuli.com/builder/<id>/items
 *
 * Pourquoi le DOM et pas innerText : la page mélange la liste d'items (avec
 * leurs effets individuels) et le panneau de stats cumulées. Un regex sur le
 * texte global ramasse des nombres au hasard. On lit donc le panneau via sa
 * structure stable : chaque stat est
 *   <img alt="Picto de la stat <Libellé>" src=".../stats/<NOM>.webp">
 *   <span><Libellé></span> ... <button><valeur></button>
 * On mappe par LIBELLÉ (alt), insensible à la position. Les résistances
 * s'affichent "40% (230)" → on garde la valeur BRUTE entre parenthèses.
 *
 * Sortie : JSON aux clés attendues par wca.js, prêt à coller dans le champ
 * d'import « Wakfuli / Zénith » de l'onglet BUILD.
 */
(function extractWakfuli() {
  'use strict';

  const result = {
    source: 'wakfuli', version: '7.0',
    extracted: new Date().toISOString(),
    character: {}, stats: {}, spells: [], passives: [],
  };

  // ── Mapping LIBELLÉ (normalisé) → clé wca.js ─────────────────────
  // Normalisation : minuscules, sans accents, sans %, espaces compactés.
  // NB : PV joueur = clé `hp` (wca.js playerMaxHp), pas `pv` (clé morte).
  const norm = s => (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire accents
    .replace(/%/g, '').replace(/\s+/g, ' ').trim();

  const MAP = {
    'pv': 'hp', 'points de vie': 'hp',
    'pa': 'ap', 'pm': 'mp', 'pw': 'wp',
    'maitrise feu': 'maitriseFeu', 'maitrise eau': 'maitriseEau',
    'maitrise terre': 'maitriseTerre', 'maitrise air': 'maitriseAir',
    'resistance feu': 'resFeu', 'resistance eau': 'resEau',
    'resistance terre': 'resTerre', 'resistance air': 'resAir',
    'maitrise totale': 'maitriseElem', 'resistance totale': 'resElem',
    'mastery': 'maitriseElem', 'resistance': 'resElem', // alt brut des totaux
    'dommages infliges': 'degatsInfliges', 'soins realises': 'soinsRealises',
    'coup critique': 'tauxCC', 'parade': 'parade',
    'initiative': 'initiative', 'portee': 'portee',
    'esquive': 'esquive', 'tacle': 'tacle',
    'sagesse': 'sagesse', 'prospection': 'prospection', 'volonte': 'volonte',
    'maitrise critique': 'maitriseCrit', 'resistance critique': 'resCrit',
    'maitrise dos': 'maitriseDos', 'resistance dos': 'resDos',
    'maitrise melee': 'maitriseMelee', 'maitrise distance': 'maitriseDistance',
    'maitrise berserk': 'maitriseBerserk', 'maitrise soin': 'maitriseSoin',
    'armure donnee': 'armureDonnee', 'armure recue': 'armureRecue',
    'dommage indirects': 'dmgIndirect', 'dommages indirects': 'dmgIndirect',
    'controle': 'controle',
  };

  // ── Localise le panneau de stats (libellés uniques) ──────────────
  // 3 repères répartis du HAUT (Maîtrise totale) au BAS (crit) du panneau :
  // le plus petit ancêtre commun = le panneau entier (pas une seule ligne).
  const NEEDLE = ['Maîtrise totale', 'Maîtrise critique', 'Résistance critique'];
  let panel = null, best = Infinity;
  for (const el of document.querySelectorAll('div')) {
    const t = el.textContent || '';
    if (NEEDLE.every(n => t.includes(n)) && t.length < best) { panel = el; best = t.length; }
  }
  if (!panel) {
    console.error('❌ Panneau de stats introuvable. Onglet ITEMS avec les caractéristiques affichées ?');
    return;
  }

  // ── Lit chaque ligne de stat (img + valeur la plus proche) ───────
  const S = result.stats;
  const rawPairs = [];   // pour vérification / mapping des cas non gérés
  const unmapped = [];

  const imgs = panel.querySelectorAll('img[src*="/stats/"], img[alt*="stat"]');
  imgs.forEach(img => {
    // libellé : alt « Picto de la stat XXX », sinon span voisin
    let label = (img.getAttribute('alt') || '').replace(/^.*stat\s+/i, '').trim();
    if (!label) label = img.parentElement?.querySelector('span')?.textContent?.trim() || '';

    // cellule = plus petit ancêtre contenant un chiffre (= la valeur)
    let cell = img.parentElement;
    for (let i = 0; i < 5 && cell && !/\d/.test(cell.textContent.replace(label, '')); i++) cell = cell.parentElement;
    if (!cell) return;

    const valText = (cell.querySelector('button')?.textContent || cell.textContent || '').trim();
    // "40% (230)" → 230 (brut) ; sinon premier entier signé
    let m = valText.match(/(-?\d+)\s*%?\s*\((-?\d+)\)/);
    const val = m ? parseInt(m[2]) : parseInt((valText.match(/-?\d+/) || [])[0]);
    if (isNaN(val)) return;

    rawPairs.push([label, valText, val]);
    const key = MAP[norm(label)];
    if (key) S[key] = val;
    else if (label) unmapped.push(`${label} = ${valText}`);
  });

  // ── Classe & niveau ──────────────────────────────────────────────
  const CLASSES = ['sram','iop','cra','sacrier','ecaflip','feca','eniripsa','xelor','pandawa',
    'sadida','osamodas','rogue','masqueraider','foggernaut','eliotrope','huppermage','ouginak','forgelance'];

  // 1. Titre de page — format "SRAM 50 — WAKFULI Builder" (classe + niveau)
  const title = (document.querySelector('meta[property="og:title"]')?.content
    || document.title || '').toLowerCase();
  for (const c of CLASSES) {
    if (new RegExp('\\b' + c + '\\b').test(title)) { result.character.class = c; break; }
  }
  const lvlM = title.match(/\b(\d{1,3})\b/); // premier nombre du titre = niveau
  if (lvlM) result.character.level = parseInt(lvlM[1]);

  // 2. Secours classe : icône .../breeds/<classe>.webp
  if (!result.character.class) {
    const breed = [...document.querySelectorAll('img[src*="/breeds/"]')]
      .map(i => i.src.split('/').pop().replace('.webp', '').toLowerCase())
      .find(n => CLASSES.includes(n));
    if (breed) result.character.class = breed;
  }

  // 3. Secours classe : clé de __SPELL_CACHE__ (peuplé après l'onglet SORTS)
  if (!result.character.class) {
    try {
      const sc = window.__SPELL_CACHE__;
      if (sc instanceof Map && sc.size) result.character.class = [...sc.keys()][0].toLowerCase();
    } catch {}
  }

  if (!result.character.level) result.character.level = 200; // défaut si introuvable

  // ── Sortie + vérification ────────────────────────────────────────
  const n = Object.keys(S).length;
  console.log('══════════════════════════════════════════');
  console.log('WAKFULI EXTRACT v7');
  console.log('══════════════════════════════════════════');
  console.log(`Classe  : ${result.character.class || '⚠ non détectée (choisis-la dans l\'app)'}`);
  console.log(`Stats   : ${n} mappées`);
  console.table(S);
  console.log('— Toutes les paires lues (vérif) —');
  console.table(rawPairs.map(([l, v]) => ({ libellé: l, valeur: v })));
  if (unmapped.length) {
    console.warn('⚠ Libellés non mappés (dis-le moi si une stat utile manque) :');
    unmapped.forEach(u => console.warn('   • ' + u));
  }

  const json = JSON.stringify(result, null, 2);
  console.log(json);
  navigator.clipboard?.writeText(json)
    .then(() => console.log('✅ JSON copié — colle-le dans Wakfu Combat Advisor.'))
    .catch(() => console.log('⚠ Copie manuelle : sélectionne le JSON ci-dessus.'));
  return result;
})();
