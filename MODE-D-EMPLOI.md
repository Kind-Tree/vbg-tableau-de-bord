# Tableau de bord VBG : mode d'emploi (une page)

Site : <https://kind-tree.github.io/vbg-tableau-de-bord/> · Collectes automatiques : vendredi 18 h, dimanche 9 h, 21 h et 23 h, lundi 7 h (heure de Paris).

> **Valable après publication du lot 3 et de la nuit du 16/11/2026.** Avant, il n'y a ni passage du vendredi et du dimanche matin, ni e-mail d'alerte pour une poule non lue, ni ligne « Données anciennes ».

## 1. Lancer une collecte à la main (2 minutes, depuis le téléphone)

1. Ouvre <https://github.com/Kind-Tree/vbg-tableau-de-bord/actions/workflows/collecte.yml> dans le navigateur du téléphone, connecté à GitHub.
2. Touche **Run workflow**, laisse la branche **main**, touche **Run workflow** (le bouton vert).
3. Attends 3 à 5 minutes (le collecteur fait des pauses de 2 secondes entre les pages). Une pastille verte = terminé.
4. Sur la page du tableau de bord, touche **Actualiser**.

*À confirmer : la doc GitHub décrit ce bouton pour le site web, pas pour l'application GitHub Mobile. Utilise le navigateur ; si le bouton manque, demande la « version pour ordinateur » du site.*

## 2. Tu reçois un e-mail « Run failed : Collecte FFvolley »

1. Touche le lien du message, puis l'étape rouge. Lis les lignes `ECHEC …` : elles disent quelle équipe n'a pas pu être lue, et pourquoi.
2. Cas habituel : FFvolley est indisponible ou lent. **Attends 1 heure, relance une collecte (§1).** Si elle est verte, c'est réglé.
3. Si le même message revient à **deux collectes de suite**, ou si on est en début de saison (fin août, septembre) : la saison a sans doute changé. Suis `SAISON.md`.
4. Étape « Collecte » rouge (et non « Alerte ») : rien n'a été publié, le site garde ses dernières données. Même conduite.
5. Ligne `ECHEC contrôle : poule non configurée …` (avec un code, un titre et une adresse) : FFvolley liste pour le club une poule que la configuration ne connaît pas, typiquement au changement de phase de janvier. Les autres équipes sont à jour et publiées. Suis `SAISON.md`, section « Changement de phase (janvier) », qui explique aussi les autres lignes `ECHEC contrôle` (match absent, page club illisible).

*Tu ne reçois cet e-mail que si les notifications d'Actions sont activées dans ton compte GitHub (Settings, Notifications, rubrique Actions ; case « échecs seulement » : chemin donné de mémoire, à vérifier à l'écran une fois). L'e-mail va à la personne qui a créé le workflow ou modifié en dernier ses lignes `cron`.*

## 3. Une carte porte la mention « Non lu »

La carte montre les **dernières données connues**, avec leur date (« Dernières données connues du … ») : ce ne sont pas des données de ce soir.
1. Relance une collecte (§1) et actualise la page.
2. Si la mention reste après deux collectes, la raison est écrite dans l'étape « Collecte » (§2). Si elle contient « club absent du classement » ou « page d'une autre poule », la poule a changé : demande à Claude Code de lancer `python collect.py --diagnostic` (rien n'est écrit) et de t'expliquer le rapport.
3. Ne rien faire est sans danger : les autres cartes restent à jour.

## 4. La page affiche « Données anciennes : dernière collecte il y a N jours »

Aucune collecte n'a réussi depuis plus de 5 jours. C'est le seul signal quand une collecte planifiée saute.
1. Ouvre l'onglet **Actions** du dépôt : y a-t-il des exécutions récentes ?
2. **Aucune récente, ou le workflow apparaît désactivé** (GitHub désactive les workflows planifiés après 60 jours sans activité sur un dépôt public) : touche **Enable workflow**, puis lance une collecte (§1).
3. **Des exécutions rouges** : c'est le §2.
4. **Des exécutions vertes mais la page reste ancienne** : touche **Actualiser** ; si la ligne reste, demande à Claude Code de vérifier `docs/data.json` sur GitHub.

## À retenir

- Rien de ce que tu fais ici ne peut vider le site : une poule illisible garde ses dernières données.
- Changement de saison (fin août, début septembre) : `SAISON.md`.
- Doute : ne touche à rien et ouvre Claude Code dans le dossier du projet.
