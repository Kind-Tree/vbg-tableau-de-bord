# Reprendre le projet sur un PC neuf

1. Installer Git, Python 3.12 (bibliothèque standard seulement, aucun `pip install`), Node 22+ (tests de la page) et, si besoin, la CLI `gh` (`gh auth login`).
2. Cloner : `git clone https://github.com/Kind-Tree/vbg-tableau-de-bord.git`
3. Dans le dossier cloné : `git config core.hooksPath .githooks` (crochets anti-noms d'arbitres), puis `git config user.name` et `user.email` si absents.
4. Vérifier : `python -m unittest discover -s tests` puis `node --test tests/test_page.js` (tout doit être vert).
5. Fichiers locaux hors Git, à récupérer de l'ancien PC si utiles : `dossier_revue/` (régénérable : `python assembler_dossier.py`) et, si utile, `..\_archives\volley-vbg\` (conception, non actif). Le projet fonctionne sans eux.
6. Aucun secret à reconstituer : la collecte tourne sur GitHub Actions (`.github/workflows/`), le site est publié par GitHub Pages (`/docs`, branche `main`).
7. Collecte manuelle ou ajout d'heure : voir `MODE-D-EMPLOI.md`.
