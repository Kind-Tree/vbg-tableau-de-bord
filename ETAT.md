# ETAT : chantier en cours

Mis à jour à la fin de chaque tâche. Le stable est dans CLAUDE.md.

## Chantier « Programme » et « Poule » : terminé sur la branche, PAS fusionné
Branche `programme-poule` (poussée ; historique réécrit le 19/11 pour retirer des noms d'arbitres d'une page de test). Rien sur `main` avant le feu vert du président, après les passages du 20/11 (18 h) et du 22/11.
Tests : Python 137, Node 115, mutations volontaires toutes détectées, relecture indépendante faite et corrigée. Collecte d'essai réelle : code 0, contrôle de la page club concordant.
Page d'essai privée (données du 19/11, version 2 : bouton « Alertes simulées » pour voir « Non lu » et « Données anciennes ») : https://claude.ai/artifact/1BUabnXYGLycLSaiqwH1Tw
Les 6 exécutions Actions liées à d'anciens commits ont été supprimées le 19/11 ; pas de demande au support GitHub (décision du président).

## Étapes restantes, dans l'ordre
1. Fusion de `programme-poule` dans `main` en « Squash and merge », seulement après le feu vert du président (une fois vérifiés les passages du 20/11 et du 22/11 et la liste iPhone ci-dessous). Jamais de push direct sur main.
2. Collecte manuelle (MODE-D-EMPLOI §1) pour que `data.json` reçoive `poules` et `salles_club`.
3. Horaires de collecte : passer à `timezone: Europe/Paris` dans `collecte.yml` avec un passage quotidien à 7 h 17 (à faire dans un chantier à part ; vérifier dans la doc GitHub que la clé `timezone` existe pour `schedule`, retirer alors le double cron été/hiver et l'étape « Saison »).

## À vérifier sur l'iPhone (page d'essai, puis site après fusion)
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
- Vendredi 20/11/2026 18 h : premier passage planifié jamais exécuté (vérifier l'onglet Actions). Dimanche 22/11 : résultat de la N3M à Rennes.
- Non vérifiés : e-mail d'échec réel (y compris « ECHEC contrôle »), rendu iPhone des nouvelles vues.
- Janvier : changement de phase des poules jeunes (SAISON.md, section « Changement de phase »).
- Décisions ouvertes : historique Git de `main` (vrais noms d'arbitres dans `ebf790f`), adresse et propriétaire du dépôt, rappel d'agenda fin août 2027.
- Défauts mineurs connus : plafond de 5 résultats par carte, ordre à égalité de date, page ouverte non recalculée avant retour au premier plan.
- Crochets git : `git config core.hooksPath .githooks` à refaire sur toute nouvelle copie du dépôt.
- JMJ (Coupe de France M21) volontairement ignorée (`IGNOREES`).
