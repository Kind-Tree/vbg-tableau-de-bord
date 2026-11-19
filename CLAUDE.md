# Tableau de bord VBG (Volley-Ball Grégorien)

Page web mobile qui montre, pour chaque équipe du club, prochain match, derniers résultats et rang. Site : https://kind-tree.github.io/vbg-tableau-de-bord/ (dépôt `Kind-Tree/vbg-tableau-de-bord`, branche `main`, Pages sur `/docs`).
Le président (non développeur) pilote en français et valide chaque étape. Réponses courtes, en français.

## Architecture
- `collect.py` : collecteur Python, bibliothèque standard uniquement. Lit les pages HTML FFvolley (ffvbbeach.org) et écrit `docs/data.json`. Pas d'API ni de CORS.
- `docs/index.html` : toute la page (HTML, CSS, JS), aucune dépendance. `textContent` uniquement, jamais `innerHTML`. Copie de secours `SECOURS` intégrée (premier chargement hors ligne).
- `docs/data.json` : produit par le robot (`collecte-vbg`) à chaque collecte. Ne pas l'éditer à la main.
- `.github/workflows/collecte.yml` : collecte planifiée (ven. 18 h, dim. 9 h/21 h/23 h, lun. 7 h, heure de Paris) + lancement manuel. Aucun test dans ce workflow. `tests.yml` : tests à chaque push.
- Fichiers locaux, exclus de Git : `RECAP-FABLE.md`, `CADRAGE.md`, `NUIT.md`. Dans le dépôt : `MODE-D-EMPLOI.md`, `SAISON.md`.
- Pas de service worker (un cache pourrait servir un vieux `data.json`).

## Tests (à lancer avant tout commit touchant collect.py ou docs/index.html)
```
python -m unittest discover -s tests
node --test tests/test_page.js
```
- `tests/test_collect.py` (84) : parsing sur de vraies pages FFvolley sauvegardées dans `tests/fixtures/*.html` (arbitres anonymisés).
- `tests/test_page.js` (94) : faux DOM. Il est plus permissif qu'un navigateur : un test vert ne prouve pas le rendu réel sur iPhone.
- Méthode suivie : mutations volontaires (le test doit échouer), puis relecture par un sous-agent checker avant de conclure. Ne pas ajouter de test qui ne peut pas échouer.
- Les tests de charte (couleurs) et d'adresses uniques par équipe sont actifs.

## Règles de données (ne pas déroger)
- Ne jamais inventer une donnée. Un score illisible (forfait) est marqué `illisible`.
- Poule illisible : on garde ses dernières données avec `nonlu: true`, `raison`, `lu`. Le workflow échoue ensuite (code de sortie 2), mais `data.json` est publié.
- Jamais d'écrasement par un fichier vide ou partiel : écriture atomique, aucune écriture si toutes les poules échouent.
- Page FFvolley complète seulement si `</html>` est dans les 600 derniers caractères (3 essais). Pause de 2 s entre requêtes, User-Agent identifiable.
- Le nom du club change d'une poule à l'autre : configuré par équipe, jamais de recherche approximative. Poules vues mais non configurées : listées dans `nonsuivies`, jamais ajoutées automatiquement.
- Heure toujours de Paris (calcul de l'heure d'été codé à la main), quel que soit le téléphone.
- Format `data.json` : `{maj, equipes[], coupes[], nonsuivies[]}` ; équipe : `nom, poule, rang, sur, pts, g, p, prochain, resultats (5 max), avenir, attente, lu`. Les sets sont du point de vue du VBG. Ne pas changer ce format sans accord (compatibilité).

## Charte graphique (stricte)
Fond #111111, cartes #1F1F1F, texte blanc, accent orange #F26910 (jamais en texte courant), victoire #1E7A3C et défaite #B3261E toujours avec la lettre V ou D, Arial, titres en majuscules gras. Interdits : bleu, dégradés, logo déformé ou recoloré. Zones tactiles de 44 px minimum, mobile d'abord (360 px).

## Décisions prises
- Saison = constante unique `SAISON` dans `collect.py` (testée). Changement de saison : suivre `SAISON.md`, lancer `python collect.py --diagnostic` (n'écrit rien, ne lit pas data.json) avant d'éditer la config.
- Pas de commit « de maintien en vie » automatique contre la désactivation des workflows après 60 jours (non documenté par GitHub).
- Menu sans étiquette visible : voulu. Format de `data.json` non étendu (pas de code de match).
- Bloc « Calendrier » (vue d'une équipe) : publié mais pas encore validé par le président ; retrait : `git revert 0a45daa d6b51d6`.

## Pièges rencontrés
- Écrire les regex avec `\b` ou `\n` directement dans les fichiers, pas via un script Python en ligne de commande : le shell altère les doubles barres obliques inverses (un test de charte ne pouvait ainsi jamais échouer).
- Le cron GitHub est en UTC : les deux heures (été et hiver) sont programmées, l'étape « Saison » ignore celle qui ne correspond pas. Deux exécutions par passage dans Actions, c'est normal.
- Les poules régionales exigent `calend=COMPLET` dans l'URL. Encodage des pages : windows-1252.
- Le bouton « Actualiser » recharge `data.json`, il ne déclenche pas de collecte.
- Pas de `git add -p` disponible : des hunks de tâches différentes peuvent finir dans un même commit.

## En attente / à surveiller
- Vendredi 20/11/2026 18 h : premier passage planifié jamais exécuté (vérifier l'onglet Actions). Dimanche 22/11 : résultat de la N3M à Rennes.
- Non vérifiés : e-mail d'échec réel, rendu iPhone (blocs « Calendrier », « Semaine dernière », « Données anciennes »).
- Décisions ouvertes : garder le bloc « Calendrier », historique Git (vrais noms d'arbitres dans `ebf790f`), adresse et propriétaire du dépôt, rappel d'agenda fin août 2027.
- Défauts mineurs connus : plafond de 5 résultats par carte, ordre à égalité de date, page ouverte non recalculée avant retour au premier plan, SECOURS à régénérer à la main.

Détail complet : `RECAP-FABLE.md` (local, 35 Ko).
