/**
 * extract-build.js — Wakfuli v4
 * Colle dans F12 → Console sur wakfuli.com/builder/[id]/items
 * Attendre que la page soit complètement chargée.
 */
(function extractWakfuli() {
  'use strict';

  const result = {
    source: 'wakfuli', version: '4.0',
    extracted: new Date().toISOString(),
    character: {}, stats: {}, spells: [], passives: [],
  };

  const txt = document.body.innerText;

  // ── Classe ──────────────────────────────────────────────────────
  const CLASSES = ['sram','iop','cra','sacrier','ecaflip','feca','eniripsa','xelor',
                   'pandawa','sadida','osamodas','rogue','masqueraider','foggernaut',
                   'eliotrope','huppermage','ouginak','forgelance'];
  for (const cls of CLASSES) {
    if (txt.toLowerCase().includes(cls)) { result.character.class = cls; break; }
  }

  // ── Niveau ──────────────────────────────────────────────────────
  const lvlM = txt.match(/[Nn]iveau\s+(\d+)/);
  if (lvlM) result.character.level = parseInt(lvlM[1]);

  // ── Helper pick : premier match numérique ────────────────────────
  function pick(...patterns) {
    for (const pat of patterns) {
      const m = txt.match(pat);
      if (m) {
        const n = parseFloat((m[1]||'').replace(/[\s\u202f\u00a0]/g,''));
        if (!isNaN(n)) return n;
      }
    }
    return null;
  }

  // ── Maîtrises élémentaires ───────────────────────────────────────
  // Texte réel : "Résistance totale: 886 158 40% (230) 242 40% (236) 112 41% (240) 242 33% (180) Combat"
  // Pattern : entier suivi de X% → ce sont les maîtrises dans l'ordre Feu Eau Terre Air
  const mastSection = txt.match(/Résistance totale:\s*\d+\s*([\s\S]+?)(?:Combat)/)?.[1] || '';
  const mastPairs = [...mastSection.matchAll(/(\d+)\s+\d+%/g)].map(m => parseInt(m[1]));
  if (mastPairs.length >= 4) {
    result.stats['maîtriseFeu']   = mastPairs[0];
    result.stats['maitriseEau']   = mastPairs[1];
    result.stats['maitriseTerre'] = mastPairs[2];
    result.stats['maitriseAir']   = mastPairs[3];
  }

  // Maîtrise totale
  result.stats.maitriseElem = pick(/Maîtrise totale:\s*([\d\s\u202f]+)/);

  // ── Ressources ───────────────────────────────────────────────────
  result.stats.pv = pick(/PV\s+([\d]+)/);
  result.stats.ap = pick(/PA\s+([\d]+)/);
  result.stats.mp = pick(/PM\s+([\d]+)/);
  result.stats.wp = pick(/PW\s+([\d]+)/);

  // ── Combat ───────────────────────────────────────────────────────
  result.stats.degatsInfliges = pick(/Dommages infligés\s+([\d]+)/);
  result.stats.soinsRealises  = pick(/Soins réalisés\s+([\d]+)/);
  result.stats.tauxCC         = pick(/% Coup critique\s+([\d]+)/);
  result.stats.parade         = pick(/% Parade\s+([\d]+)/);
  result.stats.initiative     = pick(/Initiative\s+([\d]+)/);
  result.stats.portee         = pick(/Portée\s+([\d]+)/);
  result.stats.esquive        = pick(/Esquive\s+([\d]+)/);
  result.stats.tacle          = pick(/Tacle\s+([\d]+)/);
  result.stats.sagesse        = pick(/Sagesse\s+([\d]+)/);
  result.stats.prospection    = pick(/Prospection\s+([\d]+)/);
  result.stats.volonte        = pick(/Volonté\s+([\d]+)/);

  // ── Secondaire ───────────────────────────────────────────────────
  result.stats.maitriseCrit    = pick(/Maîtrise critique\s+([\d]+)/);
  result.stats.resCrit         = pick(/Résistance critique\s+([\d]+)/);
  result.stats.maitriseDos     = pick(/Maîtrise dos\s+([\d]+)/);
  result.stats.resDos          = pick(/Résistance dos\s+([\d]+)/);
  result.stats.maitriseMelee   = pick(/Maîtrise mêlée\s+([\d]+)/);
  result.stats.armureDonnee    = pick(/Armure donnée\s+([\d]+)/);
  result.stats.maitriseDistance= pick(/Maîtrise distance\s+([\d]+)/);
  result.stats.armureRecue     = pick(/Armure reçue\s+([\d]+)/);
  result.stats.maitriseSoin    = pick(/Maîtrise soin\s+([\d]+)/);
  result.stats.dmgIndirect     = pick(/Dommage indirects?\s+([\d]+)/);
  result.stats.maitriseBerserk = pick(/Maîtrise berserk\s+([\d]+)/);

  // Nettoyer nulls
  result.stats = Object.fromEntries(
    Object.entries(result.stats).filter(([,v]) => v !== null && !isNaN(v))
  );

  // ── Sorts & passifs via __NEXT_DATA__ ────────────────────────────
  const nd = window.__NEXT_DATA__?.props?.pageProps;
  if (nd) {
    const build = nd.build || nd.initialBuild || nd.data;
    if (build?.spells)   result.spells   = build.spells.map(s => ({
      id:s.id, name:s.name||s.nameFr||'', element:s.element||'',
      apCost:s.apCost||0, damageMin:s.damageMin||0, damageMax:s.damageMax||s.baseDamage||0,
    }));
    if (build?.passives) result.passives = build.passives.map(p => ({id:p.id, name:p.name||p.nameFr||''}));
  }

  // ── Output ───────────────────────────────────────────────────────
  const hasMast = !!result.stats['maîtriseFeu'];
  console.log('══════════════════════════════════════════');
  console.log('WAKFULI EXTRACT v4');
  console.log('══════════════════════════════════════════');
  console.log(`Classe  : ${result.character.class || '⚠ non détectée'}`);
  console.log(`Niveau  : ${result.character.level || '⚠ non détecté'}`);
  console.log(`Maîtrises élémentaires : ${hasMast
    ? `🔴${result.stats['maîtriseFeu']} 🔵${result.stats.maitriseEau} 🟢${result.stats.maitriseTerre} 🟡${result.stats.maitriseAir}`
    : '⚠ non trouvées'}`);
  console.table(result.stats);

  const json = JSON.stringify(result, null, 2);
  console.log(json);
  navigator.clipboard?.writeText(json)
    .then(() => console.log('✅ Copié !'))
    .catch(() => console.log('⚠ Copie manuelle nécessaire.'));
  return result;
})();
