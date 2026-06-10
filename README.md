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

1. Ouvrir son personnage sur [wakfuli.com](https://wakfuli.com) ou [zenithwakfu.com](https://zenithwakfu.com)
2. Ouvrir la console du navigateur (F12)
3. Coller et exécuter le contenu de `extract-build-wakfuli.js` ou `extract-build-zenith.js`
4. Copier le JSON affiché dans la console
5. Le coller dans le champ **Import Wakfuli / Zenith** de l'onglet BUILD

---

## Données

- **874 monstres** avec PV, niveau et résistances élémentaires
- **11 passifs généraux** partagés par toutes les classes
- **Sram** : 20 passifs de classe + sorts complets avec dégâts niv. 1 et 245
- **Féca** : 22 passifs de classe (structure prête, sorts à compléter)

---

## Structure des fichiers

```
index.html              Interface (markup uniquement)
wca.css                 Styles
wca.js                  Logique applicative (~80 Ko)
data-game.js            Sorts et passifs par classe (window.WCA_SPELLS, window.WCA_GENERAL_PASSIVES)
data-commun.js          Sorts communs à toutes les classes (window.WCA_COMMON_SPELLS)
data-monsters.js        Base de données monstres — 874 entrées (window.WCA_MONSTERS)
extract-build-wakfuli.js  Script à coller dans la console sur wakfuli.com
extract-build-zenith.js   Script à coller dans la console sur zenithwakfu.com
```
