# Limites de modélisation par classe

Ce document récapitule, pour chacune des **18 classes**, ce qui est modélisé et ce
qui ne l'est pas dans le Wakfu Combat Advisor.

**Règle générale :** l'outil optimise les **sorts directs** du personnage (ranking
dégâts/PA, séquence optimale). Ce qui n'est ni dans les données chiffrées, ni un
dégât direct (invocations, poisons, effets trop conditionnels) est **signalé en
conseil** plutôt qu'inventé. Les valeurs modélisées viennent des descriptions de
sorts/passifs scrapées de l'encyclopédie, sauf indication contraire.

> 🔧 = valeur à calibrer/confirmer en jeu, isolée dans `mechanics.js`.

---

## Vue d'ensemble par type de levier

| Type de levier | Classes |
|---|---|
| **Jauge → dégâts** | Sram (Point Faible), Iop (Concentration), Huppermage (BQ), Steamer (Stasis) |
| **Modes / toggles** | Crâ (Tir précis), Eliotrope (Serein/Exalté/Portail/Don), Osamodas (Draconique), Pandawa (Tonneau), Enutrof (Trésors), Xélor (Taque/Tique) |
| **Conditions auto (PV/cible)** | Sacrieur (Berserk), Eniripsa (Anatomie/Torpeur), Ouginak (PV/Bastonné/contact) |
| **Compteurs** | Ecaflip (Dé six), Roublard (Pulsar), Sadida (Engrainé), Steamer (Pilonnage) |
| **Passifs offensifs chiffrés** | Féca, Zobal (+ contributions Osamodas, Pandawa) |

---

## Détail par classe

### Sram — *la référence*
- **Modélisé :** Point Faible (génération/consommation/finisseurs), Hémorragie. **Calibré en jeu** (mesures sur mannequin).
- **Refonte 1.92 :** 🔧 max PF **100 → 200** et ratio dégâts/PF **halvé** (+0,5 %/PF : 100 PF = +50 %, 200 PF = ×2.0 — `SRAM_PF_PER`, recalé sur l'exemple du patch, à reconfirmer in-game). Châtiment (130/163) et Attaque mortelle (164/230) **baissés** ; les autres sorts élémentaires **+10 %** (valeurs niv 245 estimées). Paliers de récompense (PA/PM/PW + Hémo) tous les 50 PF, gains kill/isolé 25→50 (génération de jauge non simulée). Hémorragie ne traverse plus la Parade (calibrage Hémo inchangé côté outil).

### Iop
- **Modélisé :** Concentration (0→100), bonus Égaré chiffré sur Fulgur/Colère à 100.
- **Limites :** 🔧 le **×1.10 de Dommages infligés à 100 de Concentration** n'est pas calibré (valeur communément documentée — `IOP_FULL_DMG_MULT`).

### Crâ
- **Modélisé :** Tir précis (dégâts améliorés chiffrés par sort, consommation de Précision).
- **Limites :** le bonus % Dommages infligés de la **Pointe affûtée** (Affûtage) n'est pas chiffré dans les données → conseil seulement.

### Sacrieur
- **Modélisé :** dégâts conditionnels (Aversion stabilisé, Fracasse vs Armure) ; **Berserk** selon les PV manquants.
- **Limites :** 🔧 le **% de Berserk est une ESTIMATION non calibrée** (rampe ×1 au-dessus de 90 % PV → ×1.25 à 20 % PV — `BERSERK_MAX`, `BERSERK_HP_START`, `BERSERK_HP_FLOOR`). Sans log connecté (PV inconnus) → aucun bonus.

### Ecaflip
- **Modélisé :** Dé six (coût décroissant via compteur, base 6 PA → min 1 PA).
- **Limites :** pas de jauge de dégât — la **Veine donne soins/résistances**, pas un multiplicateur de dégâts. Les sorts à **hasard** (Pile/Face, Tout ou rien, Bataille…) ne sont pas modélisés probabilistiquement.
- **Patch 1.92 :** ajustements de coût/portée appliqués (Lacérations 3 PA, Roulette à dés 4 PA, Trois cartes 5 PA + 1 PW, Craps portée 2-7, Pupuce 0-3) ; Dé du chateux rend désormais **2 PA instantanément** sur kill. 🔧 5 sorts ajoutés sans chiffres de dégâts complets (**Bond du félin, Quitte ou double, Trèfle/Guigne, Félintuition, Coup du sort**) — coût/élément/dégâts à compléter via scraping encyclopédie (le patch ne les fournit pas).

### Eliotrope
- **Modélisé :** modes Serein/Exalté, bonus Portail, Don céleste (+40 % DI).
- **Limites :** le **Don céleste est fixé à +40 %** (valeur de base) ; les variantes de passif (Traquenard +60 % de dos, Quiétude qui le remplace par des PA…) ne sont pas modélisées.

### Eniripsa
- **Modélisé :** dégâts conditionnels sur les PV (auto) — Anatomie (cible ≥ 80 % PV), Torpeur (Eniripsa ≥ 80 % PV).
- **Limites :** classe surtout **support** ; ses **Marques** et le **Propagateur** (soin/contrôle) ne sont pas chiffrés côté dégâts.

### Enutrof
- **Modélisé :** Trésors (toggle → Epuration 212 → 266) ; **Fauché** (toggle → +20 % DI sur cible endettée, 1.92).
- **Limites :** le bonus de dégâts offensif de la **forme Phorzerker** (« Bestialité ») n'est pas chiffré → conseil. Trésors sert aussi à booster Taxe/Pelle mêlée mais pour des **effets PA/PM** (non-dégâts). Les **Gisements** (portée d'apparition 3 en 1.92) et leur placement ne sont pas simulés.

### Féca
- **Modélisé :** passifs offensifs **permanents** chiffrés (La meilleure défense +10 %, Qui veut la paix +25 %, Protecteur du troupeau −20 % +300 % PV).
- **Limites :** passifs **conditionnels** (Carapace d'épines selon l'Armure, Œil pour œil quand l'Armure tombe) → conseil seulement. Les **Glyphes** (dégâts indirects de zone) ne comptent pas comme dégât du sort.

### Huppermage
- **Modélisé :** jauge de **BQ** (Rayon crépusculaire +0,5 %/% BQ, ×1,50 à 100). Démarre à BQ 100 par défaut.
- **Limites :** les bonus de **Runes** (Disque luminescent +10 % de dos à 3 runes, Universalité +15 % DI en fin de tour…) sont trop conditionnels → conseil.

### Osamodas
- **Modélisé :** Forme draconique (+25 % DI + dégâts draconiques), Corbeau hors LdV, passifs offensifs (Guerrier invocateur +20 %, Synergie animale −20 %).
- **Limites :** **le gros des dégâts vient des invocations** (familiers), non simulées.

### Ouginak
- **Modélisé :** dégâts conditionnels — Plombage (auto, ≥ 80 % PV), Bastonnade (cible Bastonné, ×3), Balayage (contact).
- **Limites :** la **Rage / l'Ougigarou** (mode loup-garou, identité de la classe) n'ont pas de bonus de dégâts de base chiffré dans les données → conseil.

### Pandawa
- **Modélisé :** Tonneau porté (dégâts modifiés + 10 % DI), passifs offensifs (Cyanose +15 %, Cocktail −10 %).
- **Limites :** l'**Imbibé** sert surtout au soin/résistances (non-dégâts). Le cycle d'**ivresse** (Ivre/Gueule de Bois/Sobre) donne des PA/PM/PW, pas de dégâts.

### Roublard *(clé `rogue`)*
- **Modélisé :** Pulsar chargeable (compteur, +91/charge).
- **Limites :** **l'essentiel des dégâts vient des bombes** (explosions différées, Murs de poudre, combos) — non simulé. Les modes Fourbe/Fuyard changent des effets mais pas les dégâts directs.

### Sadida
- **Modélisé :** Engrainé (compteur → Tremblement de Terre +30/niveau).
- **Limites :** **le cœur, ce sont les Poupées, Arbres et poisons** (via les Arbres) — non simulés.

### Steamer *(clé `foggernaut`)*
- **Modélisé :** jauge de **Stasis** (Choc +5 %/PS, max +50 %) ; **Pilonnage** (compteur, +27/répétition).
- **Limites :** les **Tourelles** (une partie des dégâts, + Sabordage) ne sont pas simulées. La **Surpression** donne surtout de l'utilitaire (portée, PA).

### Xélor
- **Modélisé :** passif **Taque/Tique** (toggle, ±20 % DI selon la parité du tour).
- **Limites :** classe de **contrôle** — son intérêt (retraits de PA, téléportations, Cadran, heure courante) n'est pas une question de dégâts/PA, donc non capturé. Aucun dégât conditionnel net (Perturbation 83 → 83).

### Zobal *(clé `masqueraider`)*
- **Modélisé :** passifs offensifs (Brute +25 %, Érosion −25 %) + toggle « Au contact » (+15 % DI). Coûts 1.92 : Détraquage **3 PA**, Dislocation **4 PA + 1 PW**.
- **Limites :** le **système de charges PW** des masques (Psycho/Pleutro/Classocharge, 1.92), les **collisions innées** (dégâts par PA, jusqu'à 2 cibles) et l'**Esprit masqué** (invocation, désormais inné) sont en conseil — non chiffrés. Le nouveau sort **Entrechoquement** et les sorts utilitaires (Voltige, Solidité, Aura de brutalité) ne sont pas dans le sous-ensemble scrapé. Affiché « **Zobal** » dans l'outil (clé interne `masqueraider`).

---

## Limites transversales

1. **Invocations non simulées** — Osamodas (familiers), Sadida (poupées/arbres), Roublard (bombes), Steamer (tourelles), Eniripsa (poupées). Quand le cœur de la classe repose sur des entités séparées, l'outil optimise les **tirs directs du personnage**.

2. **2 valeurs non calibrées en jeu** 🔧 — le **×1.10 du Iop** (Concentration max) et le **Berserk du Sacrieur**. Toutes deux isolées dans `mechanics.js` : une à deux lignes à ajuster si tu fais des mesures sur mannequin.

3. **Conditions / positionnement non suivis** — beaucoup de bonus dépendent de l'état réel (dos, contact, fin de tour, parité du tour, nombre exact de runes). Quand c'est **binaire**, c'est exposé en **toggle** ; sinon c'est en conseil.

4. **Dégâts indirects (poisons, glyphes, DoT)** — globalement non comptés comme dégâts du sort direct (sauf l'Hémorragie du Sram, calibrée).
