/*
 * build-monsters.js — générateur du bestiaire
 * ──────────────────────────────────────────────────────────────────────────
 * Convertit data-raw/monsters-ankama.json (extrait du jeu via le wakfu-autobuilder
 * de Chosante) vers data-game compact window.WCA_MONSTERS.
 *
 * Source = données officielles Ankama (résistances par élément, niveau, PV, famille).
 * Sur-ensemble plus à jour que l'ancien bestiaire (2841 vs 885), résistances révisées.
 *
 * Format compact (lu par normTarget/elRes et l'affichage de recherche) :
 *   { id, n, lv, hp, rf (feu), re (eau), rt (terre), ra (air), fam? }
 *
 * Usage :  node build-monsters.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data-raw', 'monsters-ankama.json');
const OUT = path.join(__dirname, 'data-monsters.js');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Nom/famille : on garde le français (l'app est francophone). Résistances signées
// (une valeur négative = faiblesse, légitime). On omet les champs vides pour la taille.
const monsters = raw
  .map(m => {
    const o = {
      id: m.id,
      n: (m.name && m.name.fr) || m.name || '?',
      lv: m.level || 0,
      hp: m.hp || 0,
      rf: m.fireResistance || 0,
      re: m.waterResistance || 0,
      rt: m.earthResistance || 0,
      ra: m.airResistance || 0,
    };
    const fam = m.family && m.family.fr;
    if (fam) o.fam = fam;
    return o;
  })
  // Tri par niveau puis nom : recherche et affichage cohérents.
  .sort((a, b) => (a.lv - b.lv) || a.n.localeCompare(b.n));

const header =
  '// ── MONSTRES (résistances + niveau + famille) ────────────────────────────────\n' +
  '// ⚠ FICHIER GÉNÉRÉ — Source : data-raw/monsters-ankama.json (extraction Ankama via\n' +
  '// le wakfu-autobuilder de Chosante). Régénérer avec :  node build-monsters.js\n' +
  '// Champs : id, n, lv, hp, rf (feu), re (eau), rt (terre), ra (air), fam?.\n';

fs.writeFileSync(OUT, header + 'window.WCA_MONSTERS=' + JSON.stringify(monsters) + ';\n', 'utf8');
console.log(`✅ data-monsters.js : ${monsters.length} monstres`);
