# ETAT : chantier en cours

Mis à jour à la fin de chaque tâche. Le stable est dans CLAUDE.md.

## Chantier « Programme » et « Poule » : en ligne depuis le 19/11
Fusionné dans `main` en squash (PR n°1, `4789cab`). Collecte manuelle du 19/11 verte, 15 équipes avec `poules`, aucune non lue.

## Chantier « Heures saisies » : fusionné dans `main` (PR n°2, `9a52dcc`, 19/11)
Tests : Python 163, Node 121. Collecte manuelle après fusion (run 44525232311) : verte, `queue: max` validé.
Choix : heure saisie seulement pour un match existant (suppression toujours possible) ; `dejaJoue` ignore la saisie ; mention « saisie VBG » ; repli navigateur ordinateur si l'app mobile n'offre pas « Run workflow » (MODE-D-EMPLOI §5). Coupes non concernées.
Heure tolérante faite (19/11) : 9:30, 9h30, 9h, 14h00, 14 h 30, heure seule (13, 9) et H majuscule (18H30) acceptés ; aide du champ « ex. 18h30 ». Tri (19/11) : matchs sans heure en haut de chaque jour, puis du plus tôt au plus tard. RESTE : essai réel depuis le téléphone (président) sur un match « Heure à confirmer » du 21/11 : runs « Ajouter une heure » puis « Collecte » verts, puis supprimer l'heure (heure vide).

## Reste à faire, dans l'ordre
1. Vendredi 20/11 vers 18 h 15 : onglet Actions, « Collecte FFvolley », événement « schedule » : exécution réelle verte et commit « Mise à jour des données » (la 2e exécution « Passage ignoré » est normale). Rien avant 19 h : lancer une collecte à la main et noter l'incident.
   Lundi 23/11 au matin : match de la N3M à Rennes du 22/11 (16 h) visible en V ou D avec le score en sets sur la page (« Résultat pas encore publié » : attendre le passage de lundi 7 h, sinon vérifier plus tard) ; rang mis à jour.
2. Horaires de collecte : passer à `timezone: Europe/Paris` dans `collecte.yml` avec un passage quotidien à 7 h 17 (chantier à part ; vérifier dans la doc GitHub que la clé `timezone` existe pour `schedule`, retirer alors le double cron été/hiver et l'étape « Saison »).

## À vérifier sur l'iPhone (site en ligne)
1. Au lancement : « Programme » s'ouvre, semaine du lundi au dimanche, aujourd'hui signalé.
2. ‹ › parcourent la saison (bloqués au premier et au dernier match) ; « Aujourd'hui » ramène ; pas de défilement horizontal.
3. Plateau (M13) : une seule ligne « Plateau », « VBG » si c'est chez nous, sans domicile/extérieur match par match.
4. Heures absentes : « Heure à confirmer ». Exempt : ligne « Exempt » ou « exempte d'un tour » sur le plateau. Jamais « xxxxx ».
5. Filtre « À domicile » : bouton orange quand actif ; les matchs à l'extérieur disparaissent.
6. Match déjà noté d'un jour futur (Loisir, 23/11) : pastille V ou D et score, pas « à venir ».
7. Fiche d'équipe : bouton « Poule et classement » ; la vue Poule montre le classement (notre ligne surlignée, notre nom), « Nos matchs restants », « Toute la poule ».
8. Adresse directe `…/#poule-n3m` (futur QR code) ; `#semaine` ouvre le Programme.
9. Hors ligne au premier chargement : la page s'affiche (copie intégrée sans les poules : « Classement complet disponible après la prochaine collecte »).
10. « Non lu » et « Données anciennes » visibles dans les nouvelles vues ; textes lisibles, zones tactiles confortables.

## En attente / à surveiller
- Passages du 20/11 (18 h) et du 22/11 : voir « Reste à faire ».
- Non vérifiés : e-mail d'échec réel (y compris « ECHEC contrôle »), rendu iPhone des nouvelles vues.
- Janvier : changement de phase des poules jeunes (SAISON.md, section « Changement de phase »).
- Décisions ouvertes : historique Git de `main` (vrais noms d'arbitres dans `ebf790f`), dépôt GitHub PUBLIC (vérifié le 19/11) donc ebf790f est lisible de tous, adresse et propriétaire du dépôt, rappel d'agenda fin août 2027.
- Défauts mineurs connus : plafond de 5 résultats par carte, ordre à égalité de date, page ouverte non recalculée avant retour au premier plan.
- Crochets git : `git config core.hooksPath .githooks` à refaire sur toute nouvelle copie du dépôt.
- JMJ (Coupe de France M21) volontairement ignorée (`IGNOREES`).
- Socle installé le 19/11 : IDEES.md, INSTALLATION.md, `python assembler_dossier.py` -> dossier_revue/ (local, hors Git).
- Été (juin à août) : une fois par mois, onglet Actions : aucun workflow désactivé ; lancer une collecte à la main. Vérifier une fois à l'écran le réglage d'e-mail « échecs seulement » (CLAUDE.md, Sources).
- Archives de conception déplacées hors projet (19/11) : `..\_archives\volley-vbg\`.
