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

  global.WCA_MECHANICS = { sram, iop, cra, sacrier };

})(typeof window !== 'undefined' ? window : globalThis);
