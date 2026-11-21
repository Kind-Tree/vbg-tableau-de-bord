# Tableau de bord VBG (Volley-Ball Grégorien)

Page web mobile du club : vue « Programme » (une semaine à la fois, toute la saison), fiche de chaque équipe (prochain match, derniers résultats, rang) et vue « Poule » (classement complet, matchs restants, toute la poule). Site : https://kind-tree.github.io/vbg-tableau-de-bord/ (dépôt `Kind-Tree/vbg-tableau-de-bord`, branche `main`, Pages sur `/docs`).
Le président (non développeur) pilote en français et valide chaque étape. Réponses courtes, en français.

## Architecture
- `collect.py` : collecteur Python, bibliothèque standard uniquement. Lit les pages HTML FFvolley (ffvbbeach.org) et écrit `docs/data.json`. Pas d'API ni de CORS. Les pages de poule sont la source (toute la saison) ; la page club « Programme des rencontres » (`planning_club.php`, `date_jour` = minuit de Paris en horodatage Unix, semaine du lundi au lundi suivant) ne sert qu'au contrôle.
- `docs/index.html` : toute la page (HTML, CSS, JS), aucune dépendance. `textContent` uniquement, jamais `innerHTML`. Copie de secours `SECOURS` intégrée (premier chargement hors ligne), sans le champ `poules` pour rester légère : se régénère avec `python regenerer_secours.py <data.json>`. Vues : `#programme` (défaut ; l'ancienne `#semaine` y mène), `#<équipe>`, `#poule-<équipe>` (stable d'une saison à l'autre, pour des QR codes), `#coupes`, `#toutes`.
- `docs/data.json` : produit par le robot (`collecte-vbg`) à chaque collecte. Ne pas l'éditer à la main.
- `.github/workflows/collecte.yml` : collecte planifiée (ven. 18 h, dim. 9 h/21 h/23 h, lun. 7 h, heure de Paris) + lancement manuel. Aucun test dans ce workflow. `tests.yml` : tests à chaque push.
- Heures saisies par le club : `heures.json` (racine ; `[{equipe, date AAAA-MM-JJ, heure, saisie}]`, une ligne par équipe et jour), écrit seulement par `heures.py` via le workflow `.github/workflows/heure.yml` (« Ajouter une heure », lancement manuel : équipe en liste déroulante, date `JJ/MM`, heure `HH:MM` ou vide pour supprimer ; valide, commite `heures.json`, puis lance `collecte.yml`). La collecte lit `heures.json` (jamais écrit par elle) et ajoute `heure_saisie` à tous les matchs du club ce jour-là (plateau compris) dans `prochain/avenir/attente/poules[].matchs`. La page affiche l'heure de FFvolley si elle existe, sinon `heure_saisie` avec « saisie VBG ». Écart avec FFvolley : « ECART heure » dans le rapport, pas un échec. Une heure saisie reste après chaque collecte (même poule non lue) : testé.
- Archives (hors projet, `..\_archives\volley-vbg\` : `RECAP-FABLE.md`, `CADRAGE.md`, `NUIT.md`, historique de la conception, rien d'actif). Dossier local `dossier_revue/` (ignoré par Git, `python assembler_dossier.py`). Dans le dépôt : `MODE-D-EMPLOI.md`, `SAISON.md`.
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

## En attente / à surveiller
Voir `ETAT.md` (état en cours, passages à vérifier, décisions ouvertes).

Détail de la conception : archives ci-dessus (lecture seule).

## Détail
Sources FFvolley et GitHub, décisions prises, pièges rencontrés : `reference/DETAIL.md` (lire la section utile avant de toucher à la collecte, aux workflows ou à l'affichage du plateau/exempt/« À domicile »). Le dossier `docs/` est le site publié : ne rien y mettre d'autre.

## Socle
@ETAT.md
- À la fin de chaque tâche, mets à jour ETAT.md (40 lignes au plus).
- Reprise sur un PC neuf : INSTALLATION.md. Envies futures : IDEES.md.
- Un dépôt distant de sauvegarde existe (public) : pousse après chaque commit.
