# Détail du projet (déplacé de CLAUDE.md)

Lecture à la demande : sources FFvolley, décisions prises, pièges rencontrés. Les règles à respecter en permanence restent dans CLAUDE.md.

## Sources FFvolley et GitHub (repris des archives)
- Poule : `https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=<SAISON>&codent=<ENTITE>&poule=<CODE>&calend=COMPLET` ; page club (classements, formulaires saison/entité/poule) : `.../planning_club_class.php?cnclub=0357988` ; hebdo : `.../planning_club.php?cnclub=0357988`. Contrôle de saison et poules non suivies.
- User-Agent : `VBG-tableau-de-bord/1.0 (club amateur Saint-Gregoire; releve hebdomadaire)`. Garde d'identité : le code de match commence par le code de poule et le nom du club correspond exactement.
- Formats FFvolley réels jamais observés : forfait, pénalité, match reporté (à vérifier à la première occurrence).
- GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans activité (doc). Les commits du robot comptent-ils ? Non documenté. Risque : collecte en échec partout = aucun commit = coupure possible. Une collecte réussie commite toujours (`maj` change). Les workflows planifiés ne tournent que sur `main`, avec retards possibles. E-mail d'échec : va à la dernière personne qui a modifié le `cron` (compte `Kind-Tree`) ; réglage « échecs seulement » : Settings, Notifications, Actions (de mémoire).
- Dépôt public voulu (Pages gratuit exige un dépôt public). Historique de `main` : voir IDEES.md.

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
