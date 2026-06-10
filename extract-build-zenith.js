/**
 * extract-build-zenith.js  —  v5.0
 * Script à coller dans la console DevTools de zenithwakfu.com/builder/XXXXX
 * F12 → Console → colle → Entrée
 *
 * Lit les statistiques FINALES directement dans le panneau de stats affiché par
 * Zenith (équipement + aptitudes + base de classe + passifs, déjà cumulés).
 *
 * Pourquoi le DOM et pas l'API : l'API Zenith
 * (api.zenithwakfu.com/builder/api/build/<code>) ne renvoie QUE les bonus
 * d'équipement bruts — sans les points de caractéristiques investis ni les
 * bases de classe. Seul le panneau affiché contient les valeurs réelles du
 * personnage. Chaque stat y est une ligne stable :
 *   <div class="stats-body">
 *     <div class="stats-body-header"><img src=".../<image>.webp" alt="<libellé>"></div>
 *     <div class="stats-body-value"><div class="statistic">VALEUR</div></div>
 *   </div>
 * On mappe par NOM D'IMAGE (insensible à la langue), avec l'alt en secours.
 *
 * Sortie : JSON aux clés attendues par wca.js (Wakfu Combat Advisor), prêt à
 * coller dans le champ « Import Wakfuli / Zénith » de l'onglet BUILD.
 */

(async function extractZenithBuild() {
  'use strict';

  const log = (...a) => console.log('[Zenith]', ...a);

  const result = {
    source: 'zenith', version: '5.0',
    extracted: new Date().toISOString(),
    character: {}, stats: {},
  };

  const CLASSES = ['sram','iop','cra','sacrier','ecaflip','feca','eniripsa','xelor',
                   'pandawa','sadida','osamodas','rogue','masqueraider','foggernaut',
                   'eliotrope','huppermage','ouginak','forgelance','enutrof'];

  // ── Mapping nom d'image .webp → clé wca.js ──────────────────────
  // L'image est le repère le plus stable (ne change pas selon la langue de l'UI).
  // NB : les noms de clés suivent EXACTEMENT ce que wca.js lit. Points subtils :
  //   • PV du joueur = clé `hp` (wca.js:237 playerMaxHp), PAS `pv` (clé morte).
  //   • Le coup critique du joueur n'entre PAS dans le calcul de dégâts (wca.js
  //     utilise un mode CC binaire). `critChance`/`critMastery` sont donc purement
  //     décoratifs (panneau Perso, wca.js:1096) — on les fournit quand même.
  const IMG_MAP = {
    'health_point':       'hp',
    'pa':                 'ap',
    'pm':                 'mp',
    'pw':                 'wp',
    'aqua_damage':        'maitriseEau',
    'earth_damage':       'maitriseTerre',
    'wind_damage':        'maitriseAir',
    'fire_damage':        'maitriseFeu',
    'aqua_resistance':    'resEau',
    'earth_resistance':   'resTerre',
    'wind_resistance':    'resAir',
    'fire_resistance':    'resFeu',
    'damage':             'degatsInfliges',   // « Dommages Infligés » (% global)
    'indirect_damage':    'dmgIndirect',       // « Dommages Indirects » (% — secours, voir ALT_OVERRIDE)
    'healing_done':       'soinsRealises',     // partagé avec « Maîtrise Soin » → désambiguïsé par alt
    'criticalhit':        'critChance',        // décoratif (% CC)
    'block':              'parade',
    'initiative':         'initiative',
    'range':              'portee',
    'dodge':              'esquive',
    'tackle':             'tacle',
    'will':               'volonte',
    'critical_mastery':   'critMastery',       // décoratif (Maît. Critique)
    'critical_resistance':'resCrit',
    'rear_mastery':       'maitriseDos',
    'rear_resistance':    'resDos',
    'melee_mastery':      'maitriseMelee',
    'range_mastery':      'maitriseDistance',
    'berserk_mastery':    'maitriseBerserk',
    'control':            'controle',
    'wisdom':             'sagesse',
    'prospection':        'prospection',
  };

  // Cas ambigus résolus par le libellé (alt) : deux stats partagent damage.webp
  // (« Maîtrise cumulée » qu'on ignore, « Dommages Infligés ») et healing_done.webp
  // (« Soins réalisés » vs « Maîtrise Soin »).
  const ALT_OVERRIDE = {
    'Maîtrise cumulée':   null,            // somme indicative → on ignore
    'Maîtrise Soin':      'maitriseSoin',
    'Soins réalisés':     'soinsRealises',
    'Dommages Infligés':  'degatsInfliges',
    'Dommages Indirects': 'dmgIndirect',
  };

  // ── 1. Classe / niveau / nom (via API métadonnées, sinon DOM/titre) ──
  const buildCode = (window.location.pathname.match(/\/builder\/([a-z0-9]+)/i) || [])[1];
  if (buildCode) {
    try {
      const r = await fetch(`https://api.zenithwakfu.com/builder/api/infos/build/${buildCode}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (r.ok) {
        const info = await r.json();
        const JOBS = { 1:'feca',2:'osamodas',3:'enutrof',4:'sram',5:'xelor',6:'ecaflip',
          7:'eniripsa',8:'iop',9:'cra',10:'sadida',11:'sacrier',12:'pandawa',13:'rogue',
          14:'masqueraider',15:'ouginak',16:'foggernaut',17:'eliotrope',18:'huppermage',19:'forgelance' };
        if (JOBS[info.id_job]) result.character.class = JOBS[info.id_job];
        if (info.level_build)  result.character.level = info.level_build;
        if (info.name_build)   result.character.name  = info.name_build;
        log('Métadonnées API :', info.name_build, '| niv', info.level_build, '|', result.character.class);
      }
    } catch { /* l'API peut échouer (session/privé) : on retombe sur le DOM */ }
  }

  // Fallbacks DOM si l'API n'a rien donné.
  const fullText = document.body.innerText;
  if (!result.character.class) {
    for (const cls of CLASSES) {
      if (new RegExp('\\b' + cls + '\\b', 'i').test(fullText)) { result.character.class = cls; break; }
    }
  }
  if (!result.character.level) {
    const m = fullText.match(/(?:niveau|level|niv\.?)\s*[:\-]?\s*(\d{1,3})\b/i);
    if (m) result.character.level = parseInt(m[1]);
  }

  // ── 2. Lecture du panneau de stats ──────────────────────────────
  const rows = document.querySelectorAll('.stats-body');
  if (!rows.length) {
    console.error('[Zenith] ❌ Panneau de stats introuvable (.stats-body). ' +
      'Ouvre l\'onglet/section qui affiche les caractéristiques du personnage, puis relance.');
    return;
  }
  log(`${rows.length} lignes de stats détectées.`);

  const toNum = s => {
    const n = parseInt(String(s).replace(/[^\d\-]/g, ''), 10);
    return isNaN(n) ? null : n;
  };

  let read = 0;
  rows.forEach(row => {
    const img = row.querySelector('.stats-body-header img');
    const alt = (img?.alt || row.querySelector('.stats-body-name')?.textContent || '').trim();
    const imgName = (img?.getAttribute('src') || '').split('/').pop().replace('.webp', '');
    const valEl = row.querySelector('.stats-body-value .statistic');
    if (!valEl) return;
    const val = toNum(valEl.textContent);
    if (val === null) return;

    // Priorité au libellé pour les images ambiguës, sinon mapping par image.
    let key;
    if (Object.prototype.hasOwnProperty.call(ALT_OVERRIDE, alt)) key = ALT_OVERRIDE[alt];
    else key = IMG_MAP[imgName];

    if (key) { result.stats[key] = val; read++; }
  });

  // On retire les zéros pour alléger (wca.js traite l'absence comme 0).
  // Exception : on garde les ressources même à 0 si jamais elles le sont.
  const KEEP_ZERO = new Set(['ap', 'mp', 'wp', 'hp']);
  result.stats = Object.fromEntries(
    Object.entries(result.stats).filter(([k, v]) => v !== 0 || KEEP_ZERO.has(k))
  );

  // ── 3. Contrôles de cohérence ───────────────────────────────────
  const warnings = [];
  if (result.stats.ap != null && result.stats.ap > 14) warnings.push(`PA=${result.stats.ap} (max ~14)`);
  if (result.stats.mp != null && result.stats.mp > 8)  warnings.push(`PM=${result.stats.mp} (max ~8)`);
  const hasDmg = result.stats.maitriseFeu || result.stats.maitriseEau ||
                 result.stats.maitriseTerre || result.stats.maitriseAir || result.stats.maitriseElem;
  if (!hasDmg) warnings.push('Aucune maîtrise élémentaire lue — le panneau de stats est-il bien affiché ?');
  if (!result.character.level) warnings.push('Niveau non détecté.');

  // ── 4. Sortie ───────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('ZENITH BUILD EXTRACT v5.0');
  console.log('═══════════════════════════════════════════════');
  console.log(`Classe  : ${result.character.class || '⚠ non détectée'}`);
  console.log(`Niveau  : ${result.character.level || '⚠ non détecté'}`);
  console.log(`Nom     : ${result.character.name || '—'}`);
  console.log(`Stats   : ${read} lues, ${Object.keys(result.stats).length} retenues`);
  console.table(result.stats);
  if (warnings.length) { console.warn('⚠ Vérifications :'); warnings.forEach(w => console.warn('   • ' + w)); }

  const json = JSON.stringify(result, null, 2);

  // Récupération du JSON — copier depuis la console Firefox est peu fiable, donc
  // on cumule plusieurs voies, de la plus pratique à la plus sûre :
  //   1. navigator.clipboard — l'API standard (souvent bloquée en console Firefox)
  //   2. copy() — fonction native DevTools (pas toujours dispo dans une IIFE)
  //   3. affichage du JSON brut + boîte prompt() en secours (voir plus bas)
  let copied = false;
  try { await navigator.clipboard.writeText(json); copied = true; } catch {}
  try { if (typeof copy === 'function') { copy(json); copied = true; } } catch {}

  console.log(copied
    ? '✅ JSON copié dans le presse-papier — colle-le dans wca.js (onglet BUILD → Import).'
    : '⚠ Presse-papier bloqué : copie le bloc JSON ci-dessous OU la boîte de dialogue.');

  // Affichage console : `%s` force Firefox à rendre la chaîne en TEXTE BRUT
  // (sinon une longue string multi-ligne est repliée et paraît « vide »).
  console.log('────────── JSON (sélectionne ce bloc pour copier) ──────────');
  console.log('%s', json);
  console.log('────────────────────────────────────────────────────────────');

  // Filet de secours ultime : une boîte de dialogue avec le JSON pré-sélectionné.
  // Indépendante de la console et des permissions presse-papier → marche partout.
  // (Ctrl+C dans la boîte, puis Échap/Annuler pour fermer.)
  if (!copied) {
    try { window.prompt('JSON du build — Ctrl+C pour copier, puis Échap :', json); } catch {}
  }

  // PAS de `return` : une IIFE async renvoie une Promise que DevTools affiche de
  // façon envahissante (et qui noie les logs ci-dessus). On s'en passe.
})();
