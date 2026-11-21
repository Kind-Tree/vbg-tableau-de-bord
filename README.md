# Tableau de bord VBG

Page web mobile du Volley-Ball Grégorien : programme de la saison, fiche de chaque équipe, classement des poules.

- Emplacement : `C:\Users\samue\Documents\Projets\vbg-tableau-de-bord`
- Dépôt : https://github.com/Kind-Tree/vbg-tableau-de-bord (PUBLIC : aucune donnée personnelle, aucun nom d'arbitre)
- Site : https://kind-tree.github.io/vbg-tableau-de-bord/ (GitHub Pages, dossier `docs/`, branche `main`)

## Lancer

| Besoin | Commande |
|---|---|
| Tests Python | `python -m unittest discover -s tests` |
| Tests de la page | `node --test tests/test_page.js` |
| Voir la page en local | `python -m http.server 8765 --directory docs` puis http://localhost:8765 |
| Collecte à la main | GitHub, onglet Actions, « Collecte FFvolley », Run workflow (voir `MODE-D-EMPLOI.md`) |
| Ajouter une heure à un match | GitHub, Actions, « Ajouter une heure » (voir `MODE-D-EMPLOI.md`) |
| Contrôle avant changement de saison | `python collect.py --diagnostic` (n'écrit rien) |
| Régénérer la copie de secours | `python regenerer_secours.py docs/data.json` |
| Dossier de revue (local) | `python assembler_dossier.py` |

## Contenu

| Dossier ou fichier | Rôle |
|---|---|
| `collect.py` | Collecteur FFvolley, écrit `docs/data.json` |
| `docs/` | Site publié (page, données, icônes). Rien d'autre ici |
| `heures.py`, `heures.json` | Heures saisies par le club |
| `.github/workflows/` | Collecte planifiée, ajout d'heure, tests |
| `tests/` | Tests et pages FFvolley anonymisées |
| `.githooks/` | Crochets anti-noms d'arbitres |
| `reference/DETAIL.md` | Sources, décisions, pièges (détail sorti de CLAUDE.md) |
| `MODE-D-EMPLOI.md`, `SAISON.md` | Utilisation ; changement de saison |
| `CLAUDE.md`, `ETAT.md`, `IDEES.md`, `INSTALLATION.md` | Socle : règles, état, envies, reprise sur PC neuf |
| `dossier_revue/` | Dossier de revue, local, hors Git |
| `..\_archives\volley-vbg\` | Archives de conception, hors projet |
