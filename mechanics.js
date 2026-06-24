'use strict';
// ── MÉCANIQUES DE CLASSE ─────────────────────────────────────────────────────
// Chaque classe à ressource déclare ici son comportement. Objectif : modéliser
// chaque classe « en profondeur » comme le Sram, de façon générique.
//
// Interface d'une mécanique (toutes les clés sont optionnelles sauf `res`) :
//   res        {id,label,max,color}     — la jauge affichée
//   initial    nombre                   — valeur en début de combat (défaut 0)
//   gen(sp)    → nombre                  — ressource générée par un sort (défaut sp.resGen)
//   consumes(sp) → bool                  — le sort remet la jauge à 0 (finisseur)
//   next(val,sp,ctx) → nombre            — nouvelle valeur après lancer de `sp`
//   bonus(m)   → ×mult                   — multiplicateur GLOBAL de dégâts (état de jauge)
//   scales(sp) → bool                    — `sp` voit ses dégâts varier avec la jauge
//                                          (dans ce cas bonus() est neutralisé et
//                                           spellMult() applique la variation)
//   spellMult(sp,m,target) → ×mult       — multiplicateur SPÉCIFIQUE au sort
//   advice(m)  → [{p,msg}]               — conseils affichés
//   onState(actor,stateName,lvl,m)       — lecture de la jauge depuis le log
//
// `m` est l'objet ressource du joueur (S.combat.mechanics['__p']), `val` la valeur
// courante de la jauge (m[res.id]). `ctx` = { lethal, consumedThisTurn }.

(function (global) {

  // ── SRAM — Point Faible (refonte 1.92) ─────────────────────────────────────
  // Le Point Faible se génère (pf) et se consomme (finisseurs/ultimes). Depuis 1.92 :
  //  • Le maximum passe de 100 à 200.
  //  • Le ratio dégâts/PF est halvé : +0,5 % de dégâts par PF consommé (l'exemple du
  //    patch : 100 PF consommés = +50 % dégâts) → bonus ×1 → ×2.0 à 200 PF.
  //  • Les paliers de récompense (PA/PM/PW + Hémo) passent tous les 50 PF (au lieu de
  //    25) et les ultimes consomment le PF par tranche de 50.
  // ⚠ Recalibrage suivant l'exemple du patch ; à reconfirmer en jeu.
  const SRAM_PF_MAX = 200;
  const SRAM_PF_PER = 0.005; // +0,5 % de dégâts par PF (100 PF → +50 %, 200 → +100 %)
  const sram = {
    res: { id: 'pf', label: 'Point Faible', max: SRAM_PF_MAX, color: '#e05c5c' },
    initial: 0, // ⚠ supposé 0 en début de combat (à confirmer in-game)
    gen(sp) { return sp.pfGen || 0; },
    consumes(sp) {
      // Un sort qui GÉNÈRE du Point Faible n'en consomme pas (ex. « Ouvrir les veines »
      // consomme l'Hémorragie ET gagne du PF → ne doit PAS être pris pour un finisseur).
      if ((sp.pfGen || 0) > 0) return false;
      // « consomme le/du Point faible » (et non « consomme l'Hémorragie … Point faible »).
      return !!sp.isFinisher || /consomme\s+(le|du)\s+point\s*faible/i.test(sp.desc || '');
    },
    scales(sp) {
      return this.consumes(sp) || /arnaque/i.test(sp.name || '');
    },
    next(val, sp, ctx) {
      if (this.consumes(sp)) return 0;
      // Assassin : le coup qui tue ne génère pas de Point Faible.
      if (ctx && ctx.lethal && ctx.assassin) return val;
      // posBonus : PF conditionnel « de dos » (Kleptosram +5), ajouté par le runtime
      // selon la position choisie. Supprimé aussi par Assaut Brutal (suppressGen).
      const g = ctx && ctx.suppressGen ? 0 : this.gen(sp) + (ctx && ctx.posBonus || 0);
      return Math.min(SRAM_PF_MAX, val + g);
    },
    // ⚠ Le bonus de Point Faible n'est PAS un multiplicateur GLOBAL : il ne s'applique
    // qu'aux sorts qui CONSOMMENT le Point Faible (finisseurs/Arnaque), via spellDmgMult
    // (chemin isPFScaler). Renvoyer 1 ici, sinon le PF doublerait TOUS les sorts (y compris
    // les builders), ce qui pousserait à ne jamais dépenser le PF (jauge bloquée à 200).
    bonus() { return 1; },
    // Les multiplicateurs par sort restent dans wca.js (spellDmgMult) qui connaît
    // le scaling PF des finisseurs, Assaut Brutal, Attaque mortelle <50 % PV,
    // Châtiment/Effroi, l'Hémorragie…
    advice(m) {
      const pf = m.pf || 0, mult = (1 + pf * SRAM_PF_PER).toFixed(2);
      if (pf >= SRAM_PF_MAX) return [{ p: 'H', msg: `🔴 Point Faible MAX (${SRAM_PF_MAX}) → Finisseur/ultime ! (×2.00)` }];
      if (pf >= 100) return [{ p: 'M', msg: `🟡 Point Faible ${pf}/${SRAM_PF_MAX} (×${mult}) — palier ultime atteint (consomme par 50)` }];
      if (pf > 0)    return [{ p: 'L', msg: `⚪ Point Faible ${pf}/${SRAM_PF_MAX} (×${mult})` }];
      return [];
    },
    onState(a, n, lvl, m) { if (/point\s*faible/i.test(n)) m.pf = Math.min(SRAM_PF_MAX, lvl); },
  };

  // ── IOP — Concentration ────────────────────────────────────────────────────
  // La Concentration (0→100) s'accumule (gen) et ne se consomme PAS comme un
  // finisseur : à 100 le Iop entre en « Concentration max » → +10 % Dommages
  // infligés (⚠ valeur communément documentée, à confirmer in-game) et débloque
  // les dégâts bonus de l'état Égaré sur Fulgur (+55) et Colère de Iop (+91).
  //
  // Bonus Égaré débloqués à 100 (valeurs encyclopédie niv.245, mises à l'échelle
  // par le niveau du sort comme un dégât normal) :
  const IOP_FULL = 100;
  const IOP_FULL_DMG_MULT = 1.10;          // +10 % Dommages infligés à 100
  const IOP_EGARE_BONUS = {                 // dégâts Feu additionnels à Concentration 100
    'fulgur': 55,
    'colère de iop': 91, 'colere de iop': 91,
  };
  const iop = {
    res: { id: 'conc', label: 'Concentration', max: 100, color: '#ff8c3b' },
    initial: 0,
    gen(sp) { return sp.resGen || 0; },
    consumes() { return false; },           // la Concentration ne se vide pas par un sort
    next(val, sp) { return Math.min(IOP_FULL, val + this.gen(sp)); },
    bonus(m) { return (m.conc || 0) >= IOP_FULL ? IOP_FULL_DMG_MULT : 1; },
    // Bonus Égaré : dégâts Feu supplémentaires, uniquement à Concentration 100.
    egareBonus(sp) {
      return IOP_EGARE_BONUS[(sp.name || '').toLowerCase()] || 0;
    },
    advice(m) {
      const c = m.conc || 0;
      if (c >= IOP_FULL) return [{ p: 'H', msg: `🟠 Concentration MAX (×1.10) → Fulgur & Colère gagnent leur bonus Égaré, PW régénéré` }];
      if (c >= 70)  return [{ p: 'M', msg: `🟠 Concentration ${c}/100 — encore ${IOP_FULL - c} pour le palier (×1.10)` }];
      if (c > 0)    return [{ p: 'L', msg: `🟠 Concentration ${c}/100` }];
      return [{ p: 'L', msg: `🟠 Monte la Concentration (tape) : palier à 100 (×1.10 + Égaré)` }];
    },
    onState(a, n, lvl, m) { if (/concentration/i.test(n)) m.conc = Math.min(IOP_FULL, lvl); },
  };

  // ── CRÂ — Affûtage / Précision / Tir précis ────────────────────────────────
  // Le Crâ a deux jauges (même montée par sort) et un mode « Tir précis » :
  //  • Précision (0→200) : réserve consommée par Tir précis. Jauge affichée.
  //  • Affûtage  : à un seuil (« Pointe affûtée ») se consomme pour donner un bonus
  //    de Dommages infligés au sort suivant. ⚠ Le seuil et le % NE SONT PAS dans les
  //    données du jeu scrapées → non chiffré ici (signalé en conseil seulement),
  //    pour ne pas fausser le ranking avec une valeur inventée.
  //  • Tir précis (toggle) : chaque sort passe à sa version améliorée. On modélise
  //    son effet le mieux documenté : les dégâts `tp` du sort (parsés des effets) et
  //    la Précision consommée `tpCost`. Activable via le toggle situationnel.
  //
  // Mode `tir_precis` (clé dans S.situationalBuffs) : quand actif, un sort qui a un
  // dégât Tir précis chiffré (`tp`) l'utilise à la place de son dégât de base.
  const cra = {
    res: { id: 'prec', label: 'Précision', max: 200, color: '#5ad1c8' },
    initial: 0,
    gen(sp) { return sp.resGen || 0; },
    consumes() { return false; },
    // La Précision monte de `gen` par sort ; en Tir précis, le sort consomme `tpCost`.
    next(val, sp, ctx) {
      let v = Math.min(200, val + this.gen(sp));
      if (ctx && ctx.tirPrecis && sp.tpCost) v = Math.max(0, v - sp.tpCost);
      return v;
    },
    bonus() { return 1; }, // pas de multiplicateur continu (le levier est Tir précis)
    // Base de dégâts effective : en Tir précis, on prend les dégâts améliorés `tp`.
    baseDmg(sp, modes) {
      return (modes && modes.tir_precis && sp.tp) ? sp.tp : (sp.damageMax || sp.damageMin || 0);
    },
    // Mode(s) toggle exposé(s) à l'UI (système situationnel générique).
    modes: [{
      id: 'tir_precis', label: 'Tir précis',
      desc: 'Version améliorée des sorts (dégâts ↑, sous l\'Armure…), consomme de la Précision',
    }],
    advice(m) {
      const out = [];
      const p = m.prec || 0;
      out.push({ p: 'L', msg: `🎯 Précision ${p}/200 — réserve pour Tir précis (sorts améliorés)` });
      out.push({ p: 'L', msg: `🏹 Affûtage : à Pointe affûtée, ton prochain sort gagne des Dommages infligés (bonus non chiffré dans l'outil)` });
      return out;
    },
    onState(a, n, lvl, m) {
      if (/pr[ée]cision/i.test(n)) m.prec = Math.min(200, lvl);
    },
  };

  // ── SACRIEUR — Fureur / Berserk / dégâts conditionnels ─────────────────────
  // Identité : le Sacrieur tape plus fort quand il a PEU de PV (Berserk). La Fureur
  // (0→100) se remplit en ENCAISSANT des dégâts — l'outil ne simule pas le combat
  // reçu, donc la jauge est INFORMATIVE (alimentée depuis le log si dispo).
  //
  // ⚠ BERSERK NON CALIBRÉ : le % de dégâts par PV manquant n'est pas dans les
  // données scrapées. On applique une rampe linéaire ESTIMÉE (à confirmer in-game) :
  // pleine vie → ×1 ; à BERSERK_HP_FLOOR (20 % PV) ou moins → ×(1+BERSERK_MAX).
  // Sans suivi de PV (pas de log), hpFrac=null → aucun bonus (ranking honnête).
  const BERSERK_MAX = 0.25;        // +25 % de dégâts au berserk plein (ESTIMATION)
  const BERSERK_HP_START = 0.90;   // le bonus commence sous 90 % PV
  const BERSERK_HP_FLOOR = 0.20;   // bonus maximal à 20 % PV et en-dessous
  function berserkMult(hpFrac) {
    if (hpFrac == null) return 1;                       // PV inconnus → pas de bonus
    if (hpFrac >= BERSERK_HP_START) return 1;
    const t = Math.min(1, (BERSERK_HP_START - hpFrac) / (BERSERK_HP_START - BERSERK_HP_FLOOR));
    return 1 + BERSERK_MAX * t;
  }
  const sacrier = {
    res: { id: 'fureur', label: 'Fureur', max: 100, color: '#d33b3b' },
    initial: 0,
    gen() { return 0; },              // la Fureur ne vient pas des sorts (encaissement)
    consumes() { return false; },
    next(val) { return val; },        // jauge non modifiée par les sorts lancés
    bonus(m) { return berserkMult(m && m.hpFrac); }, // Berserk lié aux PV manquants
    // Dégâts conditionnels « à la place » activés par un mode toggle correspondant.
    baseDmg(sp, modes) {
      if (sp.altDmg && sp.altCond && modes && modes[sp.altCond]) return sp.altDmg;
      return sp.damageMax || sp.damageMin || 0;
    },
    modes: [
      { id: 'stabilise',    label: 'Stabilisé',        desc: 'Aversion inflige ses dégâts majorés' },
      { id: 'cible_armure', label: 'Cible avec Armure', desc: 'Fracasse inflige ses dégâts majorés' },
    ],
    advice(m) {
      const out = [];
      const f = m.fureur || 0;
      if (f >= 100) out.push({ p: 'M', msg: `🩸 Fureur MAX → Berserk plein, Punition disponible` });
      else out.push({ p: 'L', msg: `🩸 Fureur ${f}/100 (monte en encaissant des dégâts)` });
      // Conseil Berserk selon les PV courants (si suivis).
      const hpFrac = m.hpFrac;
      if (hpFrac != null) {
        const mult = berserkMult(hpFrac);
        if (mult > 1) out.push({ p: hpFrac <= BERSERK_HP_FLOOR ? 'H' : 'M',
          msg: `⚔ Berserk : PV ${Math.round(hpFrac*100)} % → ×${mult.toFixed(2)} dégâts (estimation à confirmer)` });
        else out.push({ p: 'L', msg: `⚔ Berserk : descends sous 90 % PV pour gagner des dégâts (max à 20 %)` });
      } else {
        out.push({ p: 'L', msg: `⚔ Berserk : plus tu as de PV manquants, plus tu frappes fort (connecte le log pour le suivi)` });
      }
      return out;
    },
    onState(a, n, lvl, m) { if (/fureur/i.test(n)) m.fureur = Math.min(100, lvl); },
  };

  // ── ECAFLIP — Veine / hasard / Dé six ──────────────────────────────────────
  // Classe du hasard : pas de multiplicateur de dégâts lié à une jauge dans les
  // données. La Veine (0→100) donne surtout soins/résistances (informative ici).
  // Le vrai levier CHIFFRÉ est le sort « Dé six » : à chaque lancer dans le tour,
  // son coût baisse d'1 PA (cumulable, min 1 PA) → son dégât/PA grimpe fortement.
  // On le modélise via un compteur (mode `de_six` = nb de lancers déjà faits).
  const DESIX_MIN_AP = 1;
  const ecaflip = {
    res: { id: 'veine', label: 'Veine', max: 100, color: '#e6b800' },
    initial: 0,
    gen() { return 0; },           // la Veine ne vient pas des sorts élémentaires
    consumes() { return false; },
    next(val) { return val; },
    bonus() { return 1; },         // pas de bonus de dégâts continu
    // Modificateur de COÛT en PA selon les modes (Dé six : -1 PA par lancer déjà fait).
    costMod(sp, modes) {
      if (/d[ée]\s*six/i.test(sp.name || '')) {
        const n = (modes && modes.de_six) | 0;       // nb de Dé six déjà lancés
        const newAp = Math.max(DESIX_MIN_AP, (sp.apCost || 0) - n);
        return newAp - (sp.apCost || 0);             // delta (négatif)
      }
      return 0;
    },
    // Compteur exposé à l'UI (stepper) plutôt qu'un simple toggle on/off.
    counters: [{
      id: 'de_six', label: 'Dé six lancés', max: 5,
      desc: 'Chaque Dé six lancé dans le tour réduit le coût du suivant d\'1 PA (min 1 PA)',
    }],
    advice(m) {
      const out = [];
      const v = m.veine || 0;
      out.push({ p: 'L', msg: `🎲 Veine ${v}/100 (chance : soins, résistances, cartes — pas de bonus de dégâts direct)` });
      out.push({ p: 'L', msg: `🃏 Ton vrai levier de dégâts reste le Coup critique : empile le % Crit (Bataille en donne 20 % sur 2 tours)` });
      out.push({ p: 'L', msg: `🎯 Dé six : relance-le dans le tour, son coût baisse d'1 PA à chaque fois (min 1 PA) — combo signature` });
      out.push({ p: 'L', msg: `💥 Dé du chateux (1.92) : 2 PA rendus instantanément si tu achèves un ennemi avec → enchaîne sur une cible basse` });
      out.push({ p: 'L', msg: `♣️ Trèfle pose désormais l'état « Guigne » (1 usage/tour) ; un seul Trèfle/Guigne à la fois` });
      return out;
    },
    onState(a, n, lvl, m) { if (/veine/i.test(n)) m.veine = Math.min(100, lvl); },
  };

  // ── ELIOTROPE — Serein/Exalté + Portails + Don céleste ─────────────────────
  // Trois leviers de dégâts, tous chiffrés (toggles) :
  //  • Exalté (vs Serein) : certains sorts ont un dégât différent en mode Exalté.
  //  • Portail : si le sort passe par / est lancé sur un portail, dégât majoré
  //    (remplace `portalDmg`, ou s'ajoute `portalBonus`).
  //  • Don céleste : +40 % Dommages infligés au prochain sort (valeur du passif de
  //    base ; mode toggle). Variante Traquenard : remplace le +40 % de base par +60 %
  //    Dommages infligés UNIQUEMENT de dos (donc 0 hors position dos).
  const ELIO_DON_DI = 0.40;          // +40 % DI de base (Don céleste, prochain sort)
  const ELIO_TRAQUENARD_DI = 0.60;   // Traquenard : +60 % DI, seulement de dos
  const eliotrope = {
    res: null, // pas de jauge chiffrée ; les leviers sont des toggles
    // Dégât de base effectif selon les modes Exalté / Portail.
    baseDmg(sp, modes) {
      let d = sp.damageMax || sp.damageMin || 0;
      if (modes && modes.exalte && sp.exaltedDmg) d = sp.exaltedDmg;
      if (modes && modes.portail) {
        if (sp.portalDmg) d = sp.portalDmg;       // remplace
        else if (sp.portalBonus) d += sp.portalBonus; // s'ajoute
      }
      return d;
    },
    // Don céleste : +40 % Dommages infligés sur le prochain sort (toggle global).
    // Traquenard (passif) : remplace ce +40 % par +60 % DI applicable seulement de dos.
    bonus(m) {
      if (!m || !m.don_celeste) return 1;
      const traquenard = m.passives && m.passives.includes('traquenard');
      if (traquenard) return m.position === 'back' ? 1 + ELIO_TRAQUENARD_DI : 1;
      return 1 + ELIO_DON_DI;
    },
    modes: [
      { id: 'exalte',      label: 'Exalté',       desc: 'Mode Exalté : dégâts modifiés sur certains sorts (sinon mode Serein)' },
      { id: 'portail',     label: 'Via Portail',  desc: 'Le sort passe par / est lancé sur un portail : dégâts majorés' },
      { id: 'don_celeste', label: 'Don céleste',  desc: '+40 % Dommages infligés sur le prochain sort' },
    ],
    advice() {
      return [
        { p: 'L', msg: `🌀 Serein / Exalté : change de mode selon le sort (active « Exalté » pour voir ses dégâts)` },
        { p: 'L', msg: `🌀 Portails : lance tes sorts à travers/sur un portail pour majorer les dégâts` },
        { p: 'L', msg: `✨ Don céleste : +40 % Dommages infligés sur le prochain sort (active le toggle ; avec Traquenard : +60 % uniquement de dos)` },
        { p: 'L', msg: `🚪 Exode (1.92) : utilisable à travers les portails, 2 usages/tour (placement non simulé ici)` },
      ];
    },
  };

  // ── ENIRIPSA — soigneuse, dégâts conditionnels sur les PV ──────────────────
  // Surtout support (Marques, Propagateur, soins). Côté dégâts, deux conditions
  // CHIFFRÉES évaluées automatiquement selon les PV réels (suivis via le log) :
  //  • Anatomie : dégât plein si la CIBLE a ≥ 80 % PV (base `dm`), réduit `lowTgtDmg`
  //    si la cible est sous 80 % PV.
  //  • Torpeur : +`selfHpBonus` si l'ENIRIPSA a ≥ 80 % PV.
  // Quand les PV ne sont pas suivis (pas de log), on suppose le cas favorable
  // (cible pleine vie, Eniripsa plein) — l'aperçu reste optimiste et cohérent.
  const ENI_HP_THRESHOLD = 0.80;
  const eniripsa = {
    res: null, // pas de jauge de dégâts (Propagateur = support, non chiffré ici)
    baseDmg(sp, ctx) {
      let d = sp.damageMax || sp.damageMin || 0;
      // Anatomie : si la cible est connue ET sous 80 % PV → dégât réduit.
      if (sp.lowTgtDmg && ctx && ctx.tgtHpFrac != null && ctx.tgtHpFrac < ENI_HP_THRESHOLD) {
        d = sp.lowTgtDmg;
      }
      // Torpeur : +bonus si l'Eniripsa a ≥ 80 % PV (ou PV inconnus → supposé plein).
      if (sp.selfHpBonus && (ctx == null || ctx.hpFrac == null || ctx.hpFrac >= ENI_HP_THRESHOLD)) {
        d += sp.selfHpBonus;
      }
      return d;
    },
    advice(m) {
      const out = [];
      const hp = m && m.hpFrac;
      if (hp != null && hp < ENI_HP_THRESHOLD) {
        out.push({ p: 'M', msg: `💉 Eniripsa sous 80 % PV : Torpeur perd son bonus de dégâts (remonte tes PV)` });
      } else {
        out.push({ p: 'L', msg: `💉 Eniripsa ≥ 80 % PV : Torpeur tape plus fort` });
      }
      out.push({ p: 'L', msg: `🎯 Anatomie : dégâts pleins sur les cibles à ≥ 80 % PV (ouvre avec)` });
      out.push({ p: 'L', msg: `🩹 Classe support : Marques & Propagateur pour le soin/contrôle (non chiffrés ici)` });
      return out;
    },
  };

  // ── ENUTROF — Trésors / forme Phorzerker ───────────────────────────────────
  // Deux leviers. Un seul est chiffré côté DÉGÂTS :
  //  • Trésors (état accumulé, max 2-3) : consommé par certains sorts. Le seul à
  //    augmenter les dégâts est Epuration (212 → 266 si Trésors). Toggle `tresors`.
  //    (Taxe/Pelle mêlée consomment Trésors pour des effets PA/PM, pas du dégât.)
  //  • Phorzerker (forme) : change surtout les EFFETS (traverse Armure, échange de
  //    position…). Le bonus de Dommages infligés de « Bestialité » n'est pas chiffré
  //    dans les données → mode informatif (toggle `phorzerker`, sans effet calcul).
  // Dette/Fauché (1.92) : une cible « Fauchée » (état Dette consommé) subit
  // +20 % Dommages infligés de la part de l'Enutrof. Mode toggle `fauche`.
  const ENUTROF_FAUCHE_DI = 0.20;
  const enutrof = {
    res: null,
    // Dégât conditionnel activé par un toggle (Epuration : Trésors).
    baseDmg(sp, modes) {
      if (sp.altDmg && sp.altCond && modes && modes[sp.altCond]) return sp.altDmg;
      return sp.damageMax || sp.damageMin || 0;
    },
    // Fauché : +20 % Dommages infligés sur la cible endettée (toggle).
    bonus(m) { return m && m.fauche ? 1 + ENUTROF_FAUCHE_DI : 1; },
    modes: [
      { id: 'tresors',    label: 'Trésors',    desc: 'L\'Enutrof a l\'état Trésors : Epuration consomme l\'état pour des dégâts majorés' },
      { id: 'phorzerker', label: 'Phorzerker', desc: 'Forme Phorzerker : change les effets des sorts (bonus de dégâts « Bestialité » non chiffré ici)' },
      { id: 'fauche',     label: 'Cible Fauchée', desc: '+20 % Dommages infligés sur une cible Fauchée (état Dette consommé) — 1.92' },
    ],
    advice() {
      return [
        { p: 'L', msg: `💰 Trésors : garde-le pour Epuration (dégâts majorés), ou consomme-le sur Taxe/Pelle mêlée pour le contrôle` },
        { p: 'L', msg: `⛏ Phorzerker : forme offensive (traverse l'Armure, vol de vie) — bonus de dégâts non chiffré dans l'outil` },
        { p: 'L', msg: `💸 Dette/Fauché (1.92) : une cible Fauchée subit +20 % Dommages infligés (active le toggle) ; l'état Dette se retire à ton prochain tour` },
        { p: 'L', msg: `🪨 Gisements : apparaissent à 3 Portée max (1.92) ; Coup de grisou & Coulée de lave tournent autour d'eux (placement non simulé)` },
      ];
    },
  };

  // ── FÉCA — Glyphes / Boucliers / passifs offensifs ─────────────────────────
  // Classe tank/support sans jauge de dégâts. Son levier offensif passe par des
  // PASSIFS à % Dommages infligés, désormais chiffrés (cf. PASSIVE_FX dans wca.js,
  // appliqués via le système de bonus de stats des passifs actifs) :
  //   La meilleure défense est l'attaque (+10 %), Qui veut la paix… (+25 %),
  //   Protecteur du troupeau (-20 %, +300 % PV).
  // Les bonus conditionnels (Carapace d'épines selon l'Armure, Œil pour œil quand
  // l'Armure est perdue) restent en conseil, non chiffrés.
  const feca = {
    res: null,
    advice() {
      return [
        { p: 'L', msg: `🛡 Glyphes : tes sorts élémentaires posent un glyphe sur case vide (dégâts indirects de zone)` },
        { p: 'L', msg: `🔥 Boucliers Feu/Eau/Terre : posés sur les alliés, ils donnent DI / Portée / PM (passif Boucliers élémentaires)` },
        { p: 'L', msg: `⚔ Pense à activer tes passifs offensifs (+10 % à +25 % Dommages infligés) — ils sont pris en compte dans le ranking` },
      ];
    },
  };

  // ── HUPPERMAGE — Runes / Brise Quadramentale (BQ) ──────────────────────────
  // Classe des Runes élémentaires. Levier de dégâts CHIFFRÉ : la jauge de BQ
  // (Brise Quadramentale, 0→100) fait scaler Rayon crépusculaire : +`bqScale` %
  // de dégâts par % de BQ restante (0.5 → +50 % à 100 BQ). On suit la BQ comme une
  // jauge réglable. Les bonus de Runes (1.92 : Vestige/Incan'Rune +20 % DI allié,
  // Lueur de l'aube +20 % Dommages subis, Disque luminescent +10 % Dommages subis
  // DE DOS sur la cible à exactement 3 runes, 1 tour…) restent trop conditionnels
  // (suivi des runes/états non simulé) → en conseil.
  // La régen BQ de fin de tour (≥200 hors Cœur de Lumière,
  // 1.92) ne change pas l'aperçu : on part de la BQ pleine (initial:100).
  const huppermage = {
    res: { id: 'bq', label: 'BQ', max: 100, color: '#9b6dff' },
    initial: 100, // la BQ démarre pleine et se consomme ; on part au max pour l'aperçu
    gen() { return 0; },
    consumes() { return false; },
    next(val) { return val; },
    bonus() { return 1; }, // pas de bonus global ; le scaling est par sort (spellScale)
    // Multiplicateur de dégâts d'un sort selon la BQ (Rayon crépusculaire).
    spellScale(sp, val) {
      if (sp.bqScale) return 1 + sp.bqScale * (val || 0) / 100;
      return 1;
    },
    scales(sp) { return !!sp.bqScale; }, // ce sort varie avec la jauge
    advice(m) {
      const bq = m.bq != null ? m.bq : 100;
      return [
        { p: 'L', msg: `🔮 BQ ${bq}/100 : Rayon crépusculaire gagne +0,5 % de dégâts par % de BQ (×${(1 + 0.5 * bq / 100).toFixed(2)})` },
        { p: 'L', msg: `🌈 Runes (1.92) : à exactement 3 runes Disque luminescent applique +10 % Dommages subis DE DOS sur la cible (1 tour, consomme les runes) ; Vestige/Incan'Rune donne +20 % DI aux alliés` },
        { p: 'L', msg: `🌅 Lueur de l'aube (Incan'Rune) : +20 % Dommages subis dans l'élément de la dernière rune (2 tours) — combo avant ton burst` },
        { p: 'L', msg: `✨ Feu-Follet : relais pour propager tes sorts et sauvegarder des runes (effets de runes non chiffrés ici)` },
      ];
    },
    onState(a, n, lvl, m) { if (/\bBQ\b|quadramental/i.test(n)) m.bq = Math.min(100, lvl); },
  };

  // ── OSAMODAS — Forme draconique / invocations ──────────────────────────────
  // Classe d'invocateur : une grande part de ses dégâts vient de ses familiers
  // (non simulés ici). Côté Osamodas lui-même, deux leviers CHIFFRÉS :
  //  • Forme draconique (toggle) : +25 % Dommages infligés (passif Puissance
  //    draconique) ET dégât majoré sur certains sorts (`dracoDmg` : Souffle du
  //    dragon 164→244, Tornade de plumes 83→91).
  //  • Corbeau incendiaire (toggle hors ligne de vue) : 83 → 111 (`altDmg`).
  const OSA_DRACO_DI = 0.25; // +25 % Dommages infligés en forme draconique
  const osamodas = {
    res: null,
    // Dégât effectif : forme draconique (dracoDmg) ou condition « à la place » (altDmg).
    baseDmg(sp, modes) {
      if (modes && modes.draconique && sp.dracoDmg) return sp.dracoDmg;
      if (sp.altDmg && sp.altCond && modes && modes[sp.altCond]) return sp.altDmg;
      return sp.damageMax || sp.damageMin || 0;
    },
    // +25 % Dommages infligés en forme draconique (passif Puissance draconique).
    bonus(m) { return m && m.draconique ? 1 + OSA_DRACO_DI : 1; },
    modes: [
      { id: 'draconique', label: 'Forme draconique', desc: '+25 % Dommages infligés (Puissance draconique) + dégâts draconiques de certains sorts' },
      { id: 'hors_ldv',   label: 'Cible hors LdV',   desc: 'Corbeau incendiaire inflige ses dégâts majorés sur une cible hors ligne de vue' },
    ],
    advice() {
      return [
        { p: 'L', msg: `🐲 Forme draconique : +25 % Dommages infligés (avec Puissance draconique) — active-la pour voir tes dégâts boostés` },
        { p: 'L', msg: `🦅 Invocations : l'essentiel de tes dégâts passe par tes familiers (non simulés ici) — garde-en une en vie` },
        { p: 'L', msg: `⚔ Passifs offensifs (Force-Taure, Guerrier invocateur…) : pense à les activer, ils sont pris en compte` },
      ];
    },
  };

  // ── OUGINAK — PV élevés / Proie / Rage ─────────────────────────────────────
  // Thème : l'Ouginak frappe plus fort quand il a beaucoup de PV, et selon l'état
  // de la cible. Dégâts conditionnels CHIFFRÉS (« … à la place ») :
  //  • Plombage : 98 → 131 si l'Ouginak a ≥ 80 % PV (AUTO via ctx.hpFrac).
  //  • Bastonnade : 83 → 251 si la cible est Bastonné (toggle `bastonne`).
  //  • Balayage : 131 → 164 si la cible est au contact (toggle `contact`).
  // La Rage / l'Ougigarou (mode loup-garou) n'ont pas de bonus de dégâts de base
  // chiffré dans les données (les passifs ne donnent que des malus/conditions) → conseil.
  const OUGI_HP_THRESHOLD = 0.80;
  const ouginak = {
    res: null,
    baseDmg(sp, ctx) {
      if (sp.altDmg && sp.altCond) {
        // Condition auto sur les PV de l'Ouginak.
        if (sp.altCond === 'self_high_hp') {
          if (ctx == null || ctx.hpFrac == null || ctx.hpFrac >= OUGI_HP_THRESHOLD) return sp.altDmg;
        } else if (ctx && ctx[sp.altCond]) {
          return sp.altDmg; // condition via toggle (bastonne, contact)
        }
      }
      return sp.damageMax || sp.damageMin || 0;
    },
    modes: [
      { id: 'bastonne', label: 'Cible Bastonné', desc: 'Bastonnade triple ses dégâts sur une cible déjà touchée par Bastonnade (83 → 251)' },
      { id: 'contact',  label: 'Cible au contact', desc: 'Balayage inflige ses dégâts majorés si la cible est au contact (131 → 164)' },
    ],
    advice(m) {
      const out = [];
      const hp = m && m.hpFrac;
      if (hp != null && hp < OUGI_HP_THRESHOLD) out.push({ p: 'M', msg: `🐺 Sous 80 % PV : Plombage perd son bonus de dégâts (remonte tes PV)` });
      else out.push({ p: 'L', msg: `🐺 ≥ 80 % PV : Plombage frappe plus fort (98 → 131)` });
      out.push({ p: 'L', msg: `🦴 Bastonnade : retape une cible déjà Bastonné pour ×3 dégâts (active le toggle)` });
      out.push({ p: 'L', msg: `⚔ Proie / Ougigarou : marque ta Proie et passe en loup-garou pour tes combos (bonus non chiffrés ici)` });
      return out;
    },
  };

  // ── PANDAWA — Tonneau / Imbibé ─────────────────────────────────────────────
  // Mécanique centrée sur le TONNEAU (porté ou non, change quasi tous les sorts) et
  // l'Imbibé (état sur la cible, surtout consommé pour soin/résistances → non chiffré
  // côté dégâts). Levier CHIFFRÉ = Tonneau porté (toggle `tonneau`) :
  //  • dégât alternatif `tonneauDmg` (Flasque Explosive 111 → 167) ;
  //  • multiplicateur `tonneauMult` (Lucha, Blitzkriek : +10 %) ;
  //  • +10 % Dommages infligés global (passif Tonneau Agressif).
  const PANDA_TONNEAU_DI = 0.10; // +10 % DI quand le Tonneau est porté (Tonneau Agressif)
  const pandawa = {
    res: null,
    baseDmg(sp, modes) {
      let d = sp.damageMax || sp.damageMin || 0;
      if (modes && modes.tonneau) {
        if (sp.tonneauDmg) d = sp.tonneauDmg;             // dégât remplacé (Flasque)
        if (sp.tonneauMult) d = Math.round(d * (1 + sp.tonneauMult / 100)); // ×(1+N%) (Lucha…)
      }
      return d;
    },
    bonus(m) { return m && m.tonneau ? 1 + PANDA_TONNEAU_DI : 1; }, // Tonneau Agressif
    modes: [
      { id: 'tonneau', label: 'Tonneau porté', desc: 'Le Pandawa porte son Tonneau : dégâts modifiés + 10 % Dommages infligés (Tonneau Agressif)' },
    ],
    advice() {
      return [
        { p: 'L', msg: `🛢 Tonneau porté : modifie tes sorts (jets, dégâts) et +10 % Dommages infligés avec Tonneau Agressif — active le toggle` },
        { p: 'L', msg: `🥛 Imbibé : empile-le sur tes cibles, puis consomme-le (Souffle Enflammé, Vague de Lait) pour résistances/soin` },
        { p: 'L', msg: `🍺 Ivre / Gueule de Bois / Sobre : tes états d'ivresse donnent PA/PM/PW (gère ton cycle)` },
      ];
    },
  };

  // ── ROUBLARD — Bombes / Pulsar / Fourbe-Fuyard ─────────────────────────────
  // L'essentiel des dégâts du Roublard vient de ses BOMBES (explosions différées en
  // zone, combos) — non simulées ici. Côté sorts directs, un levier CHIFFRÉ : le sort
  // PULSAR se charge. Chaque charge ajoute `chargePerLvl` (91) de dégâts au déchargement.
  // On suit la charge via un compteur (`pulsar` = niveau accumulé).
  // Les modes Fourbe/Fuyard changent surtout des effets (les dégâts directs sont
  // identiques entre modes dans les données) → conseil.
  const roublard = {
    res: null,
    // Dégât plat additionnel : Pulsar chargé (+chargePerLvl par niveau de charge).
    flatBonus(sp, modes) {
      if (sp.chargePerLvl) { const n = (modes && modes.pulsar) | 0; return sp.chargePerLvl * n; }
      return 0;
    },
    counters: [{
      id: 'pulsar', label: 'Charges Pulsar', max: 6,
      desc: 'Chaque charge de Pulsar (lancé sur soi) ajoute 91 de dégâts au déchargement',
    }],
    advice() {
      return [
        { p: 'L', msg: `💣 Bombes : le cœur de tes dégâts passe par leurs explosions différées (non simulées ici) — aligne-les pour les Murs de poudre` },
        { p: 'L', msg: `🔋 Pulsar : charge-le (lancé sur toi) puis décharge — +91 dégâts par charge (règle le compteur)` },
        { p: 'L', msg: `🎭 Fourbe / Fuyard : alterne les modes (Ruse) pour les effets de tes sorts et Tir surprise` },
      ];
    },
  };

  // ── SADIDA — Poupées / Engrainé ────────────────────────────────────────────
  // Classe d'invocateur : l'essentiel des dégâts vient des POUPÉES, ARBRES et POISONS
  // (via les Arbres) — non simulés ici. Côté sorts directs, un levier CHIFFRÉ :
  // Tremblement de Terre = 60 + 30 × niveau d'Engrainé (compteur `engraine`).
  const sadida = {
    res: null,
    flatBonus(sp, modes) {
      if (sp.chargePerLvl) { const n = (modes && modes.engraine) | 0; return sp.chargePerLvl * n; }
      return 0;
    },
    counters: [{
      id: 'engraine', label: 'Engrainé', max: 10,
      desc: 'Chaque niveau d\'Engrainé ajoute 30 de dégâts à Tremblement de Terre',
    }],
    advice() {
      return [
        { p: 'L', msg: `🌳 Poupées & Arbres : le gros de tes dégâts passe par tes invocations et leurs poisons (non simulés ici) — sème tes graines` },
        { p: 'L', msg: `🌱 Engrainé : monte le niveau de tes poupées/arbres pour amplifier Tremblement de Terre (+30/niveau) — règle le compteur` },
        { p: 'L', msg: `☠ Toxines / poisons : empile-les via tes Arbres pour des dégâts indirects continus` },
      ];
    },
  };

  // ── STEAMER — Stasis (PS) / Pilonnage / Tourelles ──────────────────────────
  // Plusieurs leviers CHIFFRÉS côté sorts directs (les Tourelles font une partie des
  // dégâts mais ne sont pas simulées) :
  //  • Stasis (PS, jauge) : Choc gagne +psScale % par PS courant, plafonné à psCap %.
  //    On suit les PS comme une jauge (max 10 → +50 % à PS plein avec Choc).
  //  • Pilonnage (compteur) : +castBonus (27) par lancer déjà effectué dans le tour.
  const STEAMER_PS_MAX = 10;
  const foggernaut = {
    res: { id: 'ps', label: 'Stasis (PS)', max: STEAMER_PS_MAX, color: '#3fb6c8' },
    initial: 0,
    gen() { return 0; },
    consumes() { return false; },
    next(val) { return val; },
    bonus() { return 1; }, // pas de bonus global ; scaling par sort (Choc) ci-dessous
    // Choc : ×(1 + min(psScale·PS, psCap)/100). Autres sorts inchangés.
    spellScale(sp, val) {
      if (sp.psScale) {
        const pct = Math.min(sp.psCap || Infinity, sp.psScale * (val || 0));
        return 1 + pct / 100;
      }
      return 1;
    },
    scales(sp) { return !!sp.psScale; },
    // Pilonnage : +castBonus par lancer déjà fait ce tour (compteur `pilonnage`).
    flatBonus(sp, modes) {
      if (sp.castBonus) { const n = (modes && modes.pilonnage) | 0; return sp.castBonus * n; }
      return 0;
    },
    counters: [{
      id: 'pilonnage', label: 'Pilonnages déjà lancés', max: 6,
      desc: 'Chaque Pilonnage déjà lancé ce tour ajoute 27 de dégâts au suivant',
    }],
    advice(m) {
      const ps = m.ps != null ? m.ps : 0;
      return [
        { p: 'L', msg: `⚙ Stasis ${ps}/${STEAMER_PS_MAX} : Choc gagne +5 % de dégâts par PS (max +50 %) — accumule avant de frapper` },
        { p: 'L', msg: `🔨 Pilonnage : enchaîne-le dans le tour, +27 dégâts à chaque répétition (règle le compteur)` },
        { p: 'L', msg: `🤖 Tourelles : une partie de tes dégâts passe par elles (non simulées) — place-les près de tes cibles (Sabordage)` },
      ];
    },
    onState(a, n, lvl, m) { if (/stasis|\bPS\b/i.test(n)) m.ps = Math.min(STEAMER_PS_MAX, lvl); },
  };

  // ── XÉLOR — Temps / heure courante / tour pair-impair ──────────────────────
  // Classe de CONTRÔLE (retraits de PA, téléportations, Cadran) : peu de gros
  // multiplicateurs de dégâts directs. Son seul levier de dégâts chiffré est le
  // passif « Taque, Tique » : +20 % Dommages infligés les tours PAIRS, −20 % les
  // tours IMPAIRS. Modélisé par un toggle `tour_pair` (à activer si le passif est
  // équipé). Le Cadran / l'heure courante donnent surtout du placement → conseil.
  const XELOR_PARITY_DI = 0.20;
  const xelor = {
    res: null,
    // Taque, Tique : ±20 % DI selon la parité du tour (toggle `tour_pair`).
    bonus(m) {
      if (m && m.taque_tique) return m.tour_pair ? 1 + XELOR_PARITY_DI : 1 - XELOR_PARITY_DI;
      return 1;
    },
    modes: [
      { id: 'taque_tique', label: 'Passif Taque/Tique', desc: 'Le passif « Taque, Tique » est équipé : ±20 % Dommages infligés selon la parité du tour' },
      { id: 'tour_pair',   label: 'Tour pair',          desc: 'Tour en cours pair (avec Taque/Tique : +20 % DI ; sinon les tours impairs donnent −20 %)' },
    ],
    advice(m) {
      const out = [];
      if (m && m.taque_tique) {
        out.push(m.tour_pair
          ? { p: 'M', msg: `⏳ Tour PAIR + Taque/Tique : +20 % Dommages infligés — c'est ton tour de burst` }
          : { p: 'M', msg: `⏳ Tour IMPAIR + Taque/Tique : −20 % Dommages infligés — temporise, garde tes ressources` });
      } else {
        out.push({ p: 'L', msg: `⏳ Si tu joues « Taque, Tique » : active-le pour voir l'effet ±20 % DI selon la parité du tour` });
      }
      out.push({ p: 'L', msg: `🪡 Aiguille (1.92) : lançable dès 1 PA pour les mêmes dégâts (111) → excellent reliquat de PA ; rembourse les PA utilisés si elle achève une cible` });
      out.push({ p: 'L', msg: `🕐 Cadran & heure courante : sers-t'en pour téléporter, retirer des PA et positionner (contrôle)` });
      return out;
    },
  };

  // ── ZOBAL — Masques / collisions ───────────────────────────────────────────
  // Classe de masques (Psychopathe/Classe/Bouffon) et de collisions. Son levier de
  // dégâts passe par des PASSIFS à % Dommages infligés, chiffrés (cf. PASSIVE_FX :
  // Brute +25 %, Érosion −25 %). Le passif « Au contact » (+15 % DI au corps-à-corps)
  // est conditionnel → exposé en toggle `au_contact`.
  const ZOBAL_CONTACT_DI = 0.15;
  const masqueraider = {
    res: null,
    bonus(m) { return m && m.au_contact ? 1 + ZOBAL_CONTACT_DI : 1; }, // passif Au contact
    modes: [
      { id: 'au_contact', label: 'Au contact (fin de tour)', desc: 'Passif « Au contact » : +15 % Dommages infligés si un combattant est à ton contact en fin de tour' },
    ],
    advice() {
      return [
        { p: 'L', msg: `🎭 Masques (1.92) : chaque masque donne une charge en début de tour → ton prochain sort élémentaire à 1 PW est gratuit, et te rend 1 PW selon la cible (ennemi/allié/collision)` },
        { p: 'L', msg: `💥 Collisions (1.92, effet inné) : ne retirent plus de PA ; elles infligent des dégâts par PA du sort à jusqu'à 2 ennemis. Entrechoquement force la collision sur cible stabilisée` },
        { p: 'L', msg: `👻 Esprit masqué est désormais inné (3e barre) et profite de tes gains de PW` },
        { p: 'L', msg: `⚔ Passifs offensifs (Brute +25 %, Au contact +15 %…) : pense à les activer, ils sont pris en compte` },
      ];
    },
  };

  global.WCA_MECHANICS = { sram, iop, cra, sacrier, ecaflip, eliotrope, eniripsa, enutrof, feca, huppermage, osamodas, ouginak, pandawa, rogue: roublard, sadida, foggernaut, xelor, masqueraider };

})(typeof window !== 'undefined' ? window : globalThis);
