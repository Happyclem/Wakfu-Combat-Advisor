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

  global.WCA_MECHANICS = { sram, iop };

})(typeof window !== 'undefined' ? window : globalThis);
