# ETAT : chantier en cours

Mis à jour à la fin de chaque tâche. Le stable est dans CLAUDE.md.

## Chantier « Programme » et « Poule » : en ligne depuis le 19/11
Fusionné dans `main` en squash (PR n°1, `4789cab`). Collecte manuelle du 19/11 verte, 15 équipes avec `poules`, aucune non lue.

## Chantier « Heures saisies » : sur la branche `heures-saisies`, PAS fusionné
Étapes 1 à 5 faites et poussées (commits `389f750`, `4551a49`, puis documents). Tests : Python 163, Node 121 ; mutations volontaires toutes détectées. Relecture par le conseiller (pas de sous-agent, COÛT : MOYEN). Rien d'essayé en réel : le workflow n'existe sur GitHub que dans la branche.
Choix prudents pris sans le président (absent) :
- Rien fusionné dans `main` ; `heure.yml` n'est donc pas encore utilisable depuis `main`.
- Doc GitHub : « Run workflow » décrit pour le site, pas pour l'app mobile → repli sur le navigateur (version ordinateur), écrit dans MODE-D-EMPLOI §5.
- Heure saisie seulement pour un match existant dans `data.json` ; la suppression reste possible même si le match a disparu.
- `dejaJoue` (« Résultat pas encore publié ») n'utilise que l'heure de FFvolley, jamais la saisie.  Mention : « saisie VBG » (choix par défaut).
Pour livrer : fusionner ; 1) lancer UNE collecte manuelle (MODE-D-EMPLOI §1) et vérifier qu'elle démarre et passe au vert (`queue: max` est nouveau dans `collecte.yml`) ; 2) seulement ensuite saisir une heure sur un match « Heure à confirmer » du 21/11 (runs « Ajouter une heure » puis « Collecte » verts), puis la supprimer. Coupes non concernées (hors périmètre).

## Reste à faire, dans l'ordre
1. Vérifier le passage planifié du vendredi 20/11 à 18 h (onglet Actions) et celui du dimanche 22/11 (résultat de la N3M à Rennes).
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
- Décisions ouvertes : historique Git de `main` (vrais noms d'arbitres dans `ebf790f`), adresse et propriétaire du dépôt, rappel d'agenda fin août 2027.
- Défauts mineurs connus : plafond de 5 résultats par carte, ordre à égalité de date, page ouverte non recalculée avant retour au premier plan.
- Crochets git : `git config core.hooksPath .githooks` à refaire sur toute nouvelle copie du dépôt.
- JMJ (Coupe de France M21) volontairement ignorée (`IGNOREES`).
