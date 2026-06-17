'use strict';
// ── DATA ─────────────────────────────────────────────────────────
let MONS=[], SPD={}, GPD=[], CSP=[];
function loadData(){
  MONS = window.WCA_MONSTERS || [];
  SPD  = window.WCA_SPELLS || {};
  GPD  = window.WCA_GENERAL_PASSIVES || [];
  CSP  = window.WCA_COMMON_SPELLS || [];
}
// Spell helpers - data uses short keys: n,el,ap,mp,wp,dm,dc,pf,fin,gen,tp,tpCost,lvl,rng,type,los,desc
function spellFull(s){ return {
  name:s.n, element:s.el||'Neutre', apCost:s.ap||0, mpCost:s.mp||0, wpCost:s.wp||0,
  damageMin:s.dm||0, damageMax:s.dm||0, damageCrit:s.dc||0,
  pfGen:s.pf||0, isFinisher:s.fin||false, resGen:s.gen||0, desc:s.desc||'',
  tp:s.tp||0, tpCost:s.tpCost||0, // Crâ : dégâts/coût Tir précis
  altDmg:s.altDmg||0, altCond:s.altCond||'', // Sacrieur : dégât conditionnel + sa condition
  exaltedDmg:s.exaltedDmg||0, portalDmg:s.portalDmg||0, portalBonus:s.portalBonus||0, // Eliotrope
  lowTgtDmg:s.lowTgtDmg||0, selfHpBonus:s.selfHpBonus||0, // Eniripsa : dégâts conditionnels PV
  bqScale:s.bqScale||0, // Huppermage : scaling sur la jauge de BQ
  dracoDmg:s.dracoDmg||0, // Osamodas : dégât en Forme draconique
  levelUnlock:s.lvl||0, isCommon:!!s.common,
  range:s.rng||'', spellType:s.type||'', los:s.los!==false,
  spellLevel: S.build?.level||200,
}; }
function getClassSpells(){
  const cls = S.build?.class;
  if(!cls || !SPD[cls]) return [];
  const common = CSP.map(s=>spellFull({...s, common:true}));
  return [...SPD[cls].spells.map(spellFull), ...common];
}

// ── STATE ────────────────────────────────────────────────────────
const S = {
  build:null, targets:[], focusIdx:0, calcMode:'dmg', position:'normal', critMode:false,
  remainingAP:null, playerName:null, detectedName:null,
  overrides:{}, bonuses:{guilde:true, monture:false},
  combat:{ mechanics:{} },
  situationalBuffs:{}, // sorts actifs ponctuels : assassinat, surineur
  pfConsumedThisTurn:false, // Châtiment/Effroi bonus
  previewMaxPF:false, // aperçu dégâts à PF=100
};
function save(){ try{localStorage.setItem('wca',JSON.stringify(S));}catch(e){} }
function load(){
  try{
    const d=JSON.parse(localStorage.getItem('wca')||'{}');
    const legacyMon=d.monster; delete d.monster; // ne jamais réaffecter S.monster (devenu un getter)
    Object.assign(S,d);
    if(!S.combat)    S.combat={mechanics:{}};
    if(!S.overrides) S.overrides={};
    if(!S.bonuses)   S.bonuses={guilde:true,monture:false};
    if(!Array.isArray(S.targets)) S.targets=[];
    if(!S.calcMode) S.calcMode='dmg';
    if(!S.situationalBuffs) S.situationalBuffs={};
    if(S.pfConsumedThisTurn===undefined) S.pfConsumedThisTurn=false;
    if(S.previewMaxPF===undefined) S.previewMaxPF=false;
    if(S.zoom===undefined) S.zoom=1;
    const __p=S.combat?.mechanics?.['__p']; if(__p){ __p.hp=null; __p.gAP=0; __p.gMP=0; __p.gWP=0; }
    // Migration : ancien état mono-cible (monster) → S.targets[]
    if(legacyMon){
      const m=legacyMon;
      if(m.hp&&m._maxHp===undefined){m._maxHp=m.hp;m._currentHp=m.hp;}
      if(!S.targets.length) S.targets=[{...m,uid:Date.now()}];
    }
    S.targets.forEach((t,i)=>{ if(t.hp&&t._maxHp===undefined){t._maxHp=t.hp;t._currentHp=t.hp;} if(!t.uid)t.uid=Date.now()+i; if(t._hemo===undefined)t._hemo=0; });
    S.focusIdx=Math.min(S.focusIdx||0,Math.max(0,S.targets.length-1));
  }catch(e){}
}

// ── TARGETS ──────────────────────────────────────────────────────
const MAX_TARGETS=8;
function isDead(t){ if(!t) return true; if(t.dead) return true; const mx=t._maxHp||t.hp||0; return mx>0&&(t._currentHp??mx)<=0; }
function focusTgt(){ return S.targets[S.focusIdx]||null; }
function aliveTargets(){ return S.targets.filter(t=>!isDead(t)); }
function ensureFocusAlive(){
  const f=focusTgt();
  if(f&&!isDead(f)) return;
  const i=S.targets.findIndex(t=>!isDead(t));
  if(i>=0) S.focusIdx=i;
}
function curHP(t){ const mx=t._maxHp||t.hp||0; return mx>0?(t._currentHp??mx):0; }

// S.monster est conservé comme alias en lecture seule de la cible visée (focus),
// pour que tout le code de calcul de dégâts existant continue de fonctionner.
Object.defineProperty(S,'monster',{ get:focusTgt, configurable:true });

// Normalise une cible : résistances canoniques rf/re/rt/ra (lues par elRes).
function normTarget(m){
  const rf=m.rf??m.resFeu??0, re=m.re??m.resEau??0, rt=m.rt??m.resTerre??0, ra=m.ra??m.resAir??0;
  const hp=m.hp||0;
  return { uid:m.uid||(Date.now()+Math.floor(Math.random()*1000)),
    id:m.id||0, name:m.name||m.n||'Cible', level:m.level||m.lv||0,
    hp, _maxHp:hp, _currentHp:hp, dead:false, _hemo:0,
    rf,re,rt,ra };
}
function addTarget(m){
  const t=normTarget(m);
  // dédoublonnage : même nom + même niveau → on ne ré-ajoute pas, on (re)vise
  const dup=S.targets.findIndex(x=>x.name===t.name && (x.level||0)===(t.level||0));
  if(dup>=0){ S.focusIdx=dup; }
  else {
    if(S.targets.length>=MAX_TARGETS) return; // limite atteinte (silencieux)
    S.targets.push(t); S.focusIdx=S.targets.length-1;
  }
  save(); renderMonPanel(); renderHPBars(); renderAdvisor(); setTimeout(refreshCSQTarget,0);
}
function removeTarget(uid){
  uid=Number(uid);
  const i=S.targets.findIndex(t=>t.uid===uid); if(i<0) return;
  S.targets.splice(i,1);
  S.focusIdx=Math.min(S.focusIdx,Math.max(0,S.targets.length-1));
  ensureFocusAlive();
  save(); renderMonPanel(); renderHPBars(); renderAdvisor(); setTimeout(initCSQ,0);
}
function clearTargets(){ S.targets=[]; S.focusIdx=0; save(); renderMonPanel(); renderHPBars(); renderAdvisor(); }
function focusTarget(uid){ uid=Number(uid); const i=S.targets.findIndex(t=>t.uid===uid); if(i<0)return; S.focusIdx=i; save(); renderMonPanel(); renderHPBars(); renderAdvisor(); setTimeout(refreshCSQTarget,0); }
function moveTarget(uid,dir){
  uid=Number(uid);
  const i=S.targets.findIndex(t=>t.uid===uid); if(i<0) return;
  const j=i+dir; if(j<0||j>=S.targets.length) return;
  const f=S.targets[S.focusIdx];
  [S.targets[i],S.targets[j]]=[S.targets[j],S.targets[i]];
  S.focusIdx=S.targets.indexOf(f);
  save(); renderMonPanel(); renderAdvisor();
}
function findTargetByName(name){
  const n=(name||'').toLowerCase();
  return S.targets.find(t=>(t.name||'').toLowerCase()===n);
}

// ── BONUS / STATS ────────────────────────────────────────────────
// ── SORTS SITUATIONNELS (effets toggle, Sram uniquement) ─────────
// Actifs via S.situationalBuffs[id]=true. Pas de dégâts propres.
const SITUATIONAL = {
  assassinat: { label:'Assassinat', cls:'sram', desc:'-100 Rés. Élémentaire sur la cible', resElemDebuff:-100, spell:'Assassinat' },
  surineur:   { label:'Surineur',   cls:'sram', desc:'+20 % dmg dos et CC', sb:{ dmgDos:20, dmgCC:20 }, spell:'Surineur' },
  pf_consumed:{ label:'PF consommé ce tour', cls:'sram', desc:'Châtiment/Effroi +25 % dmg' }, // always visible when sram
};
function sitActive(id){ return id==='pf_consumed'?S.pfConsumedThisTurn:!!S.situationalBuffs?.[id]; }
function toggleSit(id){
  if(id==='pf_consumed'){ S.pfConsumedThisTurn=!S.pfConsumedThisTurn; }
  else { if(!S.situationalBuffs) S.situationalBuffs={}; S.situationalBuffs[id]=!S.situationalBuffs[id]; }
  save(); renderAdvisor(); renderSpellsTab();
}
// Incrémente/décrémente un compteur de mécanique (Ecaflip : Dé six lancés).
function bumpCounter(id,delta){
  const def=mechCounters().find(c=>c.id===id); if(!def) return;
  if(!S.situationalBuffs) S.situationalBuffs={};
  const v=Math.max(0,Math.min(def.max||99,(counterVal(id))+delta));
  S.situationalBuffs[id]=v;
  save(); renderAdvisor(); renderSpellsTab();
}

const BDEFS = {
  guilde:  {hpPct:10, degatsInfliges:2, soinsRealises:2, tacle:5, esquive:5},
  monture: {maitriseElem:40},
};
function getEffStats(){
  const base = {...(S.build?.stats||{})};
  Object.entries(S.bonuses).forEach(([k,on])=>{
    if(!on) return;
    Object.entries(BDEFS[k]||{}).forEach(([sk,v])=>{ base[sk]=(base[sk]||0)+v; });
  });
  // passive stat bonuses (sb = fixe, sbl = × niveau du personnage)
  const _lvl = S.build?.level||200;
  getActivePassives().forEach(ap=>{
    const def = getAllPassives().find(p=>p.id===ap.id);
    Object.entries(def?.effects?.sb||{}).forEach(([k,v])=>{ base[k]=(base[k]||0)+v; });
    Object.entries(def?.effects?.sbl||{}).forEach(([k,v])=>{ base[k]=(base[k]||0)+Math.round(v*_lvl); });
  });
  // sorts situationnels actifs (Surineur…)
  Object.entries(S.situationalBuffs||{}).forEach(([id,on])=>{
    if(!on) return;
    Object.entries(SITUATIONAL[id]?.sb||{}).forEach(([k,v])=>{ base[k]=(base[k]||0)+v; });
  });
  Object.entries(S.overrides).forEach(([k,v])=>{ if(v!=='') base[k]=Number(v); });
  // % PV max (guilde, Rock…) appliqué en dernier
  if(base.hpPct && base.hp) base.hp=Math.round(base.hp*(1+base.hpPct/100));
  return base;
}

// ── PASSIVES ─────────────────────────────────────────────────────
// All passive data is sourced from the embedded JSON: SPD[class].passives
// for class passives, GPD (d-gp) for the general passives. No hard-coded lists.
// Mechanical behaviours absent from the scraped JSON, layered by passive id.
// `sb` = bonus de stats appliqué quand le passif est actif (cf. getEffStats).
const PASSIVE_FX = {
  assassin: { ok:{ap:1,mp:1,wp:1,hp:20} }, // on kill: +1PA 1PM 1PW +20% PV (no PF gain)
  // Féca — passifs à % Dommages infligés PERMANENT (les conditionnels comme
  // Carapace d'épines / Œil pour œil restent informatifs, non chiffrés ici).
  la_meilleure_d_fense_est_l_attaque: { sb:{ degatsInfliges:10 } },     // +10 % DI
  qui_veut_la_paix_pr_pare_la_guerre: { sb:{ degatsInfliges:25 } },     // +25 % DI (dès le début de combat)
  protecteur_du_troupeau:             { sb:{ degatsInfliges:-20, hpPct:300 } }, // -20 % DI, +300 % PV
  // Osamodas — passifs à % Dommages infligés PERMANENT (sacrifient les dégâts des
  // invocations, non simulées, pour booster l'Osamodas lui-même).
  guerrier_invocateur:                { sb:{ degatsInfliges:20 } },     // +20 % DI (invos -20 %)
  synergie_animale:                   { sb:{ degatsInfliges:-20 } },    // -20 % DI perso (invos +20 %)
};
function mkPassive(p, isGeneral){
  const id=(p.n||'').toLowerCase().replace(/[^a-z0-9]/g,'_');
  return {
    id, name: p.n||'', desc: p.desc||'', apCost: p.ap||0,
    levelUnlock: p.lvl||0,
    isGeneral: !!isGeneral,
    effects: Object.assign({ sb: p.sb||{}, sbl: p.sbl||{} }, PASSIVE_FX[id]||{}),
  };
}
function getClassPassives(){
  const cls = S.build?.class;
  if(!cls || !SPD[cls]) return [];
  return (SPD[cls].passives||[]).map(p=>mkPassive(p,false));
}
function getGeneralPassives(){ return (GPD||[]).map(p=>mkPassive(p,true)); }
function getAllPassives(){ return [...getClassPassives(), ...getGeneralPassives()]; }
function getActivePassives(){ return S.build?.activePassives||[]; }
function togglePassive(id){
  if(!S.build) return;
  if(!S.build.activePassives) S.build.activePassives=[];
  const i = S.build.activePassives.findIndex(p=>p.id===id);
  if(i>=0) S.build.activePassives.splice(i,1);
  else { if(S.build.activePassives.length>=6){ toast('⚠ Maximum 6 passifs actifs'); return; } S.build.activePassives.push({id}); }
  save(); renderPassivesTab(); renderPerso(); renderAdvisor();
}
function getOnKillRes(){
  const r={ap:0,mp:0,wp:0};
  getActivePassives().forEach(ap=>{
    const def=getAllPassives().find(p=>p.id===ap.id);
    const ok=def?.effects?.ok;
    if(ok){r.ap+=ok.ap||0;r.mp+=ok.mp||0;r.wp+=ok.wp||0;}
  });
  // Attaque létale dans le deck → +2 PA +2 PM sur kill
  if(getDeck().some(s=>(s.name||'').toLowerCase().includes('attaque l')&&(s.name||'').toLowerCase().includes('tale'))){
    r.ap+=2; r.mp+=2;
  }
  return r;
}

// ── CLASS MECHANICS ──────────────────────────────────────────────
// Les mécaniques détaillées vivent dans mechanics.js (window.WCA_MECHANICS).
// Chaque classe à ressource y déclare jauge, génération, bonus de dégâts, conseils.
const MECHS = (typeof window!=='undefined' && window.WCA_MECHANICS) || {};
// Rappels de mécanique par classe (informationnels, sans effet sur le calcul).
// Le multiplicateur de dégâts réel (Concentration, Précision…) demande une
// calibration en jeu : seul le Point Faible du Sram est modélisé (voir MECHS).
const CLASS_NOTES = {
  cra:        '🎯 Précision / Affûtage : monte la jauge avant tes gros sorts (Tir précis).',
  iop:        '🔥 Concentration : tape pour la monter ; à 100 elle régénère du PW et booste les dégâts.',
  feca:       '🛡 Glyphes & boucliers : pose-les sur cases vides, ils déclenchent tes effets.',
  ecaflip:    '🎲 Sorts à hasard : Pile/Face et Trèfle modulent les dégâts et le soin.',
  eliotrope:  '🌀 Portails : aligne-les pour la portée et les dégâts traversants.',
  huppermage: '🔮 Runes élémentaires : combine les éléments pour déclencher les Stases.',
  sacrier:    '🩸 Châtiments & Fureur : encaisser augmente tes dégâts.',
  sadida:     '🌿 Poupées & graines : prépare le terrain avant de frapper.',
  osamodas:   '🐉 Invocations & Glyphes : gère ton gardien et tes familiers.',
  pandawa:    '🍶 Souffle & porté : déplace tes ennemis pour optimiser les combos.',
  rogue:      '💣 Bombes : pose-les et relie-les pour des explosions en chaîne.',
  xelor:      '⏳ Stase / PW : manipule le temps pour regagner des PA.',
  enutrof:    '💰 Pelle & or : récolte avant de convertir en dégâts.',
  ouginak:    '🐺 Proie & Rage : marque ta cible pour amplifier tes dégâts.',
  eniripsa:   '💖 Mots de soin & dégâts : équilibre support et offensive.',
  masqueraider:'🎭 Masques : change de masque selon la situation (psycho/classe/bouffon).',
  foggernaut: '⚙ Stasis & tourelles : alimente tes machines pour les dégâts.',
  forgelance: '🔱 Lance : gère ta portée et tes charges.',
};
// Rappel de classe : seulement pour les classes SANS mécanique modélisée
// (celles avec mécanique fournissent déjà des conseils chiffrés via mech.advice).
function getClassNote(){ if(getMech()) return []; const n=CLASS_NOTES[S.build?.class]; return n?[{p:'L',msg:n}]:[]; }
function getMech(){ return MECHS[S.build?.class]||null; }
function getPlayerMech(){ return S.combat.mechanics['__p']||{}; }
// ── ACCÈS GÉNÉRIQUE À LA RESSOURCE DE CLASSE ──────────────────────
// resId() = clé de jauge de la classe active ('pf' Sram, 'conc' Iop…), null sinon.
function resId(){ return getMech()?.res?.id||null; }
// Valeur courante de la jauge (lue depuis l'état joueur ; défaut = `initial` de la
// mécanique si non encore suivie, ex. BQ de l'Huppermage qui démarre pleine).
function resVal(m){
  const mech=getMech(), id=mech?.res?.id; if(!id) return 0;
  const v=(m||getPlayerMech())[id];
  return v!=null?v:(mech.initial||0);
}
// Génération de ressource d'un sort selon la mécanique active.
function resGenOf(sp){ const mech=getMech(); return mech?.gen?mech.gen(sp):(sp.resGen||0); }
// Le sort consomme/vide la jauge ? (finisseur Sram). Faux si la classe n'en a pas.
function resConsumes(sp){ const mech=getMech(); return mech?.consumes?!!mech.consumes(sp):false; }
// Nouvelle valeur de jauge après lancer de `sp` depuis `val`.
function resNext(val,sp,ctx){ const mech=getMech(); return mech?.next?mech.next(val,sp,ctx||{}):val; }
// PF utilisé pour l'AFFICHAGE des dégâts : 100 si aperçu actif, sinon valeur réelle.
function currentPF(){ return S.previewMaxPF?(getMech()?.res?.max||100):resVal(); }
// Un sort dont les dégâts varient avec la jauge (Sram : finisseurs + Arnaque).
function isPFScaling(sp){ const mech=getMech(); return mech?.scales?!!mech.scales(sp):false; }
// Fraction de PV courants du joueur (1 = pleine vie). Null si non suivi (pas de log).
function playerHpFrac(){
  const mx=playerMaxHp(), hp=getPlayerMech().hp;
  if(!mx||hp==null) return null;
  return Math.max(0,Math.min(1,hp/mx));
}
// Multiplicateur global de dégâts pour une valeur de jauge donnée (clé selon la classe).
// Le contexte transmet aussi la fraction de PV du joueur (Sacrieur : bonus Berserk)
// et les modes/compteurs actifs (Eliotrope : Don céleste +40 % DI).
function mechBonus(val){
  const mech=getMech(); if(!mech?.bonus) return 1;
  const id=resId()||'pf';
  return mech.bonus({[id]:val, hpFrac:playerHpFrac(), ...modeAndCounterMap()});
}
// Multiplicateur de dégâts d'UN sort selon la valeur de jauge (Huppermage : Rayon
// crépusculaire ×(1+0.5%·BQ)). 1 si la mécanique n'a pas de scaling par sort.
function mechSpellScale(sp,val){ const mech=getMech(); return mech?.spellScale?mech.spellScale(sp,val):1; }
// La jauge influence-t-elle les dégâts via sa VALEUR ? (→ à suivre dans le knapsack DP)
// Faux pour le Crâ (levier = toggle Tir précis) et le Sacrieur (levier = PV manquants,
// pas la valeur de Fureur). On teste le bonus à PLEINE vie pour isoler l'effet jauge.
function tracksRes(){
  const mech=getMech(); if(!mech?.res) return false;
  const mx=mech.res.max, spells=getSpells(), id=resId()||'pf';
  const bonusFromGauge = mech.bonus ? mech.bonus({[id]:mx, hpFrac:1}) : 1;
  return bonusFromGauge!==1 || spells.some(s=>isPFScaling(s)||mechFlatBonus(s,mx)>0);
}
// Faut-il AFFICHER la jauge de ressource ? (plus large : inclut les classes à modes
// dont la jauge est informative/consommée, comme la Précision du Crâ)
function showsRes(){ const mech=getMech(); return !!mech?.res && (tracksRes() || mechModes().length>0); }
// Modes toggle actifs de la mécanique de classe (ex. Crâ : Tir précis).
function mechModes(){ return getMech()?.modes||[]; }
function modesActive(){ return mechModes().filter(md=>!!S.situationalBuffs?.[md.id]); }
function isModeOn(id){ return !!S.situationalBuffs?.[id]; }
// Objet { id:true } des modes actifs, passé aux hooks de la mécanique.
function activeModeMap(){ const o={}; modesActive().forEach(md=>o[md.id]=true); return o; }
// Fraction de PV courants d'une cible (1 = pleine vie). Null si inconnue.
function targetHpFrac(t){ if(!t) return null; const mx=t._maxHp||t.hp||0; if(!mx) return null; return Math.max(0,Math.min(1,(t._currentHp??mx)/mx)); }
// Contexte transmis aux hooks de dégât : modes/compteurs actifs + conditions de PV
// auto-évaluées (Eniripsa : Anatomie selon PV cible, Torpeur selon PV de l'Eniripsa).
function dmgContext(target){
  const o=modeAndCounterMap();
  o.hpFrac=playerHpFrac();
  o.tgtHpFrac=targetHpFrac(target!==undefined?target:S.monster);
  return o;
}
// Valeur de dégât à mettre à l'échelle pour `sp`, selon la mécanique (Crâ : Tir précis,
// Eliotrope : Exalté/Portail, Eniripsa : conditions de PV).
function mechBaseDmg(sp,target){
  const mech=getMech();
  if(mech?.baseDmg) return mech.baseDmg(sp,dmgContext(target));
  return sp.damageMax||sp.damageMin||0;
}
// Compteurs de mécanique (ex. Ecaflip : Dé six lancés). Valeur entière dans situationalBuffs.
function mechCounters(){ return getMech()?.counters||[]; }
function counterVal(id){ return (S.situationalBuffs?.[id]|0)||0; }
// Map { id:valeur } des compteurs, fusionnée aux modes pour les hooks de mécanique.
function modeAndCounterMap(){
  const o=activeModeMap();
  mechCounters().forEach(c=>{ o[c.id]=counterVal(c.id); });
  return o;
}
// Coût en PA EFFECTIF de `sp` (mécanique : Ecaflip Dé six réduit le coût).
function effApCost(sp){
  const mech=getMech(); let ap=sp.apCost||0;
  if(mech?.costMod) ap+=mech.costMod(sp,modeAndCounterMap());
  return Math.max(0,ap);
}
// Bonus de dégâts plat spécifique au sort selon la jauge (ex. Égaré du Iop à 100).
// Renvoie des dégâts ADDITIONNELS (mis à l'échelle du niveau du sort), 0 sinon.
function mechFlatBonus(sp,val){
  const mech=getMech();
  if(mech?.egareBonus && val>=(mech.res?.max||100)){
    const b=mech.egareBonus(sp);
    if(b>0) return scale(b,b,sp.spellLevel||S.build?.level||200);
  }
  return 0;
}
function pmObj(){ if(!S.combat.mechanics['__p']) S.combat.mechanics['__p']={}; return S.combat.mechanics['__p']; }
function playerMaxHp(){ return getEffStats().hp||0; }

// ── DAMAGE CALC ──────────────────────────────────────────────────
function calcDmg({base,mastery,di,pos,resBrut,isCrit,cb=1}){
  if(!base) return 0;
  // %résis = 1−0,8^(R/100), par paliers de 1 % (arrondi inférieur). Pas de cap 90 % :
  // les monstres ne sont pas soumis au plafond de résistance des joueurs.
  const rp = Math.floor((1-Math.pow(.8,(resBrut||0)/100))*100)/100;
  const st=getEffStats();
  const bonusDos=(st.dmgDos||0)/100, bonusCC=(st.dmgCC||0)/100;
  const pm = pos==='back'?(1.25+bonusDos):pos==='side'?1.10:1;
  const cm = isCrit?(1.25+bonusCC):1;
  // Sur un critique, la Maîtrise Critique s'ajoute au pool de maîtrise (confirmé en jeu).
  const mTot = mastery + (isCrit?(st.critMastery||0):0);
  // %DI réguliers : plancher −50 % (les DI conditionnels, non modélisés, s'ajouteraient après).
  const diEff = Math.max(-50, di||0);
  return Math.round(base*(1+mTot/100)*(1+diEff/100)*pm*cm*(1-rp)*cb);
}
function scale(dMin,dMax,lvl){
  const l=Math.max(1,Math.min(245,lvl||200));
  // dm = valeur encyclopédie ≈ infobulle niv.245. La base de calcul réelle vaut
  // dm × g(l), facteur calibré en jeu (mannequin 0 %, Sram lvl20 & lvl125, écart ~1-2 %).
  // g(1)≈0.11, g(125)=0.76, g(245)≈1.39. L'ancien dm×l/245 sous-estimait ~30-48 %.
  const dm=(dMax||dMin||0);
  const g=0.11 + 1.28*(l-1)/244;
  return Math.round(dm*g);
}
function assassinatDebuff(){ return sitActive('assassinat')?-100:0; }
function elRes(el){
  if(!S.monster) return 0;
  const base=el==='Feu'?S.monster.rf||0:el==='Eau'?S.monster.re||0:
             el==='Terre'?S.monster.rt||0:el==='Air'?S.monster.ra||0:0;
  return base+assassinatDebuff();
}
function resVs(el,t){
  if(!t) return 0;
  const base=el==='Feu'?t.rf||0:el==='Eau'?t.re||0:el==='Terre'?t.rt||0:el==='Air'?t.ra||0:0;
  const debuff=(t.uid!=null&&t.uid===S.targets[S.focusIdx]?.uid)?assassinatDebuff():0;
  return base+debuff;
}
// Dégâts d'un sort contre une cible précise, à une valeur de jauge `pf` donnée.
function dmgVs(sp,t,pf,crit){
  const st=getEffStats(), lvl=sp.spellLevel||S.build?.level||200;
  const base=scale(0,mechBaseDmg(sp,t),lvl);
  if(!base) return 0;
  // Pour les sorts qui scalent avec la jauge on passe cb=1 (spellDmgMult corrige)
  const isPFScaler=isPFScaling(sp);
  const cb=isPFScaler?1:mechBonus(pf);
  const d=calcDmg({base,mastery:elMastery(sp.element,st,sp),di:st.degatsInfliges||0,
    pos:S.position,resBrut:resVs(sp.element,t),isCrit:crit,cb});
  const dd=Math.round(d*spellDmgMult(sp,pf,t)*mechSpellScale(sp,pf)) + mechFlatBonus(sp,pf);
  return dd + hemoBonus(dd,t,sp);
}

// ── RÈGLES POINT FAIBLE ──────────────────────────────────────────
// Q&R joueur : kill Assassin = pas de PF sur le coup létal uniquement ;
// sort « Consomme Point Faible » = PF à 0 ; Assaut Brutal = sorts 4+ PA générant
// du PF (hors Mise à mort / Traumatisme) ne génèrent plus de PF, +5 % dmg / PA.
function hasPassive(id){ return getActivePassives().some(p=>p.id===id); }
function assassinActive(){ return hasPassive('assassin'); }
function abActive(){ return hasPassive('assaut_brutal'); }
function abApplies(sp){
  if(!abActive() || (sp.apCost||0)<4 || !(sp.pfGen>0)) return false;
  const n=(sp.name||'').toLowerCase();
  return !(n.includes('mise à mort')||n.includes('mise a mort')||n.includes('traumatisme'));
}
// ── MULTIPLICATEURS SPÉCIAUX PAR SORT ───────────────────────────
// spellDmgMult : facteur supplémentaire appliqué APRÈS le calcul de base.
// pf      = Point Faible actuel au moment du lancer.
// target  = cible (pour Attaque mortelle < 50 % PV). Peut être null.
function spellDmgMult(sp, pf, target){
  let m = abApplies(sp)?(1+0.05*(sp.apCost||0)):1; // Assaut Brutal ×(1+0.05×PA)
  const n = (sp.name||'').toLowerCase();

  // Sorts PF-scalants (Arnaque, Mise à mort, Traumatisme) :
  // cb=1 est passé à calcDmg, on applique ici ×(1 + pf/100).
  const isPFScaler = consumesPF(sp) || /arnaque/i.test(n);
  if(isPFScaler){
    m *= 1 + (pf||0) / 100;
  }

  // Attaque mortelle : +40 % si cible < 50 % PV courants
  if(n.includes('attaque') && n.includes('mortelle') && target){
    const maxHp = target._maxHp || target.hp || 0;
    const curHp = target._currentHp ?? maxHp;
    if(maxHp > 0 && curHp < maxHp * 0.5) m *= 1.40;
  }

  // Châtiment / Effroi : +25 % si PF consommé ce tour
  if((n.includes('châtiment') || n.includes('chatiment') || n.includes('effroi')) && S.pfConsumedThisTurn){
    m *= 1.25;
  }

  return m;
}
function consumesPF(sp){ return resConsumes(sp); }

// ── HÉMORRAGIE (Sram) ────────────────────────────────────────────
// Calibré en jeu (Sram lvl125, mannequin 0 %, ~15 mesures) : un coup direct sur
// une cible qui saigne déclenche un coup Feu bonus ≈ 0,96 % des dégâts du coup,
// par niveau d'Hémorragie. Ex. coup de 424 sur cible Hémo 20 → +~81 (≈+19 %).
// Le niveau d'Hémo est suivi depuis le log ; le bonus est désormais intégré au calcul.
// (Le bonus est de l'élément Feu : sur cible résistante au Feu il faudrait la rés Feu,
//  approximation acceptable ici — affiné plus tard si besoin.)
const HEMO_PCT_PER_LVL = 0.0096;
// Niveau d'Hémorragie appliqué par un sort, vu sa description.
// Premier Sang est conditionnel : +10 si la cible n'en a pas, +2 sinon.
function hemoApplied(sp, curHemo){
  const d=sp.desc||'';
  if(/premier sang/i.test(sp.name||'')) return (curHemo>0)?2:10;
  const m=d.match(/h[ée]morragie\s*\(\+?(\d+)\s*niv/i);
  return m?parseInt(m[1]):0;
}
function buildsHemo(sp){ return hemoApplied(sp,0)>0; }
// Consomme l'Hémorragie de la cible (Ouvrir les veines).
function consumesHemo(sp){ return /consomme l'h[ée]morragie/i.test(sp.desc||''); }
// Bonus Hémorragie déclenché par un coup direct `dd` contre la cible `t`,
// au lancer du sort `sp` (le sort applique d'abord son Hémo, puis le coup tique).
function hemoBonus(dd, t, sp){
  if(!t) return 0;
  const hLvl=(t._hemo||0)+(sp?hemoApplied(sp,t._hemo||0):0);
  return hLvl>0 ? Math.round(dd*hLvl*HEMO_PCT_PER_LVL) : 0;
}
// PF généré effectivement par un sort (Assaut Brutal supprime le gain des sorts visés).
function effPfGen(sp){ return abApplies(sp)?0:(sp.pfGen||0); }
// Nouvelle valeur de jauge après lancer de `sp` depuis `pf`. Générique : délègue à
// la mécanique de classe (resNext). Côté Sram, on transmet les règles spécifiques
// (Assaut Brutal supprime le gain, Assassin = pas de gain sur le coup létal).
function nextPF(pf,sp,lethal){
  return resNext(pf,sp,{ lethal, assassin:assassinActive(), suppressGen:abApplies(sp),
    tirPrecis:isModeOn('tir_precis') });
}
// spRange : 'melee' | 'distance' — à passer depuis chaque spell (futur).
// Pour l'instant on infère depuis la portée string si disponible.
function spellRange(sp){
  const r=(sp.range||sp.rng||'').toLowerCase();
  if(!r||r.includes('mêlée')||r.includes('melee')||r==='0'||r==='0-0') return 'melee';
  return 'distance';
}
function elMastery(el,st,sp){
  const M={'Feu':'maitriseFeu','Eau':'maitriseEau','Terre':'maitriseTerre','Air':'maitriseAir','Neutre':null};
  let base=(st.maitriseElem||0)+(M[el]?st[M[el]]||0:0);
  // Maîtrise dos (appliquée quand position === back, sauf si Localisation quantique actif)
  if(S.position==='back' && !hasPassive('localisation_quantique')) base+=(st.maitriseDos||0);
  // Maîtrise mêlée / distance
  const range=sp?spellRange(sp):'distance';
  if(range==='melee') base+=(st.maitriseMelee||0);
  else base+=(st.maitriseDistance||0);
  return base;
}
const MAX_DECK=12; // Limite Wakfu : 12 sorts actifs maximum
function getDeck(){ return S.build?.spells||[]; }
function getSpells(){ return getDeck().filter(s=>(s.damageMin||0)>0&&(s.apCost||0)>0); }
function isInDeck(n){ return getDeck().some(s=>s.name===n); }
let _toastTimer=null;
function toast(msg){
  const el=document.getElementById('toast'); if(!el) return;
  el.textContent=msg; el.classList.add('on');
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('on'),2600);
}
function deckFullWarn(){
  const st=document.getElementById('imptclsstatus');
  if(st){ st.textContent=`⚠ Deck plein : ${MAX_DECK} sorts actifs maximum.`; st.style.color='var(--red)'; setTimeout(()=>st.textContent='',3000); }
}
function toggleSpell(sp){
  if(!S.build) return;
  if(!S.build.spells) S.build.spells=[];
  const i=S.build.spells.findIndex(s=>s.name===sp.name);
  if(i>=0) S.build.spells.splice(i,1);
  else {
    if(S.build.spells.length>=MAX_DECK){ toast(`⚠ Deck plein — ${MAX_DECK} sorts actifs maximum`); return; }
    S.build.spells.push({...sp, spellLevel:S.build.level||200});
  }
  save(); renderSpellsTab(); renderAdvisor();
}
function rankSpells(crit){
  const spells=getSpells(); if(!spells.length||!S.monster) return [];
  const st=getEffStats(), di=st.degatsInfliges||0, lvl=S.build?.level||200;
  const mech=getMech(), pm=getPlayerMech(), dispPF=currentPF();
  return spells.map(sp=>{
    const base=scale(0,mechBaseDmg(sp),sp.spellLevel||lvl);
    const mastery=elMastery(sp.element,st,sp);
    const isPFScaler=isPFScaling(sp);
    const cbAdj=isPFScaler?1:mechBonus(dispPF);
    const dmg=Math.round(calcDmg({base,mastery,di,pos:S.position,resBrut:elRes(sp.element),isCrit:crit,cb:cbAdj})*spellDmgMult(sp,dispPF,S.monster)*mechSpellScale(sp,dispPF))+mechFlatBonus(sp,dispPF);
    const apc=effApCost(sp);
    return {spell:sp,damage:dmg,dpa:apc>0?Math.round(dmg/apc):0,pfScaler:isPFScaler,apEff:apc};
  }).filter(r=>r.damage>0).sort((a,b)=>b.dpa-a.dpa);
}

// ── KNAPSACK ─────────────────────────────────────────────────────
function computeSeq(){
  const spells=getSpells(); if(!spells.length||!S.monster) return null;
  const st=getEffStats(), ap=S.remainingAP??st.ap??6; if(ap<=0) return null;
  const maxAP=Math.min(ap,18), mech=getMech();
  // La jauge n'est suivie dans le knapsack que si elle influence les dégâts
  // (Sram : finisseurs scalants ; Iop : palier 100). Sinon on l'ignore (perf).
  const trackRes=tracksRes();
  const initPF=trackRes?(resVal()):0, di=st.degatsInfliges||0, lvl=S.build?.level||200;

  function dmgAt(sp,pf){
    const base=scale(0,mechBaseDmg(sp),sp.spellLevel||lvl);
    const cb=isPFScaling(sp)?1:mechBonus(pf);
    const d=calcDmg({base,mastery:elMastery(sp.element,st,sp),di,pos:S.position,resBrut:elRes(sp.element),isCrit:S.critMode,cb});
    return Math.round(d*spellDmgMult(sp,pf,S.monster)*mechSpellScale(sp,pf))+mechFlatBonus(sp,pf);
  }
  const dp=Array.from({length:maxAP+1},()=>({dmg:0,pf:initPF,seq:[]}));
  for(let j=1;j<=maxAP;j++) for(const sp of spells){
    const c=effApCost(sp); if(c>j) continue;
    const prev=dp[j-c], pf=trackRes?prev.pf:0, d=prev.dmg+dmgAt(sp,pf);
    if(d>dp[j].dmg) dp[j]={dmg:d,pf:trackRes?nextPF(prev.pf,sp,false):0,seq:[...prev.seq,sp]};
  }
  let chosen=dp[maxAP].seq, strat='';
  const hasFinishers=spells.some(s=>resConsumes(s));
  if(trackRes && hasFinishers){
    const fins=spells.filter(s=>resConsumes(s)), blds=spells.filter(s=>(s.pfGen||0)>0);
    if(fins.length&&blds.length){
      let bestAlt=0, bestSeq=[];
      for(const fin of fins){
        const aL=maxAP-effApCost(fin); if(aL<0) continue;
        const dpF=Array.from({length:aL+1},()=>({pf:initPF,dmg:0,seq:[]}));
        for(let j=1;j<=aL;j++) for(const sp of blds){
          const c=effApCost(sp); if(c>j) continue;
          const prev=dpF[j-c], pf2=nextPF(prev.pf,sp,false);
          if(pf2>dpF[j].pf||(pf2===dpF[j].pf&&prev.dmg+dmgAt(sp,prev.pf)>dpF[j].dmg))
            dpF[j]={pf:pf2,dmg:prev.dmg+dmgAt(sp,prev.pf),seq:[...prev.seq,sp]};
        }
        const tot=dpF[aL].dmg+dmgAt(fin,dpF[aL].pf);
        if(tot>bestAlt){bestAlt=tot;bestSeq=[...dpF[aL].seq,fin];}
      }
      if(bestAlt>dp[maxAP].dmg*1.03){chosen=bestSeq;strat='⚡ PF max → Finisseur';}
      else strat='⚡ Dégâts directs';
    }
  }
  if(!chosen.length) return null;
  let pfSim=initPF;
  const wd=chosen.map(sp=>{const d=dmgAt(sp,pfSim);pfSim=nextPF(pfSim,sp,false);return{spell:sp,damage:d};});
  const apUsed=chosen.reduce((s,sp)=>s+effApCost(sp),0);
  const total=wd.reduce((s,r)=>s+r.damage,0);
  const ccPF=trackRes?resVal():0;
  const totalCC=chosen.reduce((s,sp)=>{
    const base=scale(0,mechBaseDmg(sp),sp.spellLevel||lvl);
    const cb=isPFScaling(sp)?1:mechBonus(ccPF);
    return s+calcDmg({base,mastery:elMastery(sp.element,st,sp),di,pos:S.position,
      resBrut:elRes(sp.element),isCrit:true,cb})+mechFlatBonus(sp,ccPF);
  },0);
  const ok=getOnKillRes();
  // Reinject the on-kill refund into the knapsack: if this sequence is lethal and a
  // passive (e.g. Assassin) refunds AP on kill, solve a second pass for that budget.
  const monMax=S.monster?(S.monster._maxHp||S.monster.hp||0):0;
  const monCur=S.monster?(S.monster._currentHp??monMax):0;
  const lethal=monMax>0 && total>=monCur;
  let refund=null;
  if(ok.ap||ok.mp||ok.wp){
    if(lethal && ok.ap>0){
      const rb=ok.ap, dpR=Array.from({length:rb+1},()=>({dmg:0,pf:pfSim,seq:[]}));
      for(let j=1;j<=rb;j++) for(const sp of spells){
        const c=effApCost(sp); if(c>j) continue;
        const prev=dpR[j-c], pf=trackRes?prev.pf:0, d=prev.dmg+dmgAt(sp,pf);
        if(d>dpR[j].dmg) dpR[j]={dmg:d,pf:trackRes?nextPF(prev.pf,sp,false):0,seq:[...prev.seq,sp]};
      }
      let pf2=pfSim;
      const rwd=dpR[rb].seq.map(sp=>{const d=dmgAt(sp,pf2);pf2=nextPF(pf2,sp,false);return{spell:sp,damage:d};});
      refund={res:ok, lethal:true, seq:rwd, total:rwd.reduce((s,r)=>s+r.damage,0)};
    } else refund={res:ok, lethal:false, seq:[], total:0};
  }
  return{chosen:wd,apUsed,apLeft:ap-apUsed,total,totalCC,maxAP:ap,strat,initPF,killRefund:ok.ap>0?ok:null,refund,lethal};
}

// ── MODE "MAX KILLS" ─────────────────────────────────────────────
// Objectif : maximiser le nombre de cibles tuées avec les PA disponibles,
// en respectant l'ordre de priorité, et en réinjectant les PA regagnés sur kill
// (passif Assassin / sort Attaque létale via getOnKillRes()).
function minKill(target,budget,pf){
  // DP "coût minimal" : pour chaque total de PA ≤ budget, dégâts max atteignables.
  const spells=getSpells(); if(!spells.length) return null;
  const need=curHP(target); if(need<=0) return {seq:[],ap:0,dmg:0,pf};
  const tr=tracksRes();
  const dp=Array.from({length:budget+1},()=>({dmg:0,pf,seq:[]}));
  for(let j=1;j<=budget;j++) for(const sp of spells){
    const c=effApCost(sp); if(c>j) continue;
    const prev=dp[j-c];
    const castPf=tr?prev.pf:0;
    const d=prev.dmg+dmgVs(sp,target,castPf,S.critMode);
    if(d>dp[j].dmg) dp[j]={dmg:d,pf:tr?nextPF(prev.pf,sp,false):0,seq:[...prev.seq,sp]};
  }
  // Plus petit coût en PA qui tue la cible.
  for(let j=1;j<=budget;j++) if(dp[j].dmg>=need) return {seq:dp[j].seq,ap:j,dmg:dp[j].dmg,pf:dp[j].pf};
  return null; // pas tuable dans ce budget
}
function computeKills(){
  const spells=getSpells(); if(!spells.length) return null;
  const alive=aliveTargets(); if(!alive.length) return null;
  const st=getEffStats();
  let budget=S.remainingAP??st.ap??6; if(budget<=0) return null;
  const ok=getOnKillRes(); // PA/PM/PW regagnés par kill (Assassin, etc.)
  const tr=tracksRes();
  let pf=tr?resVal():0;
  const kills=[]; let totalDmg=0; let totalAP=0;
  // Ordre de priorité = ordre du tableau (index 0 = priorité 1).
  for(const t of alive){
    if(budget<=0) break;
    const plan=minKill(t,budget,pf);
    if(!plan || !plan.seq.length){ continue; } // pas tuable maintenant ; on tente la suivante
    // Dégâts réels + jauge reportée à la cible suivante (le dernier sort est le coup létal).
    let p=pf, dmg=0;
    plan.seq.forEach((sp,k)=>{
      dmg+=dmgVs(sp,t,tr?p:0,S.critMode);
      const lethal=(k===plan.seq.length-1);
      p=tr?nextPF(p,sp,lethal):0;
    });
    kills.push({ target:t, seq:plan.seq, ap:plan.ap, dmg });
    totalAP+=plan.ap; totalDmg+=dmg;
    budget-=plan.ap;
    budget+=ok.ap||0; // réinjection PA sur kill (Assassin)
    pf=p;
  }
  // PA restants → on entame la cible survivante la plus prioritaire (dégâts purs).
  let dump=null;
  const killedUids=new Set(kills.map(k=>k.target.uid));
  const survivor=alive.find(t=>!killedUids.has(t.uid));
  if(survivor && budget>0){
    const mAP=Math.min(budget,18);
    const dp=Array.from({length:mAP+1},()=>({dmg:0,pf,seq:[]}));
    for(let j=1;j<=mAP;j++) for(const sp of spells){
      const c=effApCost(sp); if(c>j) continue;
      const prev=dp[j-c], d=prev.dmg+dmgVs(sp,survivor,tr?prev.pf:0,S.critMode);
      if(d>dp[j].dmg) dp[j]={dmg:d,pf:tr?nextPF(prev.pf,sp,false):0,seq:[...prev.seq,sp]};
    }
    if(dp[mAP].seq.length) dump={target:survivor,seq:dp[mAP].seq,dmg:dp[mAP].dmg,ap:dp[mAP].seq.reduce((s,sp)=>s+effApCost(sp),0)};
  }
  return { kills, dump, killCount:kills.length, totalAP, totalDmg,
    aliveCount:alive.length, refundAP:ok.ap||0, budgetStart:S.remainingAP??st.ap??6 };
}

// ── MONSTER HP ───────────────────────────────────────────────────
function applyDmgToMon(amount){
  if(!S.monster) return;
  const max=S.monster._maxHp||S.monster.hp||0; if(!max) return;
  if(S.monster._currentHp===undefined) S.monster._currentHp=max;
  S.monster._currentHp=Math.max(0,S.monster._currentHp-amount);
  renderHPBars();
}
function undoDmgToMon(amount){
  if(!S.monster) return;
  const max=S.monster._maxHp||S.monster.hp||0; if(!max) return;
  S.monster._currentHp=Math.min(max,(S.monster._currentHp||0)+amount);
  renderHPBars();
}
function resetMonHP(){
  if(!S.monster) return;
  S.monster._currentHp=S.monster._maxHp||S.monster.hp||0;
  renderHPBars();
}
function renderHPBars(){
  // Barre de la cible visée dans le panneau Conseils
  const m=S.monster, max=m?m._maxHp||m.hp||0:0, cur=m?m._currentHp??max:0;
  const pct=max>0?Math.max(0,Math.round(cur/max*100)):0;
  const col=pct>50?'var(--green)':pct>25?'var(--gold)':'var(--red)';
  const txt=max>0?`${cur.toLocaleString('fr')} / ${max.toLocaleString('fr')}`:'-';
  const ah=document.getElementById('advhpcard'); if(ah) ah.style.display=max>0?'':'none';
  const an=document.getElementById('advhpname'); if(an){
    const pct=m&&m._hemo>0?Math.round(m._hemo*HEMO_PCT_PER_LVL*100):0;
    const hemo=m&&m._hemo>0?` · 🩸 Hémo ${m._hemo} (+${pct}% dégâts)`:'';
    an.innerHTML=(m?(m.name||m.n||''):'')+(S.targets.length>1?` (${S.focusIdx+1}/${S.targets.length})`:'')
      +(hemo?`<span style="font-size:10px;color:var(--red);font-weight:600">${hemo}</span>`:'');
  }
  const at=document.getElementById('advhptxt'); if(at){at.textContent=txt;at.style.color=col;}
  const ab=document.getElementById('advhpbar'); if(ab){ab.style.width=pct+'%';ab.style.background=col;}
  // Barres par cible dans la liste (gauche)
  S.targets.forEach(t=>{
    const mx=t._maxHp||t.hp||0, c=isDead(t)?0:(t._currentHp??mx);
    const p=mx>0?Math.max(0,Math.round(c/mx*100)):0;
    const cc=isDead(t)?'var(--dim)':p>50?'var(--green)':p>25?'var(--gold)':'var(--red)';
    const bar=document.getElementById('tgthp_'+t.uid); if(bar){bar.style.width=p+'%';bar.style.background=cc;}
    const lab=document.getElementById('tgthpt_'+t.uid); if(lab){lab.textContent=mx>0?`${c.toLocaleString('fr')}/${mx.toLocaleString('fr')}`:'-';lab.style.color=cc;}
  });
}
function renderPlayerStatus(){
  const card=document.getElementById('plrcard'); if(!card) return;
  const pm=S.combat?.mechanics?.['__p']||{}, mx=playerMaxHp();
  const hasHP=mx>0 && pm.hp!=null;
  const gains=[['PA',pm.gAP],['PM',pm.gMP],['PW',pm.gWP]].filter(([,v])=>v>0);
  if(!hasHP && !gains.length){ card.style.display='none'; return; }
  card.style.display='';
  document.getElementById('plrname').textContent=S.playerName||S.detectedName||'Joueur';
  const hpt=document.getElementById('plrhpt'), txt=document.getElementById('plrhptxt');
  if(hasHP){
    const cur=Math.max(0,Math.round(pm.hp)), pct=Math.max(0,Math.min(100,Math.round(cur/mx*100)));
    const col=pct>50?'var(--green)':pct>25?'var(--gold)':'var(--red)';
    hpt.style.display=''; txt.textContent=`${cur.toLocaleString('fr')} / ${mx.toLocaleString('fr')}`; txt.style.color=col;
    const b=document.getElementById('plrhpbar'); b.style.width=pct+'%'; b.style.background=col;
  } else { hpt.style.display='none'; txt.textContent=''; }
  document.getElementById('plrres').innerHTML=gains.length?('Regagné : '+gains.map(([k,v])=>`<span style="color:var(--gold)">+${v} ${k}</span>`).join(' ')):'';
}

// ── CUSTOM SEQUENCE ──────────────────────────────────────────────
const CSQ={steps:[],remAP:0,remMP:0,remWP:0,pfCur:0};
function initCSQ(){
  // Reset complet : vide les étapes, remet les ressources, reset les PV du monstre.
  const st=getEffStats();
  CSQ.steps=[]; CSQ.remAP=S.remainingAP??st.ap??6; CSQ.remMP=st.mp??3; CSQ.remWP=st.wp??0;
  CSQ.pfCur=showsRes()?resVal():0;
  resetMonHP(); renderCSQ();
}
function refreshCSQTarget(){
  // Changement de cible seulement : ne touche pas aux étapes ni aux ressources.
  // On recalcule juste les dégâts de chaque étape vis-à-vis de la nouvelle cible focusée,
  // et on met à jour la barre PV (sans reset les PV de la cible précédente).
  let pf=showsRes()?resVal():0;
  CSQ.steps.forEach(s=>{
    s.dmg=spellDmgAt(s.sp,pf);
    pf=nextPF(pf,s.sp,false);
  });
  renderCSQ();
}
function rbar(v,max,col,lbl){
  const p=max>0?Math.round(Math.max(0,v)/max*100):0;
  return `<div class="rb"><span class="rl2" style="color:${col}">${lbl}</span>
    <div class="rbt"><div class="rbf" style="width:${Math.min(100,p)}%;background:${col}"></div></div>
    <span class="rbn" style="color:${col}">${Math.max(0,v)}/${max}</span></div>`;
}
function spellDmgAt(sp,pf){
  const st=getEffStats(), lvl=sp.spellLevel||S.build?.level||200;
  const base=scale(0,mechBaseDmg(sp),lvl);
  if(!(base>0)) return 0;
  const cb=isPFScaling(sp)?1:mechBonus(pf);
  const d=calcDmg({base,mastery:elMastery(sp.element,st,sp),di:st.degatsInfliges||0,
    pos:S.position,resBrut:elRes(sp.element),isCrit:S.critMode,cb});
  const dd=Math.round(d*spellDmgMult(sp,pf,focusTgt())*mechSpellScale(sp,pf))+mechFlatBonus(sp,pf);
  return dd + hemoBonus(dd,focusTgt(),sp);
}
function addToCSQ(sp){
  if(!S.monster){alert("Sélectionne une cible d'abord.");return;}
  if(!S.build) return;
  const ap=effApCost(sp),mp=sp.mpCost||0,wp=sp.wpCost||0;
  if(ap>CSQ.remAP||mp>CSQ.remMP||wp>CSQ.remWP){
    const el=document.getElementById('csqres');
    if(el){el.style.outline='2px solid var(--red)';setTimeout(()=>el.style.outline='',600);}
    return;
  }
  const dmg=spellDmgAt(sp,CSQ.pfCur);
  CSQ.steps.push({sp,dmg,pfGen:sp.pfGen||0,ap,mp,wp});
  CSQ.remAP=Math.max(0,CSQ.remAP-ap); CSQ.remMP=Math.max(0,CSQ.remMP-mp); CSQ.remWP=Math.max(0,CSQ.remWP-wp);
  CSQ.pfCur=nextPF(CSQ.pfCur,sp,false);
  if(dmg>0) applyDmgToMon(dmg);
  renderCSQ();
}
function removeFromCSQ(idx){
  const keep=CSQ.steps.filter((_,i)=>i!==idx).map(s=>s.sp);
  initCSQ(); keep.forEach(addToCSQ);
}
function renderCSQ(){
  const st=getEffStats(), maxAP=st.ap??6, maxMP=st.mp??3, maxWP=st.wp??0;
  const EL={Feu:'🔴',Eau:'🔵',Terre:'🟢',Air:'🟡',Neutre:'⚪'};
  const re=document.getElementById('csqres');
  if(re) re.innerHTML=rbar(CSQ.remAP,maxAP,'var(--gold)','PA')+(maxMP>0?rbar(CSQ.remMP,maxMP,'var(--blue)','PM'):'')+(maxWP>0?rbar(CSQ.remWP,maxWP,'var(--purple)','PW'):'');
  const se=document.getElementById('csqsteps');
  if(se){
    if(!CSQ.steps.length) se.innerHTML='<span style="font-size:10px;color:var(--dim)">Clic sur les sorts du ranking ci-dessus.</span>';
    else{
      se.innerHTML=CSQ.steps.map((s,i)=>{
        const el=s.sp.element||'Neutre';
        const co=[s.ap?`${s.ap}PA`:'',s.mp?`${s.mp}PM`:'',s.wp?`${s.wp}PW`:''].filter(Boolean).join(' ');
        return `<div class="ss"><span>${EL[el]}</span><span style="font-weight:600">${s.sp.name}</span>
          <span class="ssap">${co}</span>${s.dmg>0?`<span class="ssdmg">${s.dmg.toLocaleString('fr')}</span>`:''}
          ${s.pfGen>0?`<span style="font-size:9px;color:var(--red)">+${s.pfGen}PF</span>`:''}
          <span data-d="${i}" style="color:var(--dim);cursor:pointer;margin-left:auto;padding:0 3px;font-size:11px">✕</span></div>`;
      }).join('');
      se.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeFromCSQ(parseInt(b.dataset.d));}));
    }
  }
  const tot=CSQ.steps.reduce((s,r)=>s+r.dmg,0), apU=maxAP-CSQ.remAP;
  const sm=document.getElementById('csqsum');
  if(sm) sm.innerHTML=CSQ.steps.length?`<span class="stot">${tot.toLocaleString('fr')} dmg</span><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${apU}/${maxAP} PA</span>`:'<span style="color:var(--dim);font-family:var(--mono)">—</span>';
  const pr=document.getElementById('csqpfrow'), mech=getMech();
  if(pr){
    // Affiche la jauge de ressource pour toute classe qui en a une influençant le calcul.
    const show=showsRes();
    pr.style.display=show?'':'none';
    if(show){
      const mx=mech.res.max;
      document.getElementById('csqpfl').textContent=mech.res.label;
      const f=document.getElementById('csqpff');
      f.style.width=Math.min(100,CSQ.pfCur/mx*100)+'%'; f.style.background=mech.res.color;
      document.getElementById('csqpfv').textContent=CSQ.pfCur+'/'+mx;
    }
  }
}
document.getElementById('csqreset').addEventListener('click',initCSQ);

// ── PANNEAU CIBLES ───────────────────────────────────────────────
const EL = {Feu:'🔴',Eau:'🔵',Terre:'🟢',Air:'🟡',Neutre:'⚪'};
function renderMonPanel(){
  const sec=document.getElementById('monsec'), list=document.getElementById('tgtlist');
  const cnt=document.getElementById('tgtcount');
  if(!S.targets.length){ if(sec) sec.style.display='none'; if(list) list.innerHTML=''; return; }
  if(sec) sec.style.display='';
  if(cnt) cnt.textContent=S.targets.length;
  list.innerHTML=S.targets.map((t,i)=>{
    const focused=i===S.focusIdx, dead=isDead(t);
    const res=`🔴${t.rf||0} 🔵${t.re||0} 🟢${t.rt||0} 🟡${t.ra||0}`;
    return `<div class="tgtrow ${focused?'foc':''} ${dead?'dead':''}" data-uid="${t.uid}"
        style="border:1px solid ${focused?'var(--gold)':'var(--border)'};border-radius:6px;padding:6px 8px;margin-bottom:6px;opacity:${dead?0.5:1}">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="prio" style="font-family:var(--mono);font-size:10px;color:var(--gold);width:14px">${i+1}</span>
        <button class="tfoc btn sml" data-foc="${t.uid}" title="Viser"
          style="padding:1px 6px;color:${focused?'var(--gold)':'var(--dim)'}">${focused?'●':'○'}</button>
        <span style="flex:1;min-width:0;font-weight:700;font-size:12px;color:${dead?'var(--dim)':'var(--gold)'}">${t.name}${t.level?` <span style="font-weight:400;color:var(--dim);font-size:10px">niv.${t.level}</span>`:''}${dead?' 💀':''}</span>
        <span style="display:flex;flex-direction:column;gap:1px">
          <span class="tup" data-up="${t.uid}" style="cursor:pointer;font-size:9px;line-height:1;color:var(--muted)">▲</span>
          <span class="tdn" data-dn="${t.uid}" style="cursor:pointer;font-size:9px;line-height:1;color:var(--muted)">▼</span>
        </span>
        <span class="trm" data-rm="${t.uid}" style="cursor:pointer;color:var(--dim);font-size:12px;padding:0 2px">✕</span>
      </div>
      ${(t._maxHp||t.hp)?`<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <div class="hpt" style="flex:1;height:6px"><div id="tgthp_${t.uid}" class="hpf" style="width:100%"></div></div>
        <span id="tgthpt_${t.uid}" style="font-family:var(--mono);font-size:9px"></span>
      </div>`:''}
      <div style="font-size:9px;color:var(--muted);font-family:var(--mono);margin-top:3px">${res}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-foc]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();focusTarget(b.dataset.foc);}));
  list.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();moveTarget(b.dataset.up,-1);}));
  list.querySelectorAll('[data-dn]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();moveTarget(b.dataset.dn,1);}));
  list.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeTarget(b.dataset.rm);}));
  renderHPBars();
}
const moninp=document.getElementById('moninp'), monres=document.getElementById('monres');
moninp.addEventListener('input',()=>{
  const q=moninp.value.trim().toLowerCase();
  if(q.length<2){monres.style.display='none';return;}
  const hits=MONS.filter(m=>(m.n||m.name||'').toLowerCase().includes(q)).slice(0,12);
  if(!hits.length){monres.style.display='none';return;}
  monres.innerHTML=hits.map(m=>`<div class="mr" data-id="${m.id}">
    <span style="color:var(--dim);font-size:10px;width:32px">niv.${m.lv||m.level||'?'}</span>
    <span>${m.n||m.name}</span>
    ${m.hp>0?`<span style="margin-left:auto;font-size:10px;color:var(--dim)">${(m.hp||0).toLocaleString('fr')} PV</span>`:''}
  </div>`).join('');
  monres.style.display='';
  monres.querySelectorAll('.mr').forEach(row=>row.addEventListener('click',()=>{
    const m=MONS.find(m=>m.id===parseInt(row.dataset.id));
    if(m){ addTarget({id:m.id, name:m.n||m.name, level:m.lv||m.level||0,
      hp:m.hp||0, rf:m.rf||0, re:m.re||0, rt:m.rt||0, ra:m.ra||0});
      moninp.value=''; monres.style.display='none'; }
  }));
});
document.getElementById('monclear').addEventListener('click',clearTargets);
document.getElementById('cmadd').addEventListener('click',()=>{
  addTarget({id:0,name:document.getElementById('cmn').value.trim()||'Custom',level:0,
    hp:parseInt(document.getElementById('cmhp').value)||0,
    rf:parseInt(document.getElementById('cmrf').value)||0,
    re:parseInt(document.getElementById('cmre').value)||0,
    rt:parseInt(document.getElementById('cmt').value)||0,
    ra:parseInt(document.getElementById('cma').value)||0});
});

function renderIdle(){
  const el=document.getElementById('idle'); if(!el) return;
  const steps=[
    {n:1, ok:!!S.build?.class,            lbl:'Choisir ta classe & ton niveau', hint:'Build',  go:()=>openLeftTab('build')},
    {n:2, ok:getDeck().length>0,          lbl:'Ajouter des sorts au deck',       hint:'Sorts',  go:()=>openCenterTab('spells')},
    {n:3, ok:S.targets.length>0,          lbl:'Choisir une cible',               hint:'Cible',  go:()=>openLeftTab('target')},
    {n:4, ok:document.getElementById('led')?.classList.contains('on'), lbl:'Connecter le log', opt:true, hint:'Log', go:()=>openLeftTab('log')},
  ];
  el.innerHTML=`<div style="font-size:30px">⚔</div>
    <div style="font-size:13px;color:var(--muted)">Bienvenue — quelques étapes pour démarrer</div>
    <div class="ckl">${steps.map(s=>`
      <div class="cki ${s.ok?'ok':''}" data-n="${s.n}">
        <span class="ckn">${s.ok?'✓':s.n}</span>
        <span class="ckt">${s.lbl}${s.opt?' <i>(optionnel)</i>':''}</span>
        <span class="ckh">${s.hint} ›</span>
      </div>`).join('')}</div>
    <div class="ckhint">❔ Ctrl + survol d'un sort = détails &nbsp;·&nbsp; 1/2/3 = position &nbsp;·&nbsp; C = critique</div>`;
  el.querySelectorAll('.cki').forEach(it=>it.addEventListener('click',()=>steps[+it.dataset.n-1].go()));
}
// ── ADVISOR ───────────────────────────────────────────────────────
function renderAdvisor(){
  const hasBuild=!!S.build, hasMon=!!S.monster;
  const showIdle=!(hasBuild||hasMon);
  document.getElementById('idle').style.display=showIdle?'flex':'none';
  if(showIdle) renderIdle();
  const ac=document.getElementById('advcontent');
  ac.style.display=(hasBuild||hasMon)?'flex':'none';
  if(!hasBuild&&!hasMon) return;
  renderHPBars();
  renderPlayerStatus();
  if(!hasBuild){
    ['gaugecard','tipscard','seqcard'].forEach(id=>document.getElementById(id).style.display='none');
    document.getElementById('ranklist').innerHTML='';
    document.getElementById('rankempty').textContent='Configure un build.';
    return;
  }
  // Gauge
  const mech=getMech(), pm=getPlayerMech(), gc=document.getElementById('gaugecard');
  if(mech?.res){
    gc.style.display='';
    const r=mech.res, val=pm[r.id]||0, pct=Math.min(100,Math.round(Math.abs(val)/r.max*100));
    document.getElementById('gaugecontent').innerHTML=
      `<div class="gr"><span class="gl">${r.label}</span>
       <div class="gb"><div class="gf" style="width:${pct}%;background:${r.color}"></div></div>
       <span class="gv">${val}/${r.max}</span></div>`;
  } else gc.style.display='none';
  // Tips : mécanique calibrée (Sram) + rappel de classe informationnel
  const tips=[...(mech?.advice(pm)||[]), ...getClassNote()], tc=document.getElementById('tipscard');
  if(tips.length){tc.style.display='';document.getElementById('tipscontent').innerHTML=tips.map(t=>`<div class="tip ${t.p}"><div class="tipd"></div><div>${t.msg}</div></div>`).join('');}
  else tc.style.display='none';
  // Ranking
  const ranked=rankSpells(S.critMode), rl=document.getElementById('ranklist'), re=document.getElementById('rankempty');
  const hasRes=!!mech?.res, resTracks=showsRes(), dispPF=currentPF();
  const resLbl=mech?.res?.label||'', resMax=mech?.res?.max||100;
  const baseTitle=S.critMode?'⚡★ Sorts — Dégâts CC':'⚡ Sorts — Dégâts/PA';
  const rtt=document.getElementById('ranktitle');
  rtt.textContent=baseTitle+(hasRes&&resTracks?` · ${resLbl} ${dispPF}${S.previewMaxPF?' (aperçu)':''}`:'');
  // Bouton aperçu jauge=max : seulement si la VALEUR de jauge change les dégâts
  // (Sram PF, Iop Concentration). Pas pour le Crâ (levier = toggle Tir précis).
  const pfBtnId='pfPreviewBtn';
  let pfBtn=document.getElementById(pfBtnId);
  const showPFBtn=hasRes && tracksRes();
  if(showPFBtn && !pfBtn){
    pfBtn=document.createElement('button');
    pfBtn.id=pfBtnId; pfBtn.className='btn sml';
    pfBtn.style.cssText='margin-bottom:6px';
    pfBtn.addEventListener('click',()=>{ S.previewMaxPF=!S.previewMaxPF; save(); renderAdvisor(); });
    rl.parentNode.insertBefore(pfBtn,rl);
  }
  if(pfBtn){
    pfBtn.style.display=showPFBtn?'':'none';
    pfBtn.style.color=S.previewMaxPF?'var(--gold)':'var(--dim)';
    pfBtn.style.borderColor=S.previewMaxPF?'var(--gold)':'var(--border)';
    pfBtn.textContent=S.previewMaxPF?`✓ Aperçu ${resLbl}=${resMax}`:`○ Voir dégâts à ${resLbl}=${resMax}`;
  }
  if(!ranked.length){rl.innerHTML='';re.style.display='';re.textContent='Ajoute des sorts au deck et sélectionne une cible.';}
  else{
    re.style.display='none';
    const bestName=ranked[0]?.spell.name;
    const byEl={};
    ranked.forEach(r=>{ const k=r.spell.element||'Neutre'; (byEl[k]||(byEl[k]=[])).push(r); });
    const ord=['Feu','Eau','Terre','Air','Neutre'];
    const sortedEls=[...ord.filter(e=>byEl[e]),...Object.keys(byEl).filter(e=>!ord.includes(e))];
    rl.innerHTML=sortedEls.map(el=>
      `<div class="elhdr" style="font-size:10px;color:var(--muted);margin:6px 0 3px;font-weight:700">${EL[el]||'⚪'} ${el}</div>`+
      byEl[el].map(r=>{
        const isBest=r.spell.name===bestName;
        // Coût PA effectif (Ecaflip Dé six réduit) — affiché barré si différent du coût de base.
        const apc=r.apEff??r.spell.apCost, apTxt=apc!==r.spell.apCost?`<s style="color:var(--dim)">${r.spell.apCost}</s>${apc}PA`:(r.spell.apCost?`${r.spell.apCost}PA`:'');
        const co=[apTxt,r.spell.mpCost?`${r.spell.mpCost}PM`:''].filter(Boolean).join(' ');
        const pf=r.spell.pfGen>0?`<span style="font-size:9px;color:var(--red)">+${r.spell.pfGen}PF</span>`:'';
        const scLbl=getMech()?.res?.label||'jauge';
        const sc=r.pfScaler?`<span style="font-size:9px;color:var(--purple)" title="Dégâts variables selon ${scLbl}">⤢${scLbl}</span>`:'';
        const hm=buildsHemo(r.spell)?`<span style="font-size:9px;color:var(--red)" title="Applique de l'Hémorragie (DoT Feu)">🩸+${hemoApplied(r.spell,focusTgt()?._hemo||0)}</span>`:'';
        // Crâ : indicateur Tir précis (dégât amélioré dispo / coût Précision quand actif)
        const tpOn=isModeOn('tir_precis');
        const tp=r.spell.tp>0?`<span style="font-size:9px;color:${tpOn?'var(--gold)':'var(--dim)'}" title="${tpOn?'Tir précis actif — consomme '+r.spell.tpCost+' Précision':'Dégât amélioré en Tir précis'}">🎯${tpOn&&r.spell.tpCost?`-${r.spell.tpCost}`:''}</span>`:'';
        // Dégât conditionnel « à la place » (Sacrieur : Aversion stabilisé, Fracasse vs Armure)
        const altOn=r.spell.altCond&&isModeOn(r.spell.altCond);
        const alt=r.spell.altDmg>0?`<span style="font-size:9px;color:${altOn?'var(--gold)':'var(--dim)'}" title="${altOn?'Condition active — dégâts majorés':'Dégât majoré si condition remplie'}">⚔${altOn?'✓':''}</span>`:'';
        // Eliotrope : indicateurs Exalté / Portail (dégât modifié selon le mode)
        const elioEx=r.spell.exaltedDmg>0?`<span style="font-size:9px;color:${isModeOn('exalte')?'var(--gold)':'var(--dim)'}" title="Dégât différent en mode Exalté (${r.spell.exaltedDmg})">⟳</span>`:'';
        const elioP=(r.spell.portalDmg>0||r.spell.portalBonus>0)?`<span style="font-size:9px;color:${isModeOn('portail')?'var(--gold)':'var(--dim)'}" title="Dégât majoré via Portail">🌀</span>`:'';
        // Eniripsa : dégât conditionnel sur les PV (auto selon l'état réel)
        const eniHp=(r.spell.lowTgtDmg>0||r.spell.selfHpBonus>0)?`<span style="font-size:9px;color:var(--dim)" title="${r.spell.lowTgtDmg>0?'Dégât plein si la cible a ≥ 80 % PV':'Bonus si l’Eniripsa a ≥ 80 % PV'}">❤</span>`:'';
        return `<div class="sr ${isBest?'best':''}" data-sn="${r.spell.name}" style="cursor:pointer">
          <span class="srn">${isBest?'★ ':''}${r.spell.name}</span>
          <span class="scap">${co}</span>${pf}${sc}${hm}${tp}${alt}${elioEx}${elioP}${eniHp}
          <span class="srd">${r.damage.toLocaleString('fr')}</span>
          <span class="srdpa">${r.dpa}/PA</span></div>`;
      }).join('')
    ).join('');
    rl.querySelectorAll('.sr').forEach(row=>{
      const r=ranked.find(r=>r.spell.name===row.dataset.sn);
      if(r){ bindSpTip(row,r.spell.desc||''); row.addEventListener('click',()=>addToCSQ(r.spell)); }
    });
  }
  // Mode de calcul
  const mc=document.getElementById('modecard');
  if(mc){
    mc.style.display=S.targets.length?'':'none';
    const bd=document.getElementById('modedmg'), bk=document.getElementById('modekills');
    const on='var(--gold)', off='var(--dim)';
    if(bd) bd.style.color=S.calcMode==='dmg'?on:off;
    if(bk) bk.style.color=S.calcMode==='kills'?on:off;
    if(bd) bd.style.borderColor=S.calcMode==='dmg'?on:'var(--border)';
    if(bk) bk.style.borderColor=S.calcMode==='kills'?on:'var(--border)';
  }
  // Optimal seq
  if(S.calcMode==='kills'){
    document.getElementById('seqcard').style.display='none';
    renderKillsPlan();
  } else {
    document.getElementById('killscard').style.display='none';
    renderDmgSeq();
  }
}
function renderDmgSeq(){
  const seq=computeSeq(), sc=document.getElementById('seqcard');
  if(seq?.chosen?.length){
    sc.style.display='';
    const mech=getMech(), showRes=showsRes(), resMax=mech?.res?.max||100;
    const st=getEffStats(), maxAP=st.ap??6, maxMP=st.mp??3, maxWP=st.wp??0;
    document.getElementById('seqstrat').textContent=(seq.strat||'')+(abActive()?' · 🗡 Assaut Brutal':'');
    let remAP=seq.maxAP, remMP=maxMP, remWP=maxWP;
    let pfSim=seq.initPF??(showRes?resVal():0);
    const used=new Set();
    const updBars=()=>{
      document.getElementById('seqres').innerHTML=
        rbar(remAP,maxAP,'var(--gold)','PA')+(maxMP>0?rbar(remMP,maxMP,'var(--blue)','PM'):'')+(maxWP>0?rbar(remWP,maxWP,'var(--purple)','PW'):'');
    };
    const updPF=()=>{
      const pr=document.getElementById('seqpfrow');
      if(pr){
        pr.style.display=showRes?'':'none';
        if(showRes){
          document.getElementById('seqpfl').textContent=mech.res.label;
          const f=document.getElementById('seqpff');
          f.style.width=Math.min(100,pfSim/resMax*100)+'%'; f.style.background=mech.res.color;
          document.getElementById('seqpfv').textContent=pfSim+'/'+resMax;
        }
      }
    };
    updBars(); updPF();
    const resGenBadge=(sp)=>{
      // Génération de jauge à afficher : Sram via pfGen, autres classes via resGen.
      const g=showRes?((sp.pfGen||0)?effPfGen(sp):resGenOf(sp)):0;
      return g>0?`<span style="font-size:9px;color:${mech.res.color}">+${g}</span>`:'';
    };
    document.getElementById('seqsteps').innerHTML=seq.chosen.map((r,i)=>
      `<div class="ss" data-i="${i}" data-ap="${r.spell.apCost||0}" data-mp="${r.spell.mpCost||0}" data-wp="${r.spell.wpCost||0}" data-dmg="${r.damage}" data-pfgen="${effPfGen(r.spell)}" data-consume="${consumesPF(r.spell)?1:0}">
        <span>${EL[r.spell.element||'Neutre']}</span><span>${r.spell.name}</span>
        <span class="ssap">${[r.spell.apCost?`${r.spell.apCost}PA`:'',r.spell.mpCost?`${r.spell.mpCost}PM`:''].filter(Boolean).join(' ')}</span>
        <span class="ssdmg">${r.damage.toLocaleString('fr')}</span>
        ${!abApplies(r.spell)?resGenBadge(r.spell):''}
        ${abApplies(r.spell)?`<span style="font-size:9px;color:var(--sky)">🗡</span>`:''}
        ${consumesPF(r.spell)?`<span style="font-size:9px;color:var(--gold)">✦PF</span>`:''}
      </div>`
    ).join('');
    document.getElementById('seqsum').innerHTML=
      `<span class="stot">${seq.total.toLocaleString('fr')}</span>
       <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${seq.apUsed}/${seq.maxAP} PA</span>
       <span style="font-size:10px;color:var(--gold)">CC: ${seq.totalCC.toLocaleString('fr')}</span>
       ${seq.killRefund?`<span style="font-size:10px;color:var(--blue)">+${seq.killRefund.ap}PA ${seq.killRefund.mp}PM ${seq.killRefund.wp}PW sur kill${seq.lethal?' ✓ létal':''}${seq.refund&&seq.refund.seq.length?` → ${seq.refund.seq.map(r=>r.spell.name).join(' + ')} (+${seq.refund.total.toLocaleString('fr')})`:''}</span>`:''}`;
    document.getElementById('seqsteps').querySelectorAll('.ss').forEach(el=>{
      bindSpTip(el,(seq.chosen[parseInt(el.dataset.i)]||{}).spell?.desc||'');
      el.addEventListener('click',()=>{
        const i=parseInt(el.dataset.i),ap=parseInt(el.dataset.ap)||0,mp=parseInt(el.dataset.mp)||0,wp=parseInt(el.dataset.wp)||0,dmg=parseInt(el.dataset.dmg)||0;
        const pfg=parseInt(el.dataset.pfgen)||0, consumes=el.dataset.consume==='1';
        if(used.has(i)){
          used.delete(i);remAP=Math.min(maxAP,remAP+ap);remMP=Math.min(maxMP,remMP+mp);remWP=Math.min(maxWP,remWP+wp);
          el.classList.remove('used');if(dmg>0)undoDmgToMon(dmg);
          // recalc pfSim from scratch
          pfSim=seq.initPF??(showRes?resVal():0);
          seq.chosen.forEach((r,j)=>{ if(used.has(j)) pfSim=nextPF(pfSim,r.spell,false); });
        } else {
          if(ap>remAP||mp>remMP||wp>remWP)return;
          used.add(i);remAP-=ap;remMP-=mp;remWP-=wp;el.classList.add('used');
          if(dmg>0)applyDmgToMon(dmg);
          pfSim=nextPF(pfSim,el._spell||seq.chosen[i].spell,false);
        }
        updBars(); updPF();
      });
    });
    document.getElementById('seqreset').onclick=()=>{
      used.clear();remAP=seq.maxAP;remMP=maxMP;remWP=maxWP;
      pfSim=seq.initPF??(showRes?resVal():0);
      document.getElementById('seqsteps').querySelectorAll('.ss').forEach(e=>e.classList.remove('used'));
      resetMonHP();updBars();updPF();
    };
  } else sc.style.display='none';
}
function renderKillsPlan(){
  const kc=document.getElementById('killscard'); if(!kc) return;
  const plan=computeKills();
  if(!plan){ kc.style.display='none'; return; }
  kc.style.display='';
  const sum=document.getElementById('killsum');
  if(sum) sum.textContent=`${plan.killCount}/${plan.aliveCount} kills · ${plan.totalAP} PA`+(plan.refundAP?` (+${plan.refundAP} PA/kill)`:'')+(abActive()?' · 🗡 AB':'');
  const steps=document.getElementById('killsteps');
  let html='';
  plan.kills.forEach((k,n)=>{
    const seqTxt=k.seq.map(sp=>`${EL[sp.element||'Neutre']} ${sp.name}`).join(' + ');
    html+=`<div style="border:1px solid var(--border);border-left:3px solid var(--red);border-radius:5px;padding:5px 8px;margin-bottom:5px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="font-family:var(--mono);font-size:10px;color:var(--red)">#${n+1} 💀</span>
        <span style="font-weight:700;font-size:12px;color:var(--gold)">${k.target.name}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted)">${k.ap} PA · ${k.dmg.toLocaleString('fr')} dmg</span>
      </div>
      <div style="font-size:10px;color:var(--muted)">${seqTxt}</div></div>`;
  });
  if(plan.dump){
    const seqTxt=plan.dump.seq.map(sp=>`${EL[sp.element||'Neutre']} ${sp.name}`).join(' + ');
    html+=`<div style="border:1px solid var(--border);border-left:3px solid var(--sky);border-radius:5px;padding:5px 8px;margin-bottom:5px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="font-family:var(--mono);font-size:10px;color:var(--sky)">PA restants →</span>
        <span style="font-weight:700;font-size:12px;color:var(--gold)">${plan.dump.target.name}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted)">${plan.dump.ap} PA · ${plan.dump.dmg.toLocaleString('fr')} dmg</span>
      </div>
      <div style="font-size:10px;color:var(--muted)">${seqTxt}</div></div>`;
  }
  if(!plan.kills.length && !plan.dump) html='<div style="font-size:10px;color:var(--dim)">Aucune cible tuable avec les PA disponibles.</div>';
  steps.innerHTML=html;
}
function setCalcMode(mode){ S.calcMode=mode; save(); renderAdvisor(); }
document.getElementById('modedmg')?.addEventListener('click',()=>setCalcMode('dmg'));
document.getElementById('modekills')?.addEventListener('click',()=>setCalcMode('kills'));
function renderSpellsTab(){
  // Migration : les anciens decks pouvaient dépasser la limite de 12 sorts actifs
  if(S.build?.spells?.length>MAX_DECK){ S.build.spells=S.build.spells.slice(0,MAX_DECK); save(); }
  const deck=getDeck(), all=getClassSpells(), lvl=S.build?.level||200;
  document.getElementById('deckcount').textContent=`${deck.length}/${MAX_DECK}`;
  // Toggles situationnels : Sram (Assassinat/Surineur/PF) + modes de mécanique
  // (Crâ : Tir précis). Système unifié, stocké dans S.situationalBuffs.
  const sitEl=document.getElementById('sitbuffs');
  if(sitEl){
    const deckNames=new Set(getDeck().map(s=>(s.name||'').toLowerCase()));
    const toggles=[];
    if(S.build?.class==='sram'){
      Object.entries(SITUATIONAL).filter(([,v])=>v.cls==='sram'&&(!v.spell||deckNames.has(v.spell.toLowerCase())))
        .forEach(([id,v])=>toggles.push({id,label:v.label,on:sitActive(id)}));
    }
    // Modes de la mécanique de classe (Crâ : Tir précis…)
    mechModes().forEach(md=>toggles.push({id:md.id,label:md.label,desc:md.desc,on:isModeOn(md.id)}));
    // Compteurs (Ecaflip : Dé six lancés) — affichés en stepper −/valeur/+
    const counters=mechCounters();
    sitEl.style.display=(toggles.length||counters.length)?'':'none';
    sitEl.innerHTML=toggles.map(t=>
      `<button class="btn sml${t.on?' on':''}" data-sit="${t.id}"${t.desc?` title="${t.desc.replace(/"/g,'&quot;')}"`:''}
        style="color:${t.on?'var(--gold)':'var(--dim)'};border-color:${t.on?'var(--gold)':'var(--border)'};white-space:nowrap">
        ${t.on?'✓':'○'} ${t.label}</button>`).join('')
      + counters.map(c=>{
        const v=counterVal(c.id);
        return `<span class="cntr" title="${(c.desc||'').replace(/"/g,'&quot;')}" style="display:inline-flex;align-items:center;gap:4px;border:1px solid ${v?'var(--gold)':'var(--border)'};border-radius:5px;padding:1px 4px;white-space:nowrap">
          <span style="font-size:10px;color:${v?'var(--gold)':'var(--dim)'}">${c.label}</span>
          <button class="btn sml" data-cnt="${c.id}" data-d="-1" style="padding:0 5px">−</button>
          <span style="font-family:var(--mono);font-size:11px;color:var(--gold);min-width:10px;text-align:center">${v}</span>
          <button class="btn sml" data-cnt="${c.id}" data-d="1" style="padding:0 5px">+</button>
        </span>`;
      }).join('');
    sitEl.querySelectorAll('[data-sit]').forEach(b=>b.addEventListener('click',()=>toggleSit(b.dataset.sit)));
    sitEl.querySelectorAll('[data-cnt]').forEach(b=>b.addEventListener('click',()=>bumpCounter(b.dataset.cnt,parseInt(b.dataset.d))));
  }
  // Deck
  const de=document.getElementById('decklist');
  if(!deck.length){ de.innerHTML='<div style="font-size:10px;color:var(--dim)">Aucun sort dans le deck.</div>'; }
  else{
    de.innerHTML=deck.map(sp=>{
      const spL=sp.spellLevel||lvl, dS=sp.damageMax>0?scale(sp.damageMin||0,sp.damageMax,spL):0;
      const co=[sp.apCost?`${sp.apCost}PA`:'',sp.mpCost?`${sp.mpCost}PM`:'',sp.wpCost?`${sp.wpCost}PW`:''].filter(Boolean).join(' ');
      return `<div class="sc dk" data-n="${sp.name}">
        <span>${EL[sp.element||'Neutre']||'⚪'}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="scn">${sp.name}</span><span class="scap">${co||'passif'}</span>
            ${dS>0?`<span class="scdmg">~${dS}</span>`:''}
            ${sp.pfGen>0?`<span style="font-size:9px;color:var(--red)">+${sp.pfGen}PF</span>`:''}
            ${sp.isFinisher?`<span style="font-size:9px;color:var(--gold)">★fin</span>`:''}
          </div>
          ${sp.desc?`<div class="scdf">${sp.desc}</div>`:''}
          ${dS>0?`<div style="display:flex;align-items:center;gap:4px;margin-top:3px">
            <span style="font-size:9px;color:var(--muted)">Niv.</span>
            <input type="range" min="1" max="230" value="${spL}" data-sn="${sp.name}" class="slvl"
              style="flex:1;height:3px;accent-color:var(--gold)"/>
            <span class="slvlv" style="font-size:9px;font-family:var(--mono);color:var(--gold);width:24px">${spL}</span>
          </div>`:''}
        </div>
        <span data-rm="${sp.name}" style="color:var(--dim);font-size:13px;cursor:pointer;padding:0 2px;flex-shrink:0">✕</span>
      </div>`;
    }).join('');
    de.querySelectorAll('.slvl').forEach(sl=>{
      const vl=sl.nextElementSibling;
      sl.addEventListener('input',()=>{ if(vl)vl.textContent=sl.value; const sp=getDeck().find(s=>s.name===sl.dataset.sn); if(sp){sp.spellLevel=parseInt(sl.value);save();} });
      sl.addEventListener('change',renderAdvisor);
    });
    de.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',e=>{
      e.stopPropagation(); const sp=getDeck().find(s=>s.name===b.dataset.rm); if(sp) toggleSpell(sp);
    }));
  }
  // All spells
  const ae=document.getElementById('allspells');
  if(!all.length){ ae.innerHTML=`<div style="font-size:10px;color:var(--dim)">${S.build?'Aucun sort disponible pour cette classe.':'Choisis ta classe dans l\'onglet Build.'}</div>`; return; }
  const byEl={};
  all.forEach(sp=>{ const k=sp.element||'Neutre'; if(!byEl[k]) byEl[k]=[]; byEl[k].push(sp); });
  const ord=['Feu','Eau','Terre','Air','Neutre'];
  const sorted=[...ord.filter(e=>byEl[e]),...Object.keys(byEl).filter(e=>!ord.includes(e))];
  ae.innerHTML=sorted.map(el=>
    `<div class="elhdr" style="font-size:10px;color:var(--muted);margin:6px 0 3px;font-weight:700">${EL[el]||'⚪'} ${el}</div>`+
    byEl[el].map(sp=>{
      const inD=isInDeck(sp.name);
      const co=[sp.apCost?`${sp.apCost}PA`:'',sp.mpCost?`${sp.mpCost}PM`:''].filter(Boolean).join(' ');
      const meta=[sp.range?`◎${sp.range}`:'',sp.spellType==='zone'?'zone':'',sp.los===false?'sans LdV':''].filter(Boolean).join(' · ');
      return `<div class="sc ${inD?'dk':''}" data-n="${sp.name}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="scn">${sp.name}</span><span class="scap">${co||'passif'}</span>
            ${sp.damageMax>0?`<span class="scdmg">${sp.damageMin}-${sp.damageMax}</span>`:''}
            ${sp.damageCrit>0?`<span style="font-size:9px;color:#c0c060">CC:${sp.damageCrit}</span>`:''}
            ${sp.pfGen>0?`<span style="font-size:9px;color:var(--red)">+${sp.pfGen}PF</span>`:''}
            ${sp.isFinisher?`<span style="font-size:9px;color:var(--gold)">★</span>`:''}
          </div>
          ${meta?`<div style="font-size:9px;color:var(--muted);font-family:var(--mono);margin-top:1px">${meta}</div>`:''}
          ${sp.desc?`<div class="scdf">${sp.desc}</div>`:''}
        </div>
        <span style="color:${inD?'var(--gold)':'var(--dim)'};font-size:13px;flex-shrink:0">${inD?'✓':'+'}</span>
      </div>`;
    }).join('')
  ).join('');
  ae.querySelectorAll('.sc').forEach(el=>el.addEventListener('click',()=>{
    const sp=all.find(s=>s.name===el.dataset.n); if(sp) toggleSpell(sp);
  }));
}
document.getElementById('imptclsbtn').addEventListener('click',()=>{
  const st=document.getElementById('imptclsstatus');
  if(!S.build){st.textContent="⚠ Choisis ta classe d'abord.";return;}
  const all=getClassSpells().filter(s=>s.damageMax>0);
  if(!all.length){st.textContent='⚠ Aucun sort disponible.';return;}
  // Limite Wakfu : 12 sorts actifs max — on garde les meilleurs ratios dégâts/PA
  const picked=[...all].sort((a,b)=>(b.damageMax/(b.apCost||1))-(a.damageMax/(a.apCost||1))).slice(0,MAX_DECK);
  S.build.spells=picked.map(s=>({...s,spellLevel:S.build.level||200}));
  save(); renderSpellsTab(); renderAdvisor();
  st.textContent=all.length>MAX_DECK
    ?`✅ ${picked.length}/${all.length} sorts importés (limite : ${MAX_DECK} sorts actifs)`
    :`✅ ${picked.length} sorts importés`;
  st.style.color='var(--green)';
  setTimeout(()=>st.textContent='',3000);
});

// ── PASSIVES TAB ─────────────────────────────────────────────────
function renderPassivesTab(){
  const le=document.getElementById('passlist'), ce=document.getElementById('passcnt');
  if(!le) return;
  const all=getAllPassives();
  // Drop stale active-passive ids that no longer resolve (legacy hard-coded ids → JSON ids)
  if(all.length && S.build?.activePassives?.length){
    const valid=new Set(all.map(p=>p.id));
    const kept=S.build.activePassives.filter(a=>valid.has(a.id));
    if(kept.length!==S.build.activePassives.length){ S.build.activePassives=kept; save(); }
  }
  const active=getActivePassives(); if(ce) ce.textContent=active.length;
  if(!all.length){le.innerHTML='<div style="font-size:10px;color:var(--dim)">Choisis ta classe dans Build.</div>';return;}
  const clsP=all.filter(p=>!p.isGeneral), genP=all.filter(p=>p.isGeneral);
  const card=p=>{
    const on=active.some(a=>a.id===p.id);
    return `<div class="pc ${on?'on':''}" data-pid="${p.id}">
      <div style="flex:1;min-width:0">
        <div class="pn">${p.name}</div>
        ${p.desc?`<div style="font-size:11px;color:#9099bb;line-height:1.4;margin-top:2px">${p.desc}</div>`:''}
      </div>
      <span style="color:${on?'var(--gold)':'var(--dim)'};font-size:14px;flex-shrink:0">${on?'✓':'+'}</span>
    </div>`;
  };
  const divider=genP.length?'<div class="elhdr" style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:6px 0 3px;border-top:1px solid var(--border);margin-top:4px">Passifs généraux</div>':'';
  le.innerHTML=clsP.map(card).join('')+divider+genP.map(card).join('');
  le.querySelectorAll('.pc[data-pid]').forEach(el=>el.addEventListener('click',()=>togglePassive(el.dataset.pid)));
  // Effects
  const es=document.getElementById('passeffsec'), ef=document.getElementById('passefflist');
  const sbAll={};
  const _plv=S.build?.level||200;
  active.forEach(ap=>{ const def=getAllPassives().find(p=>p.id===ap.id);
    Object.entries(def?.effects?.sb||{}).forEach(([k,v])=>sbAll[k]=(sbAll[k]||0)+v);
    Object.entries(def?.effects?.sbl||{}).forEach(([k,v])=>sbAll[k]=(sbAll[k]||0)+Math.round(v*_plv));
  });
  const ok=getOnKillRes();
  const hasEff=Object.keys(sbAll).length||ok.ap;
  if(es) es.style.display=hasEff?'':'none';
  if(ef&&hasEff){
    const LBL={ap:'PA',degatsInfliges:'% DI',soinsRealises:'% Soins',maitriseFeu:'Maît. Feu',maitriseEau:'Maît. Eau',maitriseTerre:'Maît. Terre',maitriseAir:'Maît. Air',esquive:'Esquive',tacle:'Tacle',initiative:'Initiative',volonte:'Volonté',hpPct:'% PV'};
    const lines=Object.entries(sbAll).map(([k,v])=>`<span style="color:${v>0?'var(--green)':'var(--red)'}">${v>0?'+':''}${v}</span> ${LBL[k]||k}`);
    if(ok.ap||ok.mp||ok.wp) lines.push(`<span style="color:var(--gold)">+${ok.ap}PA +${ok.mp}PM +${ok.wp}PW${ok.hp?` +${ok.hp}% PV`:''}</span> sur kill`);
    ef.innerHTML=lines.map(l=>`<div style="font-size:11px;padding:2px 0;border-bottom:1px solid var(--border)">${l}</div>`).join('');
  }
}

// ── PERSO TAB ────────────────────────────────────────────────────
const STATDEFS=[
  ['Combat',     [['ap','PA'],['mp','PM'],['wp','PW'],['hp','PV'],['initiative','Initiative'],['critChance','% CC'],['critMastery','Maît. Critique']]],
  ['Maîtrises',  [['maitriseFeu','+ Feu'],['maitriseEau','+ Eau'],['maitriseTerre','+ Terre'],['maitriseAir','+ Air'],['maitriseDos','Maît. Dos'],['maitriseMelee','Maît. Mêlée'],['maitriseDistance','Maît. Distance'],['maitriseBerserk','Maît. Berserk'],['maitriseSoin','Maît. Soin']]],
  ['Résistances',[['resElem','Rés. Élémentaire'],['resFeu','+ Feu'],['resEau','+ Eau'],['resTerre','+ Terre'],['resAir','+ Air'],['resCrit','Rés. Critique'],['resDos','Rés. Dos']]],
  ['Secondaires',[['degatsInfliges','% DI'],['dmgIndirect','% Dom. Indirects'],['soinsRealises','% Soins'],['tacle','Tacle'],['esquive','Esquive'],['portee','Portée'],['controle','Contrôle'],['sagesse','Sagesse'],['prospection','Prospection']]],
];
function renderPerso(){
  // Bonus rows
  document.querySelectorAll('.brow').forEach(row=>{
    const k=row.dataset.bk;
    row.classList.toggle('on',!!S.bonuses[k]);
    // Attach once
    if(!row.dataset.bound){
      row.dataset.bound='1';
      row.addEventListener('click',()=>{S.bonuses[k]=!S.bonuses[k];save();renderPerso();renderAdvisor();});
    }
  });
  const con=document.getElementById('perstats');
  if(!con) return;
  if(!S.build){
    con.innerHTML='<div style="font-size:13px;color:var(--dim)">Choisis ta classe dans l’onglet <b>Build</b>, puis saisis tes stats ici — ou importe un build Wakfuli/Zénith.</div>';
    return;
  }
  if(!S.build.stats) S.build.stats={};
  const base=S.build.stats, eff=getEffStats();
  const groups=[];
  for(const [grp,defs] of STATDEFS){
    const rows=defs.map(([key,lbl])=>{
      const bv=base[key]??'';
      const ev=eff[key]||0;
      const showEff=(Number(bv||0)!==ev)&&ev!==0;
      return `<div class="strow">
        <span class="stk">${lbl}</span>
        <input class="stovr stbase" data-k="${key}" type="number" inputmode="numeric" placeholder="0" value="${bv}"/>
        <span class="stv" style="color:var(--dim);width:56px">${showEff?ev.toLocaleString('fr'):''}</span>
      </div>`;
    }).join('');
    groups.push(`<div style="margin-bottom:10px"><div class="sh" style="font-size:11px">${grp}</div>${rows}</div>`);
  }
  let html='<div id="perstats-cols"><div style="font-size:11px;color:var(--muted);margin-bottom:8px;grid-column:1/-1">Saisie manuelle — valeurs de base. <span style="color:var(--dim)">Gris = effectif (avec bonus/passifs).</span></div>'+groups.join('')+'</div>';
  con.innerHTML=html;
  con.querySelectorAll('.stbase').forEach(inp=>{
    // 'input' (live) → save + refresh effective column only, no full re-render (préserve le focus Tab)
    inp.addEventListener('input',()=>{
      const v=inp.value.trim(), k=inp.dataset.k;
      if(v==='') delete S.build.stats[k]; else S.build.stats[k]=Number(v);
      save();
      // mise à jour des spans « effectif » sans toucher au DOM des inputs
      const eff=getEffStats();
      con.querySelectorAll('.stbase').forEach(i2=>{
        const k2=i2.dataset.k, bv2=S.build.stats[k2]??'', ev2=eff[k2]||0;
        const sp=i2.nextElementSibling;
        if(sp) sp.textContent=(Number(bv2||0)!==ev2&&ev2!==0)?ev2.toLocaleString('fr'):'';
      });
      renderAdvisor();
    });
  });
}

// ── BUILD / CLASS ────────────────────────────────────────────────
function applyClass(){
  const cls=document.getElementById('clssel').value;
  const lvl=parseInt(document.getElementById('lvlinp').value)||200;
  if(!cls) return;
  if(!S.build) S.build={class:cls,level:lvl,stats:{},spells:[],activePassives:[]};
  else { S.build.class=cls; S.build.level=lvl; }
  save(); syncCls(); renderAll();
}
function syncCls(){
  const s=document.getElementById('clssel'), l=document.getElementById('lvlinp');
  if(s&&S.build?.class) s.value=S.build.class;
  if(l&&S.build?.level) l.value=S.build.level;
}
document.getElementById('applycls').addEventListener('click',applyClass);
document.getElementById('lvlinp').addEventListener('keydown',e=>{if(e.key==='Enter') applyClass();});
// Import d'un build : accepte un objet déjà parsé ou une chaîne JSON.
// Renvoie true si importé. Affiche un résumé de ce qui a été reconnu.
function importBuildJSON(input, silentIfInvalid){
  const status=document.getElementById('imptstatus');
  let raw;
  try{ raw=(typeof input==='string')?JSON.parse(input):input; }
  catch(e){ if(!silentIfInvalid) status.innerHTML=`<span style="color:var(--red)">❌ JSON invalide : ${e.message}</span>`; return false; }
  if(!raw||typeof raw!=='object'){ if(!silentIfInvalid) status.innerHTML=`<span style="color:var(--red)">❌ Format non reconnu</span>`; return false; }
  const cls=(raw.character?.class||'').toLowerCase();
  const lvl=parseInt(raw.character?.level)||200;
  const stats=raw.stats||{}, spells=Array.isArray(raw.spells)?raw.spells:[];
  const nStats=Object.keys(stats).length, nSpells=spells.length;
  const nPass=Array.isArray(raw.passives)?raw.passives.length:0;
  S.build={class:cls,level:lvl,name:raw.character?.name||'',stats,spells,
    activePassives:S.build?.activePassives||[]};
  save(); syncCls(); renderAll();
  const src=raw.source?` · ${raw.source}`:'';
  const detail=`${nSpells} sorts, ${nStats} stats${nPass?`, ${nPass} passifs`:''}`;
  if(cls) status.innerHTML=`<span style="color:var(--green)">✅ ${cls} niv.${lvl}${src} — ${detail}</span>`;
  else    status.innerHTML=`<span style="color:var(--gold)">⚠ Build importé (${detail}) — classe non détectée, choisis-la ci-dessus</span>`;
  return true;
}
document.getElementById('imptbtn').addEventListener('click',()=>{
  const val=document.getElementById('impta').value.trim();
  if(!val){ document.getElementById('imptstatus').innerHTML=`<span style="color:var(--dim)">Colle d'abord le JSON du build.</span>`; return; }
  importBuildJSON(val,false);
});
// Auto-import au collage : si le presse-papier contient un build JSON valide,
// on importe sans clic. Silencieux si ce n'est pas (encore) du JSON exploitable.
function tryAutoImportBuild(){
  const val=document.getElementById('impta').value.trim(); if(!val) return;
  let raw; try{ raw=JSON.parse(val); }catch(e){ return; }
  if(!raw||typeof raw!=='object'||(!raw.character&&!raw.stats&&!raw.spells)) return;
  importBuildJSON(raw,true);
}
document.getElementById('impta').addEventListener('paste',()=>setTimeout(tryAutoImportBuild,0));
document.getElementById('pnsave').addEventListener('click',()=>{
  S.playerName=document.getElementById('pninp').value.trim()||null;
  save(); renderNameBanner();
});
function renderNameBanner(){
  const name=S.playerName||S.detectedName, b=document.getElementById('namedbanner');
  if(!b) return;
  if(name){b.style.display='';b.textContent=S.playerName?`Personnage : ${name}`:`Détecté : ${name}`;}
  else b.style.display='none';
}

// ── LOG PARSER ───────────────────────────────────────────────────
let logHandle=null, logSize=0, logTimer=null;
const FEED_MAX=200; let feedLines=[];
const RE_LOG  = /\[Information \(combat\)\]\s*(.*)/;
const RE_SPELL= /^(.+?) lance le sort (.+?)(\s*\(Critiques?\))?\s*$/i;
const RE_DMG  = /^(.+?):\s*-([\d\s\u202f\u00a0]+)\s*PV\s+\((\w+)\)/;
const RE_HEAL = /^(.+?):\s*\+([\d\s\u202f\u00a0]+)\s*PV\s+\((\w+)\)/;
const RE_DEATH= /^(.+?) est hors-combat\s*!/;
const RE_STATE= /^(.+?):\s*(.+?)\s*\(\+?(\d+)\s*Niv\.?\)/i;
const RE_RES  = /^(.+?):\s*(\d+)\s*(PA|PM|PW)\s*\(([^)]+)\)\s*$/i;
const RE_END  = /^Combat termin/i;
function cleanN(s){return parseInt(String(s).replace(/[\s\u202f\u00a0]+/g,''),10)||0;}
// Snapshot d'état de combat (PV cibles, mécanique joueur, focus) pour restauration au clic.
function snapCombat(){
  return {
    t:S.targets.map(t=>({uid:t.uid,cur:t._currentHp,dead:!!t.dead})),
    p:JSON.parse(JSON.stringify(S.combat?.mechanics?.['__p']||{})),
    fi:S.focusIdx
  };
}
function restoreCombat(snap){
  if(!snap) return;
  (snap.t||[]).forEach(s=>{ const t=S.targets.find(x=>x.uid===s.uid); if(t){ t._currentHp=s.cur; t.dead=s.dead; } });
  if(!S.combat) S.combat={mechanics:{}};
  S.combat.mechanics['__p']=JSON.parse(JSON.stringify(snap.p||{}));
  if(typeof snap.fi==='number') S.focusIdx=Math.min(snap.fi,Math.max(0,S.targets.length-1));
  ensureFocusAlive(); save();
  renderMonPanel(); renderHPBars(); renderAdvisor();
}
function addFeed(type,text){ feedLines.push({type,text,snap:snapCombat()}); if(feedLines.length>FEED_MAX) feedLines.shift(); renderFeed(); }
function renderFeed(){
  const el=document.getElementById('feed'); if(!el) return;
  el.innerHTML=feedLines.map((l,i)=>`<div class="fl ${l.type}" data-fi="${i}">${l.text}</div>`).reverse().join('');
  el.querySelectorAll('.fl[data-fi]').forEach(d=>d.addEventListener('click',()=>{
    const i=parseInt(d.dataset.fi), ln=feedLines[i]; if(!ln||!ln.snap) return;
    restoreCombat(ln.snap);
    el.querySelectorAll('.fl').forEach(x=>x.classList.remove('active')); d.classList.add('active');
  }));
}
function processLine(raw){
  const raw2=raw.trim(); if(!raw2) return;
  const cm=raw2.match(RE_LOG); if(!cm) return;
  const content=cm[1].trim(); if(!content) return;
  if(RE_END.test(content)){const pm=pmObj();pm.hp=null;pm.gAP=0;pm.gMP=0;pm.gWP=0;addFeed('sy','── Combat terminé ──');renderAdvisor();return;}
  let m;
  // Spell
  m=content.match(RE_SPELL);
  if(m){
    const actor=m[1].trim(),spell=m[2].trim(),isCrit=!!m[3];
    S.combat.lastActor=actor; S.combat.lastCrit=isCrit;
    // Auto-detect player: match actor who uses a spell in the deck
    const pN=S.playerName||S.detectedName;
    if(!pN){
      if(getDeck().some(s=>s.name===spell)){S.detectedName=actor;renderNameBanner();}
    }
    // Auto-detect monster: track damage targets vs player
    // Suivi de la jauge de ressource (générique) : on incrémente selon la mécanique
    // de classe à chaque sort lancé par le joueur. Les lignes d'état explicites du
    // log (onState) restent prioritaires et corrigent cette estimation.
    const p2=S.playerName||S.detectedName, mech=getMech();
    if(p2&&actor===p2&&mech?.res){
      const dk=getDeck().find(s=>s.name===spell);
      if(dk){
        const id=mech.res.id;
        const pm=pmObj();
        pm[id]=resNext(pm[id]||0,dk,{lethal:false,assassin:assassinActive(),suppressGen:abApplies(dk)});
        renderAdvisor();
      }
    }
    addFeed('sp',`${actor} → ${spell}${isCrit?' ★CC':''}`); return;
  }
  // Damage
  m=content.match(RE_DMG);
  if(m){
    const target=m[1].trim(),amount=cleanN(m[2]),el=m[3];
    // Source indirecte éventuelle en fin de ligne : « ... (Feu) (Hémorragie) »
    const srcM=content.match(/\)\s*\(([^)]+)\)\s*$/);
    const src=srcM?srcM[1].trim():'';
    const isHemo=/h[ée]morragie/i.test(src);
    const isIndirect=!!src; // DoT/piège : pas un coup direct du joueur
    const pN=S.playerName||S.detectedName;
    // Player takes damage → track HP
    if(pN&&target===pN){
      const pm=pmObj(), mx=playerMaxHp();
      if(pm.hp==null) pm.hp=mx||0;
      pm.hp=Math.max(0,(pm.hp||0)-amount);
      renderAdvisor();
    }
    else {
      const t=findTargetByName(target);
      if(t){ // cible déjà suivie → on décrémente ses PV
        const mx=t._maxHp||t.hp||0;
        if(mx>0){ t._currentHp=Math.max(0,(t._currentHp??mx)-amount); if(t._currentHp<=0) t.dead=true; }
        ensureFocusAlive(); save(); renderMonPanel(); renderAdvisor();
      } else if(pN&&S.combat.lastActor===pN&&target!==pN&&!isIndirect){
        // nouvelle cible touchée DIRECTEMENT par le joueur → ajout auto
        // (les ticks Hémorragie/pièges n'ajoutent pas de cible)
        const found=MONS.find(mo=>(mo.n||mo.name||'').toLowerCase()===target.toLowerCase());
        if(found) addTarget({id:found.id,name:found.n||found.name,level:found.lv||found.level||0,
          hp:found.hp||0,rf:found.rf||0,re:found.re||0,rt:found.rt||0,ra:found.ra||0});
      }
    }
    addFeed(isHemo?'hm':'dm',`-${amount} PV (${el}) → ${target}${src?` · ${src}`:''}`); return;
  }
  // Heal
  m=content.match(RE_HEAL);
  if(m){
    const tgt=m[1].trim(), amt=cleanN(m[2]); const pN=S.playerName||S.detectedName;
    if(pN&&tgt===pN){ const pm=pmObj(), mx=playerMaxHp(); if(pm.hp==null) pm.hp=mx||amt; pm.hp=Math.min(mx||(pm.hp+amt),(pm.hp||0)+amt); renderAdvisor(); }
    addFeed('hl',`+${amt} PV → ${tgt}`); return;
  }
  // Resource gain (effect-sourced, e.g. "1 PA (Assassin)")
  m=content.match(RE_RES);
  if(m){
    const actor=m[1].trim(), amt=parseInt(m[2]), typ=m[3].toUpperCase(), src=m[4].trim();
    const pN=S.playerName||S.detectedName;
    if(pN&&actor===pN){
      const pm=pmObj();
      if(typ==='PA') pm.gAP=(pm.gAP||0)+amt; else if(typ==='PM') pm.gMP=(pm.gMP||0)+amt; else pm.gWP=(pm.gWP||0)+amt;
      renderAdvisor();
    }
    addFeed('st',`+${amt} ${typ} (${src}) → ${actor}`); return;
  }
  // Death
  m=content.match(RE_DEATH);
  if(m){
    const who=m[1].trim(), t=findTargetByName(who);
    if(t){ t.dead=true; t._currentHp=0; ensureFocusAlive(); save(); renderMonPanel(); renderAdvisor(); }
    addFeed('dt',`💀 ${who}`); return;
  }
  // State
  m=content.match(RE_STATE);
  if(m){
    const actor=m[1].trim(),sname=m[2].trim(),lvl=parseInt(m[3]);
    if(/^\d+\s*(PA|PM|PW|Esquive|Tacle)/.test(sname)) return;
    // Hémorragie sur une cible suivie : le log reporte le niveau cumulé.
    if(/h[ée]morragie/i.test(sname)){
      const tg=findTargetByName(actor);
      if(tg){ tg._hemo=lvl; save(); renderMonPanel(); renderHPBars(); renderAdvisor(); }
      addFeed('st',`${actor} ✦ Hémorragie ${lvl}`); return;
    }
    const mech=getMech(), pN=S.playerName||S.detectedName;
    const isCS=mech&&/point\s*faible|combativit|stase|veine|charge|ivresse/i.test(sname);
    if(pN&&actor===pN){
      if(!S.combat.mechanics['__p']) S.combat.mechanics['__p']={};
      mech?.onState(actor,sname,lvl,S.combat.mechanics['__p']); renderAdvisor();
    } else if(isCS&&!pN){
      S.detectedName=actor;
      if(!S.combat.mechanics['__p']) S.combat.mechanics['__p']={};
      mech?.onState(actor,sname,lvl,S.combat.mechanics['__p']); renderNameBanner(); renderAdvisor();
    }
    addFeed('st',`${actor} ✦ ${sname} ${lvl}`); return;
  }
}
async function poll(){
  if(!logHandle) return;
  try{const f=await logHandle.getFile();if(f.size<=logSize)return;const t=await f.slice(logSize).text();logSize=f.size;t.split('\n').forEach(processLine);}catch(e){}
}
function setConn(n){document.getElementById('led').classList.add('on');document.getElementById('clbl').textContent='🟢 '+n;document.getElementById('discbtn').style.display='';renderAdvisor();}
function setDisconn(){document.getElementById('led').classList.remove('on');document.getElementById('clbl').textContent='Aucun log';document.getElementById('discbtn').style.display='none';logHandle=null;logSize=0;if(logTimer)clearInterval(logTimer);renderAdvisor();}
async function attachFile(f,fromStart){
  if(!f) return;
  logHandle={name:f.name,getFile:()=>Promise.resolve(f)};
  logSize=fromStart?0:f.size;
  if(fromStart||logSize===0){logSize=0;await poll();}
  if(logTimer) clearInterval(logTimer);
  logTimer=setInterval(poll,500); setConn(f.name);
}
document.getElementById('lfi').addEventListener('change',async function(){const f=this.files[0];if(!f)return;await attachFile(f,document.getElementById('fromstart').checked);this.value='';});
const dz=document.getElementById('dz');
dz.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();dz.classList.add('ov');});
dz.addEventListener('dragleave',e=>{e.stopPropagation();dz.classList.remove('ov');});
dz.addEventListener('drop',async e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('ov');const f=e.dataTransfer.files[0];if(f)await attachFile(f,document.getElementById('fromstart').checked);});
document.getElementById('discbtn').addEventListener('click',setDisconn);
document.getElementById('clrfeed').addEventListener('click',()=>{feedLines=[];renderFeed();});
const dov=document.getElementById('dov');let dc=0;
document.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types.includes('Files'))return;dc++;dov.classList.add('on');});
document.addEventListener('dragleave',()=>{dc=Math.max(0,dc-1);if(!dc)dov.classList.remove('on');});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',async e=>{e.preventDefault();dc=0;dov.classList.remove('on');if(e.target.closest('#dz'))return;const fi=Array.from(e.dataTransfer?.items||[]).find(i=>i.kind==='file');if(fi)await attachFile(fi.getAsFile(),document.getElementById('fromstart').checked);});

// ── TABS ─────────────────────────────────────────────────────────
document.querySelectorAll('.lt').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.lt').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.lp').forEach(p=>p.classList.toggle('on',p.id==='lp-'+b.dataset.lp));
}));
document.querySelectorAll('.ctt').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.ctt').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.cp').forEach(p=>p.classList.toggle('on',p.id==='cp-'+b.dataset.cp));
}));
function setPosition(pos){
  document.querySelectorAll('[data-pos]').forEach(x=>x.classList.toggle('on',x.dataset.pos===pos));
  S.position=pos; save(); renderAdvisor();
}
function toggleCrit(){
  S.critMode=!S.critMode;
  document.getElementById('crit-btn').classList.toggle('on',S.critMode); renderAdvisor();
}
document.querySelectorAll('[data-pos]').forEach(b=>b.addEventListener('click',()=>setPosition(b.dataset.pos)));
document.getElementById('crit-btn').addEventListener('click',toggleCrit);
function openLeftTab(lp){ const b=document.querySelector(`.lt[data-lp="${lp}"]`); if(b) b.click(); }
function openCenterTab(cp){ const b=document.querySelector(`.ctt[data-cp="${cp}"]`); if(b) b.click(); }
// ── RACCOURCIS CLAVIER COMBAT (ignorés dans les champs de saisie) ──
function setupShortcuts(){
  document.addEventListener('keydown',e=>{
    if(e.key==='Control') return; // géré par le tooltip
    const t=e.target,tag=(t&&t.tagName)||'';
    if(/INPUT|TEXTAREA|SELECT/.test(tag)||t?.isContentEditable) return;
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(e.key==='1'){ setPosition('normal'); e.preventDefault(); }
    else if(e.key==='2'){ setPosition('side'); e.preventDefault(); }
    else if(e.key==='3'){ setPosition('back'); e.preventDefault(); }
    else if(e.key==='c'||e.key==='C'){ toggleCrit(); e.preventDefault(); }
  });
}

// ── RESIZE ───────────────────────────────────────────────────────
(function(){
  function mk(id,side){
    const h=document.getElementById(id); if(!h) return;
    let sx,sv;
    h.addEventListener('mousedown',e=>{
      e.preventDefault(); h.classList.add('drag'); sx=e.clientX;
      const cols=getComputedStyle(document.getElementById('app')).gridTemplateColumns.split(' ');
      sv=side==='left'?parseInt(cols[0]):parseInt(cols[4]);
      const mv=e=>{const v=Math.max(180,Math.min(600,side==='left'?sv+e.clientX-sx:sv-(e.clientX-sx)));document.documentElement.style.setProperty(side==='left'?'--cl':'--cr',v+'px');};
      const up=()=>{h.classList.remove('drag');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
  }
  mk('rl','left'); mk('rr','right');
})();

// ── RENDER ALL ───────────────────────────────────────────────────
function renderAll(){ renderPerso();renderAdvisor();renderMonPanel();renderSpellsTab();renderPassivesTab();renderNameBanner(); }

// ── TAILLE TEXTE GLOBALE (slider) ────────────────────────────────
function applyZoom(){ document.documentElement.style.setProperty('--zoom', S.zoom||1); }
function setupFontSlider(){
  const sl=document.getElementById('fontslider'); if(!sl) return;
  sl.value=S.zoom||1;
  sl.addEventListener('input',()=>{ S.zoom=parseFloat(sl.value)||1; applyZoom(); save(); });
}

// ── TOOLTIP DESCRIPTION SORTS (Ctrl + survol) ────────────────────
let _ctrlDown=false;
const _spTip=(()=>{ const d=document.createElement('div'); d.id='sptip'; document.body.appendChild(d); return d; })();
function showSpTip(txt,x,y){
  if(!txt){ hideSpTip(); return; }
  _spTip.textContent=txt; _spTip.classList.add('on');
  const w=_spTip.offsetWidth,h=_spTip.offsetHeight;
  let nx=x+14,ny=y+18;
  if(nx+w>window.innerWidth-8) nx=x-w-14;
  if(ny+h>window.innerHeight-8) ny=y-h-18;
  _spTip.style.left=Math.max(8,nx)+'px'; _spTip.style.top=Math.max(8,ny)+'px';
}
function hideSpTip(){ _spTip.classList.remove('on'); }
function bindSpTip(el,desc){
  if(!desc) return; el._desc=desc;
  el.addEventListener('mousemove',e=>{ if(_ctrlDown) showSpTip(el._desc,e.clientX,e.clientY); else hideSpTip(); });
  el.addEventListener('mouseleave',hideSpTip);
}
document.addEventListener('keydown',e=>{ if(e.key==='Control') _ctrlDown=true; });
document.addEventListener('keyup',e=>{ if(e.key==='Control'){ _ctrlDown=false; hideSpTip(); } });
window.addEventListener('blur',()=>{ _ctrlDown=false; hideSpTip(); });

// ── AIDE / LÉGENDE DES INTERACTIONS ──────────────────────────────
function setupHelp(){
  if(document.getElementById('helpbtn')) return;
  const btn=document.createElement('button');
  btn.id='helpbtn'; btn.className='pb'; btn.title='Aide & raccourcis'; btn.textContent='❔';
  btn.style.cssText='border-radius:var(--r);margin-left:6px';
  const panel=document.createElement('div'); panel.id='helppanel';
  panel.innerHTML=`
    <div class="hph">Interactions</div>
    <div class="hpr">🖱 <b>Clic</b> sur un sort du classement → l'ajoute à la séquence</div>
    <div class="hpr">🖱 <b>Clic</b> sur un événement du log → restaure l'état à cet instant</div>
    <div class="hpr">⌨ <b>Ctrl + survol</b> d'un sort → affiche sa description</div>
    <div class="hpr">📂 <b>Glisse</b> ton fichier log dans la fenêtre pour le connecter</div>
    <div class="hph" style="margin-top:8px">Raccourcis clavier</div>
    <div class="hpr"><b>1 / 2 / 3</b> → Face / Côté / Dos</div>
    <div class="hpr"><b>C</b> → bascule Coup Critique</div>`;
  document.body.appendChild(panel);
  const place=()=>{ const r=btn.getBoundingClientRect(); panel.style.top=(r.bottom+6)+'px'; panel.style.right=Math.max(8,window.innerWidth-r.right)+'px'; };
  btn.addEventListener('click',e=>{ e.stopPropagation(); if(panel.classList.toggle('on')) place(); });
  document.addEventListener('click',e=>{ if(!panel.contains(e.target)&&e.target!==btn) panel.classList.remove('on'); });
  (document.getElementById('hdc')||document.getElementById('hd')).appendChild(btn);
}
// ── CHEMIN DU LOG (détection OS) ─────────────────────────────────
function detectOS(){
  const p=(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent||'').toLowerCase();
  if(/win/.test(p)) return 'win';
  if(/mac|iphone|ipad/.test(p)) return 'mac';
  if(/linux|x11|android/.test(p)) return 'linux';
  return 'win';
}
function populateLogPath(){
  const el=document.getElementById('logpath'); if(!el) return;
  const os=detectOS();
  const paths={
    win:  ['Windows', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Wakfu\\preferences\\logs\\'],
    mac:  ['macOS',   '~/Library/Application Support/Steam/steamapps/common/Wakfu/preferences/logs/'],
    linux:['Linux',   '~/.local/share/Steam/steamapps/common/Wakfu/preferences/logs/'],
  };
  const order=[os,...Object.keys(paths).filter(k=>k!==os)];
  el.innerHTML=order.map(k=>{
    const [name,path]=paths[k], hot=(k===os);
    return `<div style="${hot?'color:var(--gold);font-weight:600':'color:var(--dim)'};margin-bottom:3px">${hot?'▸ ':''}<b>${name}</b> : ${path}</div>`;
  }).join('');
}

// ── INIT ─────────────────────────────────────────────────────────
loadData(); load();
applyZoom(); setupFontSlider();
setupShortcuts(); setupHelp(); populateLogPath();
syncCls(); renderAll(); initCSQ();
if(S.playerName) document.getElementById('pninp').value=S.playerName;
