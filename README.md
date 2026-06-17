# ⚔ Wakfu Combat Advisor

Outil d'optimisation de combat pour le jeu **Wakfu**. Il parse le log de combat en temps réel, recommande des séquences de sorts optimales et suit l'état du combat tour par tour.

Fonctionne sans installation — un simple double-clic sur `index.html` suffit (Windows, Linux, macOS).

---

## Fonctionnalités

### Conseiller en temps réel
- **Ranking des sorts** par dégâts/PA, groupés par élément, mis à jour à chaque action du log
- **Séquence optimale** calculée par algorithme knapsack (programmation dynamique) sur les PA disponibles
- **Mode Max Kills** : plan de bataille multi-cibles
- **Séquence personnalisée** : construction manuelle en cliquant sur les sorts, avec décompte des ressources
- **Tooltip de description** : maintenir Ctrl et survoler un sort pour afficher sa description

### Suivi du combat
- **Parsing automatique du log** (polling toutes les 500 ms) : sorts, dégâts, soins, états, morts, ressources gagnées
- **Détection automatique du personnage** et des cibles touchées
- **Barres de PV** pour le joueur et chaque cible, mises à jour en direct
- **Restauration d'état** : cliquer sur n'importe quelle ligne du flux d'événements restaure l'état du combat à cet instant
- **Positions** Face / Côté / Dos et mode Coup Critique dans l'en-tête
- Jusqu'à **8 cibles simultanées** avec priorité réorderable

### Gestion du build
- **Import Wakfuli / Zénith** : coller le JSON extrait depuis la console du navigateur
- **Saisie manuelle** de toutes les statistiques (maîtrises, résistances, PA/PM/PW, PV…)

---

## Démarrage

1. Placer tous les fichiers dans le même dossier.
2. Ouvrir `index.html` dans un navigateur (Chrome ou Edge recommandés pour l'API File System Access).
3. Configurer le build dans l'onglet **BUILD** (classe, niveau, stats ou import).
4. Ajouter les sorts au deck dans l'onglet **Sorts & Passifs**.
5. Charger le log de combat via l'onglet **LOG**.

### Chemin du fichier log

| OS | Chemin |
|---|---|
| Windows | `C:\Program Files (x86)\Steam\steamapps\common\Wakfu\preferences\logs\` |
| Linux | `~/.local/share/Steam/steamapps/common/Wakfu/preferences/logs/` |

Cocher **"Lire depuis le début"** pour analyser un combat déjà terminé. Sinon, seules les nouvelles lignes sont lues.

---

## Import de build

### Depuis Wakfuli ou Zénith

1. Ouvrir son build sur [wakfuli.com](https://wakfuli.com) ou [zenithwakfu.com](https://zenithwakfu.com)
2. Pour Zénith : afficher le **panneau de caractéristiques** du personnage (le script lit les valeurs finales qui y sont affichées — équipement + aptitudes + base de classe + passifs)
3. Ouvrir la console du navigateur (F12)
4. Coller et exécuter le contenu de `extract-build-wakfuli.js` ou `extract-build-zenith.js`
5. Le JSON est copié automatiquement dans le presse-papier (affiché aussi dans la console)
6. Le coller dans le champ **Import Wakfuli / Zenith** de l'onglet BUILD

### Deux façons d'importer le JSON dans le champ

- **Import automatique au collage** *(le plus simple)* : il suffit de coller le JSON dans le champ. Si le contenu est un build valide, il est importé immédiatement, sans clic. Rien ne se passe en silence si ce n'est pas (encore) du JSON exploitable.
- **Bouton Importer** : coller le JSON puis cliquer sur **Importer**. Utile pour réimporter un texte déjà présent dans le champ, ou si le collage automatique n'a pas pris.

Après import, un résumé s'affiche (classe, niveau, nombre de sorts / stats / passifs reconnus). Si la classe n'est pas détectée, le build est tout de même importé — il suffit de choisir la classe manuellement au-dessus.

---

## Données

- **874 monstres** avec PV, niveau et résistances élémentaires
- **8 passifs généraux** + **3 sorts communs** partagés par toutes les classes
- **18 classes** intégrées : sorts (dégâts niv. 245, portée, type, ligne de vue) et passifs
- **Mécaniques modélisées en profondeur** (jauge suivie + dégâts ajustés) :
  - **Sram** — Point Faible (génération/consommation, finisseurs) + Hémorragie, calibré en jeu
  - **Iop** — Concentration (0→100, palier ×1.10 + bonus Égaré sur Fulgur/Colère à 100)
  - **Crâ** — Précision/Affûtage + **toggle Tir précis** : chaque sort passe à ses dégâts améliorés (chiffrés depuis les effets) et consomme de la Précision
  - **Sacrieur** — Fureur + **Berserk** : bonus de dégâts selon les PV manquants du joueur (suivi via le log) + dégâts conditionnels chiffrés (Aversion stabilisé, Fracasse vs Armure). ⚠ Le % de Berserk est une estimation à confirmer in-game (isolée dans `mechanics.js`)
  - **Ecaflip** — **Dé six** : compteur de lancers qui réduit son coût en PA (−1/lancer, min 1 PA) → dégâts/PA recalculés et séquence optimale adaptée. Veine informative (pas de bonus de dégâts direct)
  - **Eliotrope** — **Serein/Exalté + Portails + Don céleste** : trois toggles qui modifient les dégâts (mode Exalté, sort via portail, +40 % Dommages infligés du Don céleste), tous chiffrés depuis les effets
  - **Eniripsa** — dégâts **conditionnels sur les PV** (auto) : Anatomie (plein si la cible a ≥ 80 % PV, réduit sinon), Torpeur (+bonus si l'Eniripsa a ≥ 80 % PV). Classe surtout support (Marques/Propagateur non chiffrés)
  - **Enutrof** — **Trésors** : toggle qui majore Epuration (212 → 266). Forme Phorzerker informative (bonus de dégâts non chiffré dans les données)
  - **Féca** — passifs offensifs **chiffrés** (+10 % à +25 % Dommages infligés selon le passif actif) appliqués au ranking. Glyphes & boucliers en conseil
  - **Huppermage** — jauge de **BQ** (Brise Quadramentale) : Rayon crépusculaire scale dessus (+0,5 % de dégâts par % de BQ, ×1,50 à 100). Runes & Feu-Follet en conseil
  - **Osamodas** — **Forme draconique** : toggle +25 % Dommages infligés + dégâts draconiques (Souffle du dragon 164 → 244) ; Corbeau incendiaire hors LdV (83 → 111) ; passifs offensifs chiffrés. Invocations en conseil (non simulées)
  - **Ouginak** — dégâts **conditionnels** : Plombage (auto, ≥ 80 % PV → 98/131), Bastonnade (toggle, cible Bastonné → ×3), Balayage (toggle, contact → 131/164). Rage/Ougigarou en conseil
  - **Pandawa** — **Tonneau porté** : toggle qui modifie les dégâts (Flasque 111 → 167, Lucha/Blitzkriek +10 %) + 10 % Dommages infligés (Tonneau Agressif) ; passifs offensifs chiffrés (Cyanose +15 %). Imbibé/ivresse en conseil
- Les autres classes utilisent le calcul de dégâts générique ; leur ressource de classe est rappelée en conseil mais pas encore chiffrée (en cours d'ajout, une par une)

---

## Pipeline de données

Les données de jeu viennent de l'encyclopédie Wakfu, scrapées puis générées :

1. **Scraping** : exécuter `extract-spells-encyclo.js` / `extract-passives-encyclo.js` (bookmarklets, voir `bookmarklets.html`) sur une page de classe de l'encyclopédie. Le CSV produit est copié dans le presse-papier.
2. **Source** : coller le CSV dans `data-raw/Sorts_<Classe>.csv` ou `data-raw/Passifs_<Classe>.csv`. **Ces CSV sont la source de vérité.**
3. **Génération** : lancer `node build-data.js` pour régénérer `data-game.js` et `data-commun.js`.

> ⚠ Ne pas éditer `data-game.js` ni `data-commun.js` à la main — ils sont générés. Modifier les CSV puis relancer `build-data.js`.

---

## Structure des fichiers

```
index.html              Interface (markup uniquement)
wca.css                 Styles
wca.js                  Logique applicative
mechanics.js            Mécaniques de classe (jauge, génération, bonus de dégâts) — window.WCA_MECHANICS
data-game.js            [GÉNÉRÉ] Sorts et passifs des 18 classes (window.WCA_SPELLS)
data-commun.js          [GÉNÉRÉ] Sorts communs + passifs généraux (window.WCA_COMMON_SPELLS / _GENERAL_PASSIVES)
data-monsters.js        Base de données monstres — 874 entrées (window.WCA_MONSTERS)
data-raw/               CSV sources (Sorts_*.csv, Passifs_*.csv) — source de vérité
build-data.js           Générateur : data-raw/*.csv → data-game.js + data-commun.js
extract-spells-encyclo.js   Bookmarklet : scrape les sorts d'une classe → CSV
extract-passives-encyclo.js Bookmarklet : scrape les passifs d'une classe → CSV
extract-build-wakfuli.js    Script à coller dans la console sur wakfuli.com
extract-build-zenith.js     Script à coller dans la console sur zenithwakfu.com
```
