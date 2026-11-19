# Tableau de bord VBG (Volley-Ball Grégorien)

Page web mobile du club : vue « Programme » (une semaine à la fois, toute la saison), fiche de chaque équipe (prochain match, derniers résultats, rang) et vue « Poule » (classement complet, matchs restants, toute la poule). Site : https://kind-tree.github.io/vbg-tableau-de-bord/ (dépôt `Kind-Tree/vbg-tableau-de-bord`, branche `main`, Pages sur `/docs`).
Le président (non développeur) pilote en français et valide chaque étape. Réponses courtes, en français.

## Architecture
- `collect.py` : collecteur Python, bibliothèque standard uniquement. Lit les pages HTML FFvolley (ffvbbeach.org) et écrit `docs/data.json`. Pas d'API ni de CORS. Les pages de poule sont la source (toute la saison) ; la page club « Programme des rencontres » (`planning_club.php`, `date_jour` = minuit de Paris en horodatage Unix, semaine du lundi au lundi suivant) ne sert qu'au contrôle.
- `docs/index.html` : toute la page (HTML, CSS, JS), aucune dépendance. `textContent` uniquement, jamais `innerHTML`. Copie de secours `SECOURS` intégrée (premier chargement hors ligne), sans le champ `poules` pour rester légère : se régénère avec `python regenerer_secours.py <data.json>`. Vues : `#programme` (défaut ; l'ancienne `#semaine` y mène), `#<équipe>`, `#poule-<équipe>` (stable d'une saison à l'autre, pour des QR codes), `#coupes`, `#toutes`.
- `docs/data.json` : produit par le robot (`collecte-vbg`) à chaque collecte. Ne pas l'éditer à la main.
- `.github/workflows/collecte.yml` : collecte planifiée (ven. 18 h, dim. 9 h/21 h/23 h, lun. 7 h, heure de Paris) + lancement manuel. Aucun test dans ce workflow. `tests.yml` : tests à chaque push.
- Heures saisies par le club : `heures.json` (racine ; `[{equipe, date AAAA-MM-JJ, heure, saisie}]`, une ligne par équipe et jour), écrit seulement par `heures.py` via le workflow `.github/workflows/heure.yml` (« Ajouter une heure », lancement manuel : équipe en liste déroulante, date `JJ/MM`, heure `HH:MM` ou vide pour supprimer ; valide, commite `heures.json`, puis lance `collecte.yml`). La collecte lit `heures.json` (jamais écrit par elle) et ajoute `heure_saisie` à tous les matchs du club ce jour-là (plateau compris) dans `prochain/avenir/attente/poules[].matchs`. La page affiche l'heure de FFvolley si elle existe, sinon `heure_saisie` avec « saisie VBG ». Écart avec FFvolley : « ECART heure » dans le rapport, pas un échec. Une heure saisie reste après chaque collecte (même poule non lue) : testé.
- Fichiers locaux, exclus de Git : `RECAP-FABLE.md`, `CADRAGE.md`, `NUIT.md`. Dans le dépôt : `MODE-D-EMPLOI.md`, `SAISON.md`.
- Pas de service worker (un cache pourrait servir un vieux `data.json`).
- Crochets git versionnés dans `.githooks/` (`git config core.hooksPath .githooks`, à refaire sur chaque copie du dépôt) : `pre-commit` et `pre-push` bloquent tout nom d'arbitre en clair dans une page de test (`tests/verifier_arbitres.py`).

## Tests (à lancer avant tout commit touchant collect.py ou docs/index.html)
```
python -m unittest discover -s tests
node --test tests/test_page.js
```
- `tests/test_collect.py` (89) : parsing sur de vraies pages FFvolley sauvegardées dans `tests/fixtures/*.html` (arbitres anonymisés).
- `tests/test_programme.py` (48) : poules publiées, exempts, plateaux, contrôle par la page club, heure de Paris, copie de secours, anonymisation et crochets git.
- `tests/test_heures.py` (26) : validation et refus de `heures.py`, `appliquer_heures`, persistance sur plusieurs collectes, contrôle de `heure.yml` et `collecte.yml` (liste déroulante = `EQUIPES`, horaires inchangés, `queue: max`, pas d'entrée dans un `run:`).
- `tests/test_page.js` (121) : faux DOM. Il est plus permissif qu'un navigateur : un test vert ne prouve pas le rendu réel sur iPhone.
- Méthode suivie : mutations volontaires (le test doit échouer), puis relecture par un sous-agent checker avant de conclure. Ne pas ajouter de test qui ne peut pas échouer.
- Les tests de charte (couleurs) et d'adresses uniques par équipe sont actifs.
- Nouvelle page FFvolley de test : l'enregistrer brute hors du dépôt, puis `python tests/anonymiser.py brut.html tests/fixtures/x.html`. Les arbitres sont dans DEUX emplacements (page club : dernière cellule de la ligne ; page de poule : cellule juste après les points « 075-059 »). Une page de poule enregistrée avec le seul motif de la page club a déjà laissé passer des noms réels.

## Règles de données (ne pas déroger)
- Ne jamais inventer une donnée. Un score illisible (forfait) est marqué `illisible`.
- Poule illisible : on garde ses dernières données (poules comprises) avec `nonlu: true`, `raison`, `lu`. Le workflow échoue ensuite (code de sortie 2), mais `data.json` est publié.
- Contrôle par la page club (semaine en cours + suivante, sauf avec `--only`) : chaque match listé (hors exempts) doit exister dans les poules lues, sinon « ECHEC contrôle : … » (code 2, `data.json` publié, aucune équipe marquée non lue). Message d'une poule non configurée : code, titre et adresse. Poules volontairement non suivies : liste `IGNOREES` (aujourd'hui JMJ, Coupe de France M21), jamais signalées.
- Jamais d'écrasement par un fichier vide ou partiel : écriture atomique, aucune écriture si toutes les poules échouent.
- Page FFvolley complète seulement si `</html>` est dans les 600 derniers caractères (3 essais). Pause de 2 s entre requêtes, User-Agent identifiable.
- Le nom du club change d'une poule à l'autre : configuré par équipe, jamais de recherche approximative. Poules vues mais non configurées : listées dans `nonsuivies`, jamais ajoutées automatiquement.
- Heure toujours de Paris (calcul de l'heure d'été codé à la main), quel que soit le téléphone.
- `heure_saisie` (HH:MM) : ajout seulement ; ne remplace jamais `heure` de FFvolley. Liste déroulante de `heure.yml` à garder identique à `EQUIPES` (test) : ajouter une équipe = ajouter son nom aux deux.
- Format `data.json` : `{maj, equipes[], coupes[], nonsuivies[], salles_club[]}` ; équipe : `nom, poule, rang, sur, pts, g, p, prochain, resultats (5 max), avenir, attente, lu, poules[]`. `poules[]` : `{titre, nous, active, classement[{rang, club, pts, j, g, p}], matchs[{date, heure?, dom, ext?, j?, salle?, sd?, se?, sets?, illisible?, exempt?}]}` ; `nous` = notre nom FFvolley dans la poule ; une ligne exempte (FFvolley écrit « xxxxx », jamais publié) porte `exempt: true` et la vraie équipe en `dom` ; pas de code de match. Dans `prochain/resultats/avenir/attente`, les sets sont du point de vue du VBG ; dans `poules[].matchs`, de celui qui reçoit. Ajouts seulement : ne pas changer les champs existants sans accord (compatibilité, ancien `data.json` et copie de secours doivent rester lisibles par la page).

## Charte graphique (stricte)
Fond #111111, cartes #1F1F1F, texte blanc, accent orange #F26910 (jamais en texte courant), victoire #1E7A3C et défaite #B3261E toujours avec la lettre V ou D, Arial, titres en majuscules gras. Interdits : bleu, dégradés, logo déformé ou recoloré. Zones tactiles de 44 px minimum, mobile d'abord (360 px).

## Décisions prises
- Saison = constante unique `SAISON` dans `collect.py` (testée). Changement de saison : suivre `SAISON.md`, lancer `python collect.py --diagnostic` (n'écrit rien, ne lit pas data.json) avant d'éditer la config.
- Pas de commit « de maintien en vie » automatique contre la désactivation des workflows après 60 jours (non documenté par GitHub).
- Menu sans étiquette visible : voulu. Pas de code de match dans `data.json` (extension « poules » acceptée, ajouts seulement).
- Pas d'itinéraire ni d'adresse de salle : le nom de la salle en texte simple (l'adresse n'est que dans la fiche PDF de match, qui contient des données personnelles : jamais lue).
- « À domicile » : hors plateau, le domicile/extérieur de FFvolley (fiable). Plateau = au moins 2 lignes d'une équipe le même jour dans la même poule (exempt compris) : une seule mention « Plateau », « VBG » si toutes les salles sont dans `SALLES_CLUB` (nom entier, casse ignorée) ET qu'une ligne nous met à domicile (« SALLE DU COSEC » existe chez d'autres clubs), sinon le nom de la salle ; plateau déjà joué (salle effacée par le score) : « Plateau » seul, masqué par le filtre avec une note.
- Exempt : ligne « Exempt » si aucun autre match ce jour-là, sinon « exempte d'un tour » sur le plateau. Match « joué » dès qu'il a un score, quelle que soit sa date.
- Vues « Programme » et « Poule » remplacent « Cette semaine », « Semaine dernière » et le bloc « Calendrier » (supprimés).
- Changement de phase en janvier : voir `SAISON.md`.

## Pièges rencontrés
- Écrire les regex avec `\b` ou `\n` directement dans les fichiers, pas via un script Python en ligne de commande : le shell altère les doubles barres obliques inverses (un test de charte ne pouvait ainsi jamais échouer).
- Le cron GitHub est en UTC : les deux heures (été et hiver) sont programmées, l'étape « Saison » ignore celle qui ne correspond pas. Deux exécutions par passage dans Actions, c'est normal.
- Les poules régionales exigent `calend=COMPLET` dans l'URL. Encodage des pages : windows-1252.
- Le bouton « Actualiser » recharge `data.json`, il ne déclenche pas de collecte.
- Pas de `git add -p` disponible : des hunks de tâches différentes peuvent finir dans un même commit.
- Le shell Windows altère aussi les heredocs contenant des guillemets : écrire les gros fichiers de test avec l'outil de fichier, pas avec `cat <<EOF`.
- `SALLE DU COSEC` n'est pas propre au club : une salle seule ne prouve pas qu'on reçoit.

- Workflows : jamais `${{ inputs.… }}` dans un `run:` (injection de commande) : passer par `env:` (testé). Dans un groupe de concurrence, GitHub annule le passage déjà en attente : `queue: max` (incompatible avec `cancel-in-progress: true`) dans `collecte.yml` et `heure.yml`.

## En attente / à surveiller
Voir `ETAT.md` (état en cours, passages à vérifier, décisions ouvertes).

Détail complet : `RECAP-FABLE.md` (local, 35 Ko).
