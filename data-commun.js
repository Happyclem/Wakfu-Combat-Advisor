// ── DONNÉES COMMUNES (toutes classes) ─────────────────────────────
// Généré depuis Sorts_commun.csv et Passifs_commun.csv (sources propres).
// Sorts communs (utilitaires, 0 dmg) : n, el, ap, dm, lvl, rng, desc.
// Passifs : n, lvl, desc, sb (bonus stats fixe), sbl (bonus stats × niveau perso).

window.WCA_COMMON_SPELLS = [
  {"n": "Maîtrise d'Armes", "el": "Neutre", "ap": 2, "dm": 0, "lvl": 30, "rng": "0", "desc": "100 % Dommages et Soins réalisés avec une arme. Après l'utilisation d'une arme : À la fin du tour : Maîtrise d'Armes est désappliquée"},
  {"n": "Os à Moelle", "el": "Neutre", "ap": 3, "dm": 0, "lvl": 56, "rng": "1-4", "desc": "Invoque un Os à Moelle. En fin de tour du lanceur : L'Os à Moelle perd 1 % PV max. Soin: 33 autour de l'Os à Moelle"},
  {"n": "Charme de Masse", "el": "Neutre", "ap": 2, "dm": 0, "lvl": 130, "rng": "1-4", "desc": "+150 Tacle. Attire de 2 cases"},
];

window.WCA_GENERAL_PASSIVES = [
  {"n": "Evasion", "lvl": 10, "desc": "100 % du niveau en Esquive. Après avoir esquivé (avec pertes) : 35 % du niveau en Esquive (3 tours)", "sbl": {"esquive": 1.0}},
  {"n": "Interception", "lvl": 15, "desc": "100 % du niveau en Tacle. Après avoir taclé un fighter : 35 % du niveau en Tacle (3 tours)", "sbl": {"tacle": 1.0}},
  {"n": "Inspiration", "lvl": 25, "desc": "50 % du niveau en Initiative. 10 % Dommages infligés aux fighter ayant plus d'Initiative", "sbl": {"initiative": 0.5}},
  {"n": "Motivation", "lvl": 35, "desc": "+1 PA. -20 % Dommages infligés. +10 Volonté", "sb": {"ap": 1, "volonte": 10, "degatsInfliges": -20}},
  {"n": "Médecine", "lvl": 55, "desc": "+30 % Soins réalisés. +25 % Armure donnée. -15 % Dommages infligés", "sb": {"degatsInfliges": -15, "soinsRealises": 30}},
  {"n": "Rock", "lvl": 65, "desc": "+60 % Points de Vie. +25 % Soins reçus. -25 % Dommages infligés. -50 % Soins réalisés", "sb": {"degatsInfliges": -25, "soinsRealises": -50, "hpPct": 60}},
  {"n": "Carnage", "lvl": 75, "desc": "+15 % Dommages infligés. 10 % Dommages infligés aux fighter ayant de l'Armure. -30 % Soins réalisés", "sb": {"degatsInfliges": 15, "soinsRealises": -30}},
  {"n": "Fluctuation", "lvl": 80, "desc": "Lorsque vous esquivez une fighter : Avec pertes : fighter Fluctuation (+10 Niv.). Sans perte : fighter Fluctuation (+15 Niv.). Lorsque vous taclez une fighter : fighter Fluctuation (+15 Niv.). Aux fighter terminant leur tour à votre contact : fighter Fluctuation (+20 Niv.)"},
];
