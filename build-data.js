/*
 * build-data.js — générateur des données de jeu
 * ──────────────────────────────────────────────────────────────────────────
 * Lit les CSV de data-raw/ (scrapés depuis l'encyclopédie via les bookmarklets
 * extract-spells-encyclo.js / extract-passives-encyclo.js) et génère :
 *   - data-game.js   → window.WCA_SPELLS (sorts + passifs, toutes classes)
 *   - data-commun.js → window.WCA_COMMON_SPELLS + window.WCA_GENERAL_PASSIVES
 *
 * Usage :  node build-data.js
 *
 * Les CSV sont la SOURCE DE VÉRITÉ. Ne pas éditer data-game.js à la main :
 * relancer ce script après toute mise à jour d'un CSV.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'data-raw');

// ── Mapping nom de fichier CSV → clé de classe canonique ───────────────────
// (mêmes clés que les extracteurs de build zenith/wakfuli et le <select> HTML)
const CLASS_KEY = {
  Cra: 'cra', Ecaflip: 'ecaflip', Eliotrope: 'eliotrope', Eniripsa: 'eniripsa',
  Enutrof: 'enutrof', Feca: 'feca', Huppermage: 'huppermage', Iop: 'iop',
  Osamodas: 'osamodas', Ouginak: 'ouginak', Pandawa: 'pandawa', Roublard: 'rogue',
  Sacrieur: 'sacrier', Sadida: 'sadida', Sram: 'sram', Steamer: 'foggernaut',
  Xelor: 'xelor', Zobal: 'masqueraider',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const ELEM = { feu: 'Feu', eau: 'Eau', terre: 'Terre', air: 'Air', neutre: 'Neutre' };

function clean(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
function num(s) { const n = parseInt(clean(s), 10); return Number.isFinite(n) ? n : 0; }

// Parseur CSV minimal (séparateur ';', pas de guillemets dans nos données).
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  const header = lines.shift().split(';').map(clean);
  return lines.map(line => {
    const cols = line.split(';');
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i] !== undefined ? cols[i] : ''; });
    return row;
  });
}

// Recompose une description lisible : effets en priorité, sinon description.
// On garde la description courte de l'encyclopédie ; les effets détaillent le sort.
function buildDesc(row) {
  const eff = clean(row['Effets']);
  const desc = clean(row['Description']);
  if (eff && desc) return desc + '\n' + eff;
  return eff || desc || '';
}

// Génération de Point Faible (Sram uniquement) : « Point Faible (+N Niv.) ».
// On somme les gains INCONDITIONNELS uniquement. Un gain situé dans une clause
// conditionnelle « Si … : … » (jusqu'au prochain «.») est exclu, car non garanti.
// Fallback : un sort qui « génère du Point Faible » sans valeur chiffrée (effets
// parfois vides dans l'encyclopédie, ex. Châtiment) suit la règle observée 5×PA.
// Retire les clauses conditionnelles « Si … . » (jusqu'au prochain point) : un gain
// de ressource qui s'y trouve n'est pas garanti. La conséquence peut être introduite
// par « : » ou par « , » (ex. « Si ce sort tue un combattant, regagne … »).
function stripConditional(text) {
  return text.replace(/\bSi\b[^.]*?\./gi, ' ');
}
function parsePF(effects, desc, ap) {
  const unconditional = stripConditional(effects);
  let pf = 0, m;
  const re = /Point\s*Faible\s*\(\+?\s*(\d+)\s*Niv\.?\)/gi;
  while ((m = re.exec(unconditional)) !== null) pf += num(m[1]);
  // Pas de valeur explicite mais le sort annonce générer du Point Faible → 5×PA.
  if (pf === 0 && /g[ée]n[èe]re\s+du\s+point\s*faible/i.test(desc) && !isFinisher(effects, desc)) {
    pf = 5 * (ap || 0);
  }
  return pf;
}

// Sort « finisseur » : consomme le Point Faible pour des dégâts supplémentaires.
// On exige la phrase « Consomme Point Faible » ou « N % dommages … par Point Faible »
// (et PAS « Consomme l'Hémorragie » qui contient parfois un « +1 PointFaible »).
// On lit Effets ET Description (la colonne Effets est parfois vide).
function isFinisher(effects, desc) {
  const t = (effects + ' ' + desc).toLowerCase();
  return /consomme\s+(le\s+)?point\s*faible/.test(t) ||
         /dommages?\s+suppl.*par\s+point\s*faible/.test(t);
}

// ── Ressources de classe (générique) ────────────────────────────────────────
// Chaque classe à jauge déclare comment parser le gain d'un sort :
//   token  : motif « <Token> (+N Niv.) »  (Iop : Concentration)
//   parse  : fonction (effets+desc) → nombre, pour les formulations en prose
//            (Crâ : « génère N d'Affûtage et de Précision »).
// `gen` = ressource générée (inconditionnelle). Le bonus de dégâts éventuel est
// modélisé côté runtime (mechanics.js), pas ici.
const RESOURCE = {
  Sram: { token: 'Point\\s*Faible' },        // déjà traité spécifiquement (pf/fin)
  Iop:  { token: 'Concentration' },           // jauge 0→100, bonus à 100
  Cra:  { parse: parseCraGen },               // Affûtage/Précision (même valeur), prose
};
// Parse le gain de ressource « <Token> (+N Niv.) », gains inconditionnels seulement.
function parseResource(effects, cfg) {
  if (cfg.parse) return cfg.parse(effects);
  const unconditional = stripConditional(effects);
  let g = 0, m;
  const re = new RegExp(cfg.token + '\\s*\\(\\+?\\s*(\\d+)\\s*Niv\\.?\\)', 'gi');
  while ((m = re.exec(unconditional)) !== null) g += num(m[1]);
  return g;
}
// Crâ : « Ce sort génère N d'Affûtage et de Précision. » → N (Affûtage == Précision).
function parseCraGen(text) {
  const m = text.match(/g[ée]n[èe]re\s+(\d+)\s+d.?Aff[ûu]tage/i);
  return m ? num(m[1]) : 0;
}
// Crâ — Tir précis : version alternative du sort. On extrait les dégâts DIRECTS en
// Tir précis et la Précision consommée (« Consomme M de Précision »).
// `tp` = dégât total en Tir précis (omis si Tir précis ne change pas le dégât direct).
// Deux formes : « Dommage : N » (remplace) ou « Dommage supplémentaires : N » (+ base).
function parseTirPrecis(effects, baseDmg) {
  const out = {};
  const cost = effects.match(/Consomme\s+(\d+)\s+de\s+Pr[ée]cision/i);
  if (cost) out.tpCost = num(cost[1]);
  // Dégât de base hors Tir précis (premier « Dommage : N » de la partie normale).
  const seg = effects.split(/Tir\s*pr[ée]cis\s*:/i)[1];
  if (seg) {
    const supp = seg.match(/Dommages?\s+suppl[ée]mentaires?\s*:?\s*(\d+)/i);
    const plain = seg.match(/Dommage\s*:?\s*(\d+)/i);
    if (supp) {
      // « Dommage supplémentaires : N » → base + N (dégât direct).
      if (!/sur\s+invocations/i.test(seg)) out.tp = (baseDmg || 0) + num(supp[1]);
    } else if (plain && !/sur\s+invocations/i.test(seg.slice(0, plain.index + 30))) {
      out.tp = num(plain[1]); // « Dommage : N » remplace le dégât de base
    }
  }
  return out;
}

// Dégât conditionnel « Si <condition> : … Dommage : N à la place ».
// Renvoie { altDmg, altCond } où altCond est un id court (stabilise, cible_armure…).
// Utilisé pour les sorts dont une condition remplace le dégât de base (Sacrieur :
// Aversion si stabilisé, Fracasse si la cible a de l'Armure).
const ALT_COND = [
  { id: 'stabilise',    re: /stabilis[ée]/i },
  { id: 'cible_armure', re: /la\s+cible\s+poss[èe]de\s+de\s+l.?Armure/i },
  { id: 'tresors',      re: /l.?Enutrof\s+a\s+l.?[ée]tat\s+Tr[ée]sors/i }, // Enutrof : Epuration
];
function parseAltDmg(effects) {
  // On cherche un « Dommage : N à la place » et la condition « Si … : » qui le précède.
  const m = effects.match(/Si\b([^:]*):[^]*?Dommage\s*:?\s*(\d+)\s*à\s+la\s+place/i);
  if (!m) return {};
  const condText = m[1];
  const cond = ALT_COND.find(c => c.re.test(condText));
  return cond ? { altDmg: num(m[2]), altCond: cond.id } : {};
}

// Eliotrope — modes Serein/Exalté + bonus Portail. Le dégât de base `dm` = Serein
// sans portail. On extrait :
//   exaltedDmg : dégât en mode Exalté (« Exalté : … Dommage : N ») si différent
//   portalDmg  : dégât si le sort passe par/sur un Portail (remplace le base)
//   portalBonus: dégât ADDITIONNEL via Portail (« Dommage : N supplémentaires »)
function parseEliotrope(effects, baseDmg) {
  const out = {};
  // Mode Exalté : segment après « Exalté : » jusqu'au prochain mot-clé.
  const ex = effects.split(/Exalt[ée]\s*:/i)[1];
  if (ex) {
    const d = ex.match(/Dommage\s*:?\s*(\d+)/i);
    if (d && num(d[1]) !== baseDmg) out.exaltedDmg = num(d[1]);
  }
  // Bonus Portail : « Dommage : N supplémentaires » (s'ajoute) prioritaire,
  // sinon « (traverse|sur) un Portail … Dommage : N » (remplace).
  const supp = effects.match(/Dommage\s*:?\s*(\d+)\s*suppl[ée]mentaires/i);
  if (supp) {
    out.portalBonus = num(supp[1]);
  } else {
    const pm = effects.match(/(?:traverse|sur|lanc[ée]\s+sur)\s+un\s+Portail[^]*?Dommage\s*:?\s*(\d+)/i);
    if (pm && num(pm[1]) !== baseDmg) out.portalDmg = num(pm[1]);
  }
  return out;
}

// Eniripsa — dégâts conditionnels selon les PV (évalués automatiquement) :
//   lowTgtDmg     : dégât si la CIBLE a < 80 % PV (« Sinon : Dommage : N »).
//                   Le base `dm` est alors le cas cible ≥ 80 % PV (Anatomie).
//   selfHpBonus   : dégât ADDITIONNEL si l'ENIRIPSA a ≥ 80 % PV (Torpeur).
function parseEniripsa(effects, baseDmg) {
  const out = {};
  // « Si la cible possède plus de 80 % … Dommage : A … Sinon : … Dommage : B »
  if (/cible\s+poss[èe]de\s+plus\s+de\s+80\s*%/i.test(effects)) {
    const sinon = effects.split(/Sinon\s*:/i)[1];
    if (sinon) { const d = sinon.match(/Dommage\s*:?\s*(\d+)/i); if (d) out.lowTgtDmg = num(d[1]); }
  }
  // « Si l'Eniripsa possède >= 80 % PV : - Dommage : N supplémentaires »
  if (/Eniripsa\s+poss[èe]de\s*>?=?\s*80\s*%/i.test(effects)) {
    const seg = effects.split(/Eniripsa\s+poss[èe]de[^:]*:/i)[1];
    if (seg) { const d = seg.match(/Dommage\s*:?\s*(\d+)\s*suppl[ée]mentaires/i); if (d) out.selfHpBonus = num(d[1]); }
  }
  return out;
}

// Huppermage — dégâts qui scalent avec la jauge de BQ (Brise Quadramentale).
//   bqScale : % de dégâts supplémentaires par % de BQ restante (Rayon crépusculaire :
//             « 0.5 % Dommages supplémentaires par %BQ restante » → 0.5).
function parseHuppermage(effects) {
  const m = effects.match(/([\d.]+)\s*%\s*Dommages?\s+suppl[ée]mentaires\s+par\s*%?\s*BQ/i);
  return m ? { bqScale: parseFloat(m[1]) } : {};
}

// ── Sorts de classe ─────────────────────────────────────────────────────────
function buildSpells(classDisplay) {
  const file = path.join(RAW, `Sorts_${classDisplay}.csv`);
  if (!fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  const isSram = classDisplay === 'Sram';
  const resCfg = RESOURCE[classDisplay];
  return rows.map(r => {
    const eff = clean(r['Effets']);
    const descRaw = clean(r['Description']); // pour le parse ressource/finisseur (effets parfois vides)
    const desc = buildDesc(r);
    const ap = num(r['CoutPA']);
    // Ressource de classe générique (`gen`). Pour le Sram, `pf` reste le canal
    // historique ; pour les autres classes à jauge, on remplit `gen`.
    const gen = (resCfg && !isSram) ? parseResource(eff + ' ' + descRaw, resCfg) : 0;
    // Crâ — Tir précis : dégâts alternatifs + Précision consommée.
    const tp = (classDisplay === 'Cra') ? parseTirPrecis(eff, num(r['Dommage lvl245'])) : {};
    // Dégât conditionnel « … à la place » (Sacrieur : stabilisé/Armure ; Enutrof : Trésors).
    const alt = (classDisplay === 'Sacrieur' || classDisplay === 'Enutrof') ? parseAltDmg(eff) : {};
    // Eliotrope — modes Serein/Exalté + bonus Portail.
    const elio = (classDisplay === 'Eliotrope') ? parseEliotrope(eff, num(r['Dommage lvl245'])) : {};
    // Eniripsa — dégâts conditionnels selon les PV (cible / soi-même).
    const eni = (classDisplay === 'Eniripsa') ? parseEniripsa(eff, num(r['Dommage lvl245'])) : {};
    // Huppermage — scaling sur la jauge de BQ.
    const hup = (classDisplay === 'Huppermage') ? parseHuppermage(eff) : {};
    const sp = {
      n: clean(r['Nom']),
      el: ELEM[clean(r['Element']).toLowerCase()] || 'Neutre',
      ap,
      mp: num(r['CoutPm'] || r['CoutPM']),
      wp: num(r['CoutPW']),
      dm: num(r['Dommage lvl245']),
      dc: num(r['Dommage lvl245 critique']),
      pf: isSram ? parsePF(eff, descRaw, ap) : 0,
      fin: isSram ? isFinisher(eff, descRaw) : false,
      gen: gen || undefined, // ressource générée (Concentration Iop, Affûtage Crâ…) ; omis si 0
      tp: tp.tp,             // Crâ : dégâts en Tir précis (omis si inchangé)
      tpCost: tp.tpCost,     // Crâ : Précision consommée par Tir précis
      altDmg: alt.altDmg,    // dégât conditionnel « à la place » (Sacrieur)
      altCond: alt.altCond,  // id de la condition (stabilise, cible_armure)
      exaltedDmg: elio.exaltedDmg,   // Eliotrope : dégât en mode Exalté
      portalDmg: elio.portalDmg,     // Eliotrope : dégât via Portail (remplace)
      portalBonus: elio.portalBonus, // Eliotrope : dégât additionnel via Portail
      lowTgtDmg: eni.lowTgtDmg,       // Eniripsa : dégât si cible < 80 % PV (Anatomie)
      selfHpBonus: eni.selfHpBonus,   // Eniripsa : dégât bonus si Eni >= 80 % PV (Torpeur)
      bqScale: hup.bqScale,           // Huppermage : % dégâts par %BQ (Rayon crépusculaire)
      lvl: num(r['NiveauDebloque']),
      rng: clean(r['Portée']) || '',
      type: clean(r['Type']) || '',
      los: /^oui$/i.test(clean(r['Ligne de vue'])),
      desc,
    };
    return sp;
  }).filter(s => s.n);
}

// ── Passifs de classe ────────────────────────────────────────────────────────
function buildPassives(classDisplay) {
  const file = path.join(RAW, `Passifs_${classDisplay}.csv`);
  if (!fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  return rows.map(r => ({
    n: clean(r['Nom']),
    lvl: num(r['Niveau de deblocage'] || r['Niveau de déblocage']),
    desc: clean(r['Effets']),
  })).filter(p => p.n);
}

// ── Données communes ──────────────────────────────────────────────────────────
function buildCommonSpells() {
  const file = path.join(RAW, 'Sorts_commun.csv');
  if (!fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  return rows.map(r => ({
    n: clean(r['Nom']),
    el: 'Neutre',
    ap: num(r['CoutPA']),
    mp: num(r['CoutPM'] || r['CoutPm']),
    wp: num(r['CoutPW']),
    dm: 0,
    lvl: num(r['Niveau de déblocage'] || r['Niveau de deblocage']),
    rng: clean(r['Portée']) || '',
    desc: clean(r['Effets']),
  })).filter(s => s.n);
}

// Bonus de stats des passifs généraux : ces valeurs ne sont pas dans le CSV,
// elles sont calibrées à la main et conservées entre régénérations.
const GENERAL_PASSIVE_STATS = {
  'Evasion':     { sbl: { esquive: 1.0 } },
  'Interception':{ sbl: { tacle: 1.0 } },
  'Inspiration': { sbl: { initiative: 0.5 } },
  'Motivation':  { sb: { ap: 1, volonte: 10, degatsInfliges: -20 } },
  'Médecine':    { sb: { degatsInfliges: -15, soinsRealises: 30 } },
  'Rock':        { sb: { degatsInfliges: -25, soinsRealises: -50, hpPct: 60 } },
  'Carnage':     { sb: { degatsInfliges: 15, soinsRealises: -30 } },
};
function buildGeneralPassives() {
  const file = path.join(RAW, 'Passifs_commun.csv');
  if (!fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  return rows.map(r => {
    const name = clean(r['Nom']);
    const p = { n: name, lvl: num(r['Niveau de deblocage'] || r['Niveau de déblocage']), desc: clean(r['Effets']) };
    Object.assign(p, GENERAL_PASSIVE_STATS[name] || {});
    return p;
  }).filter(p => p.n);
}

// ── Génération ────────────────────────────────────────────────────────────────
function main() {
  const spells = {};
  let totSpells = 0, totPassives = 0, classCount = 0;
  for (const [display, key] of Object.entries(CLASS_KEY)) {
    const sp = buildSpells(display);
    const pa = buildPassives(display);
    if (!sp.length && !pa.length) { console.warn(`⚠ ${display} : aucune donnée`); continue; }
    spells[key] = { spells: sp, passives: pa };
    totSpells += sp.length; totPassives += pa.length; classCount++;
    console.log(`  ${display.padEnd(11)} → ${key.padEnd(13)} ${String(sp.length).padStart(2)} sorts, ${String(pa.length).padStart(2)} passifs`);
  }

  const gameHeader =
`// ── DONNÉES DE JEU (sorts + passifs, toutes classes) ─────────────────────────
// ⚠ FICHIER GÉNÉRÉ — ne pas éditer à la main. Source : data-raw/Sorts_*.csv et
// Passifs_*.csv. Régénérer avec :  node build-data.js
// Sorts  : n, el, ap, mp, wp, dm (dommage niv.245), dc (crit niv.245),
//          pf (Point Faible généré — Sram), fin (finisseur), lvl, rng, type, los, desc.
// Passifs: n, lvl, desc.
`;
  fs.writeFileSync(
    path.join(__dirname, 'data-game.js'),
    gameHeader + 'window.WCA_SPELLS=' + JSON.stringify(spells) + ';\n',
    'utf8'
  );

  const common = buildCommonSpells();
  const general = buildGeneralPassives();
  const commonHeader =
`// ── DONNÉES COMMUNES (toutes classes) ─────────────────────────────
// ⚠ FICHIER GÉNÉRÉ — ne pas éditer à la main. Source : data-raw/Sorts_commun.csv
// et Passifs_commun.csv. Régénérer avec :  node build-data.js
// Sorts communs (utilitaires, 0 dmg) : n, el, ap, mp, wp, dm, lvl, rng, desc.
// Passifs : n, lvl, desc, sb (bonus stats fixe), sbl (bonus stats × niveau perso).
`;
  const commonBody =
    'window.WCA_COMMON_SPELLS = ' + JSON.stringify(common, null, 2) + ';\n\n' +
    'window.WCA_GENERAL_PASSIVES = ' + JSON.stringify(general, null, 2) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'data-commun.js'), commonHeader + commonBody, 'utf8');

  console.log('───────────────────────────────────────────────');
  console.log(`✅ data-game.js   : ${classCount} classes, ${totSpells} sorts, ${totPassives} passifs`);
  console.log(`✅ data-commun.js : ${common.length} sorts communs, ${general.length} passifs généraux`);
}

main();
