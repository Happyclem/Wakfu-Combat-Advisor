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

  // ── SRAM — Point Faible ────────────────────────────────────────────────────
  // Le Point Faible se génère (pf) et se consomme (finisseurs) ; les finisseurs
  // et Arnaque voient leurs dégâts ×(1 + pf/100). Calibré en jeu (voir wca.js).
  const sram = {
    res: { id: 'pf', label: 'Point Faible', max: 100, color: '#e05c5c' },
    initial: 0, // ⚠ supposé 0 en début de combat (à confirmer in-game)
    gen(sp) { return sp.pfGen || 0; },
    consumes(sp) {
      return !!sp.isFinisher || /consomme.*point\s*faible/i.test(sp.desc || '');
    },
    scales(sp) {
      return this.consumes(sp) || /arnaque/i.test(sp.name || '');
    },
    next(val, sp, ctx) {
      if (this.consumes(sp)) return 0;
      // Assassin : le coup qui tue ne génère pas de Point Faible.
      if (ctx && ctx.lethal && ctx.assassin) return val;
      const g = ctx && ctx.suppressGen ? 0 : this.gen(sp);
      return Math.min(100, val + g);
    },
    bonus(m) { return 1 + (m.pf || 0) * 0.002; }, // ×1 → ×1.20 (PF 0→100)
    // Les multiplicateurs par sort restent dans wca.js (spellDmgMult) qui connaît
    // Assaut Brutal, Attaque mortelle <50 % PV, Châtiment/Effroi, l'Hémorragie…
    advice(m) {
      const pf = m.pf || 0, mult = (1 + pf * 0.002).toFixed(2);
      if (pf >= 100) return [{ p: 'H', msg: `🔴 Point Faible MAX → Finisseur ! (×1.20)` }];
      if (pf >= 70)  return [{ p: 'M', msg: `🟡 Point Faible ${pf}/100 (×${mult})` }];
      if (pf > 0)    return [{ p: 'L', msg: `⚪ Point Faible ${pf}/100 (×${mult})` }];
      return [];
    },
    onState(a, n, lvl, m) { if (/point\s*faible/i.test(n)) m.pf = Math.min(100, lvl); },
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
      out.push({ p: 'L', msg: `🃏 Mise sur le Coup critique (active le mode ★) : c'est ton vrai levier de dégâts` });
      out.push({ p: 'L', msg: `🎯 Dé six : relance-le dans le tour, son coût baisse d'1 PA à chaque fois (combo signature)` });
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
  //    base ; mode toggle). ⚠ Le +40 % est documenté ; les variantes de passif
  //    (Traquenard +60 % de dos, Quiétude PA à la place…) ne sont pas modélisées.
  const ELIO_DON_DI = 0.40; // +40 % Dommages infligés (Don céleste, prochain sort)
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
    bonus(m) { return m && m.don_celeste ? 1 + ELIO_DON_DI : 1; },
    modes: [
      { id: 'exalte',      label: 'Exalté',       desc: 'Mode Exalté : dégâts modifiés sur certains sorts (sinon mode Serein)' },
      { id: 'portail',     label: 'Via Portail',  desc: 'Le sort passe par / est lancé sur un portail : dégâts majorés' },
      { id: 'don_celeste', label: 'Don céleste',  desc: '+40 % Dommages infligés sur le prochain sort' },
    ],
    advice() {
      return [
        { p: 'L', msg: `🌀 Serein / Exalté : change de mode selon le sort (active « Exalté » pour voir ses dégâts)` },
        { p: 'L', msg: `🌀 Portails : lance tes sorts à travers/sur un portail pour majorer les dégâts` },
        { p: 'L', msg: `✨ Don céleste : +40 % Dommages infligés sur le prochain sort (active le toggle)` },
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
  const enutrof = {
    res: null,
    // Dégât conditionnel activé par un toggle (Epuration : Trésors).
    baseDmg(sp, modes) {
      if (sp.altDmg && sp.altCond && modes && modes[sp.altCond]) return sp.altDmg;
      return sp.damageMax || sp.damageMin || 0;
    },
    modes: [
      { id: 'tresors',    label: 'Trésors',    desc: 'L\'Enutrof a l\'état Trésors : Epuration consomme l\'état pour des dégâts majorés' },
      { id: 'phorzerker', label: 'Phorzerker', desc: 'Forme Phorzerker : change les effets des sorts (bonus de dégâts « Bestialité » non chiffré ici)' },
    ],
    advice() {
      return [
        { p: 'L', msg: `💰 Trésors : garde-le pour Epuration (dégâts majorés), ou consomme-le sur Taxe/Pelle mêlée pour le contrôle` },
        { p: 'L', msg: `⛏ Phorzerker : forme offensive (traverse l'Armure, vol de vie) — bonus de dégâts non chiffré dans l'outil` },
        { p: 'L', msg: `🪨 Gisements : Coup de grisou & Coulée de lave tournent autour de tes Gisements posés` },
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
  // jauge réglable. Les bonus de Runes (Disque luminescent +10 % de dos à 3 runes,
  // Universalité +15 % DI en fin de tour…) sont trop conditionnels → en conseil.
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
        { p: 'L', msg: `🌈 Runes : combine les 4 éléments ; à 3 runes Disque luminescent ajoute +10 % de dos, à 4 runes ta BQ se régénère plus vite` },
        { p: 'L', msg: `✨ Feu-Follet : relais pour propager tes sorts et sauvegarder des runes` },
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

  global.WCA_MECHANICS = { sram, iop, cra, sacrier, ecaflip, eliotrope, eniripsa, enutrof, feca, huppermage, osamodas, ouginak, pandawa, rogue: roublard };

})(typeof window !== 'undefined' ? window : globalThis);
