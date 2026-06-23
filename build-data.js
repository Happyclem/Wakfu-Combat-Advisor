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

// ── Dégâts officiels Ankama (extraits du jeu via wakfu-autobuilder de Chosante) ──
// `spells-ankama.json`  : valeur encyclopédie niv.245 (baseDamage/critDamage) par id.
// `spell-damage.json`   : formule de scaling par sort, hit(lvl)=floor(base + inc·lvl)
//                         (et critBase/critInc), exacte à tout niveau. `matched=false`
//                         = formule approchée (base 0, inc=val/levelCap) quand l'effet
//                         bdata exact n'a pas été retrouvé (DoT, aléatoire…).
// Ces valeurs corrigent les dégâts scrapés de l'encyclopédie (qui sur-évaluaient le
// Sram de ~10 %, cf. data-formula-audit) ET donnent le scaling exact par niveau.
// On les apparie par `id` Ankama (colonne Id des CSV).
function loadJSON(name) {
  const p = path.join(RAW, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
const ANKAMA_SPELLS = loadJSON('spells-ankama.json'); // [{id, baseDamage, critDamage, element, …}]
const ANKAMA_SCALING = loadJSON('spell-damage.json'); // [{spellId, base, inc, critBase, critInc, levelCap, matched}]
const ankamaById = new Map((ANKAMA_SPELLS || []).map(s => [s.id, s]));
const scalingById = new Map((ANKAMA_SCALING || []).map(s => [s.spellId, s]));
// Sorts où NOTRE valeur encyclopédie (CSV) est juste et celle d'Ankama mal ancrée :
// Saccade / Perforation — l'extraction Ankama a ancré sur le dégât « sur l'Armure »
// (effet conditionnel) au lieu du dégât normal. On garde donc le CSV pour ces id.
const ANKAMA_DMG_BLACKLIST = new Set([6264 /* Saccade */, 6467 /* Perforation */]);
// Dégât niv.1 / niv.245 (normal + crit) d'un sort selon Ankama, ou null si non apparié
// ou blacklisté. Renvoie aussi base/inc pour exposer le scaling exact côté runtime.
function ankamaDamage(id) {
  if (!id || ANKAMA_DMG_BLACKLIST.has(id)) return null;
  const enc = ankamaById.get(id), sc = scalingById.get(id);
  if (!enc || enc.baseDamage == null) return null;
  // On n'expose les coefficients de scaling que si l'effet bdata exact a été retrouvé
  // (`matched`). Sinon la formule est une approximation (base 0) qui ne reproduit même
  // pas la valeur niv.245 au floor près → on laisse le runtime interpoler sur dm1↔dm.
  const exact = sc && sc.matched;
  const fl = (b, i) => Math.floor(b + i * 1 + 1e-9); // hit au niveau 1
  return {
    dm: enc.baseDamage,
    dc: enc.critDamage != null ? enc.critDamage : enc.baseDamage,
    dm1: exact ? fl(sc.base, sc.inc) : (sc ? Math.round(sc.inc * 1) : 0),
    dc1: exact ? fl(sc.critBase, sc.critInc) : 0,
    base: exact ? sc.base : undefined, inc: exact ? sc.inc : undefined,
    critBase: exact ? sc.critBase : undefined, critInc: exact ? sc.critInc : undefined,
  };
}

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

// Usages par tour d'un sort. Priorité : colonne CSV « Usages » (si renseignée) →
// valeur « N utilisation(s) par tour » trouvée dans les effets/description →
// défaut 3 (cap commun à la plupart des sorts Wakfu ; à affiner au cas par cas).
const DEFAULT_USES = 3;
function parseUses(rawCol, text) {
  const col = parseInt(clean(rawCol), 10);
  if (Number.isFinite(col) && col > 0) return col;
  const m = (text || '').match(/(\d+)\s*utilisation(?:s)?\s*par\s*tour/i);
  if (m) { const v = parseInt(m[1], 10); if (v > 0) return v; }
  return DEFAULT_USES;
}

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
// Point Faible conditionnel « si la cible est de dos » (ex. Kleptosram +5). Ce gain
// est exclu de parsePF (clause « Si … . » strippée) car non garanti ; on le récupère
// ici pour l'ajouter au runtime quand la position choisie est « dos ».
function parsePFDos(effects) {
  let pf = 0, m;
  const re = /Si\s+la\s+cible\s+est\s+de\s+dos\b[^.]*?Point\s*Faible\s*\(\+?\s*(\d+)\s*Niv\.?\)/gi;
  while ((m = re.exec(effects)) !== null) pf += num(m[1]);
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
  { id: 'hors_ldv',     re: /n.?est\s+pas\s+dans\s+la\s+ligne\s+de\s+vue/i }, // Osamodas : Corbeau
  { id: 'self_high_hp', re: /poss[èe]de\s+plus\s+de\s+80\s*%\s+de\s+ses\s+PV/i }, // Ouginak : ≥80 % PV (auto)
  { id: 'bastonne',     re: /cible\s+est\s+Bastonn[ée]/i },   // Ouginak : Bastonnade
  { id: 'contact',      re: /au\s+contact\s+de\s+l.?Ouginak/i }, // Ouginak : Balayage
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

// Osamodas — Forme draconique : dégât alternatif du sort en forme draconique
//   dracoDmg : dégât en forme draconique (« Forme draconique … Dommage : N »),
//              omis s'il est identique au dégât de base.
function parseOsamodas(effects, baseDmg) {
  const seg = effects.split(/Forme\s+draconique/i)[1];
  if (!seg) return {};
  const d = seg.match(/Dommage\s*:?\s*(\d+)/i);
  return (d && num(d[1]) !== baseDmg) ? { dracoDmg: num(d[1]) } : {};
}

// Dégât chargeable « Par niveau de <X> : Dommage(s) supplémentaires : N » → N.
// Un état/compteur s'accumule puis ajoute N de dégâts par niveau à un sort donné.
// Roublard : Pulsar (charge sur soi). Sadida : Engrainé (Tremblement de Terre).
function parseChargeable(effects) {
  // « Par niveau de/d'<X> : … Dommage(s) [supplémentaires] : N » — robuste à
  // l'apostrophe (d'Engrainé) et au « de » (de Pulsar).
  const m = effects.match(/Par\s+niveau\s+d[^:]*:[^:]*?Dommages?\s*(?:suppl[ée]mentaires)?\s*:\s*(\d+)/i);
  return m ? { chargePerLvl: num(m[1]) } : {};
}

// Steamer — Choc scale avec les Points de Stasis (PS) : « 5 % dommages supp. par PS
// courant (max 50 %) ». psScale = % par PS ; psCap = plafond du bonus (%).
function parseSteamerPS(effects) {
  const m = effects.match(/([\d.]+)\s*%\s*dommages?\s+supp[^]*?par\s+PS[^]*?\(max\s+([\d.]+)\s*%/i);
  return m ? { psScale: parseFloat(m[1]), psCap: parseFloat(m[2]) } : {};
}
// Steamer — Pilonnage : « N supplémentaires à chaque fois que ce sort est lancé pendant
// le tour ». castBonus = dégât ajouté par lancer précédent du sort dans le tour.
function parseSteamerCast(effects) {
  const m = effects.match(/Dommage\s*:?\s*(\d+)\s*suppl[ée]mentaires\s+à\s+chaque\s+fois\s+que\s+ce\s+sort\s+est\s+lanc/i);
  return m ? { castBonus: num(m[1]) } : {};
}

// Pandawa — Tonneau porté : modifie les dégâts.
//   tonneauDmg  : dégât quand le Pandawa porte son Tonneau (« Si … porte … Dommage : N »).
//   tonneauMult : multiplicateur « (+N % quand il porte son Tonneau) » (ex. 10 → ×1.10).
function parsePandawa(effects, baseDmg) {
  const out = {};
  const mult = effects.match(/\(\+\s*(\d+)\s*%\s*quand\s+il\s+porte\s+son/i);
  if (mult) out.tonneauMult = num(mult[1]);
  const seg = effects.split(/Si\s+le\s+Pandawa\s+porte/i)[1];
  if (seg) {
    const d = seg.match(/Dommage\s*:?\s*(\d+)/i);
    if (d && num(d[1]) !== baseDmg) out.tonneauDmg = num(d[1]);
  }
  return out;
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
    // Dégât conditionnel « … à la place » (Sacrieur : stabilisé/Armure ; Enutrof : Trésors ;
    // Osamodas : Corbeau hors ligne de vue, Fouet vs invocation [hors champ : invocations non suivies]).
    const alt = (classDisplay === 'Sacrieur' || classDisplay === 'Enutrof' || classDisplay === 'Osamodas' || classDisplay === 'Ouginak') ? parseAltDmg(eff) : {};
    // Osamodas — Forme draconique : dégât alternatif.
    const osa = (classDisplay === 'Osamodas') ? parseOsamodas(eff, num(r['Dommage lvl245'])) : {};
    // Pandawa — Tonneau porté : dégât alternatif / multiplicateur.
    const pan = (classDisplay === 'Pandawa') ? parsePandawa(eff, num(r['Dommage lvl245'])) : {};
    // Dégât chargeable (Roublard : Pulsar ; Sadida : Engrainé / Tremblement de Terre).
    const rog = (classDisplay === 'Roublard' || classDisplay === 'Sadida') ? parseChargeable(eff) : {};
    // Steamer — Choc (scaling PS) + Pilonnage (bonus par lancer dans le tour).
    const stm = (classDisplay === 'Steamer') ? { ...parseSteamerPS(eff), ...parseSteamerCast(eff) } : {};
    // Eliotrope — modes Serein/Exalté + bonus Portail.
    const elio = (classDisplay === 'Eliotrope') ? parseEliotrope(eff, num(r['Dommage lvl245'])) : {};
    // Eniripsa — dégâts conditionnels selon les PV (cible / soi-même).
    const eni = (classDisplay === 'Eniripsa') ? parseEniripsa(eff, num(r['Dommage lvl245'])) : {};
    // Huppermage — scaling sur la jauge de BQ.
    const hup = (classDisplay === 'Huppermage') ? parseHuppermage(eff) : {};
    // Dégâts officiels Ankama (si le sort est apparié par id et non blacklisté).
    // Source de vérité pour dm/dc/dm1/dc1 + coefficients de scaling exact ; sinon CSV.
    const adm = ankamaDamage(num(r['Id']));
    const sp = {
      n: clean(r['Nom']),
      el: ELEM[clean(r['Element']).toLowerCase()] || 'Neutre',
      ap,
      mp: num(r['CoutPm'] || r['CoutPM']),
      wp: num(r['CoutPW']),
      u: parseUses(r['Usages'], eff + ' ' + descRaw),  // usages par tour (défaut 3 ; source autobuilder via colonne Usages)
      id: num(r['Id']) || undefined,                   // id officiel Ankama (clé d'appariement autobuilder)
      mcc: num(r['MaxParCible']) || undefined,         // max lancers par cible (0/absent = illimité)
      cd: num(r['Cooldown']) || undefined,             // cooldown en tours (0/absent = aucun)
      icon: num(r['iconId']) || undefined,             // iconId Ankama (affichage)
      // Dégâts : valeurs officielles Ankama si appariées, sinon valeurs CSV (encyclopédie).
      dm: adm ? adm.dm : num(r['Dommage lvl245']),
      dc: adm ? adm.dc : num(r['Dommage lvl245 critique']),
      // Scaling par niveau : coefficients exacts d'Ankama (hit(l)=floor(base+inc·l)).
      // Absents → le runtime retombe sur l'interpolation 2 points dm1↔dm.
      sb: adm && adm.base !== undefined ? +adm.base.toFixed(4) : undefined,
      si: adm && adm.inc !== undefined ? +adm.inc.toFixed(6) : undefined,
      scb: adm && adm.critBase !== undefined ? +adm.critBase.toFixed(4) : undefined,
      sci: adm && adm.critInc !== undefined ? +adm.critInc.toFixed(6) : undefined,
      // Dégâts au niveau 1 (ancrage bas, fallback si pas de coefficients de scaling).
      dm1: adm ? (adm.dm1 || undefined) : (num(r['Dommage lvl1']) || undefined),
      dc1: adm ? (adm.dc1 || undefined) : (num(r['Dommage lvl1 critique']) || undefined),
      pf: isSram ? parsePF(eff, descRaw, ap) : 0,
      pfDos: isSram ? (parsePFDos(eff) || undefined) : undefined, // PF bonus « de dos » (Kleptosram)
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
      dracoDmg: osa.dracoDmg,         // Osamodas : dégât en Forme draconique
      tonneauDmg: pan.tonneauDmg,     // Pandawa : dégât en portant le Tonneau
      tonneauMult: pan.tonneauMult,   // Pandawa : % de dégâts en plus avec le Tonneau
      chargePerLvl: rog.chargePerLvl, // Roublard/Sadida : dégât par niveau de charge
      psScale: stm.psScale, psCap: stm.psCap, // Steamer : scaling de Choc sur les PS
      castBonus: stm.castBonus,       // Steamer : Pilonnage +N par lancer dans le tour
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
    id: num(r['Id']) || undefined,
    mcc: num(r['MaxParCible']) || undefined,
    cd: num(r['Cooldown']) || undefined,
    icon: num(r['iconId']) || undefined,
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
//          pf (Point Faible généré — Sram), fin (finisseur), lvl, rng, type, los, desc,
//          id (id Ankama), mcc (max/cible), cd (cooldown), icon (iconId) — source autobuilder.
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
