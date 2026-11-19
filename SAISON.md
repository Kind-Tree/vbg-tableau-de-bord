# Changement de saison : marche à suivre

Pour le président. Aucune connaissance en programmation nécessaire : tu donnes une consigne à Claude Code, tu lis un rapport, tu dis oui ou non.

Les durées sont des estimations, pas des mesures : elles n'ont jamais été chronométrées sur un vrai changement de saison.

## Pourquoi c'est nécessaire

Le tableau de bord lit les pages FFvolley d'une saison précise (aujourd'hui **2026/2027**). Chaque nouvelle saison change :

- la saison elle-même (une seule ligne dans `collect.py`, la constante `SAISON`) ;
- les codes des poules (par exemple « 3MF » pour la N3M) et parfois l'entité qui les organise ;
- le nom exact du club dans chaque poule (« ST GREGOIRE 2 », « VB GREGORIEN »…) ;
- le nombre d'équipes engagées.

Changer la saison seule ne suffit presque jamais : les codes de poule changent aussi. Il ne faut donc pas modifier une seule ligne à la main.

## Quand s'en occuper

À prévoir **fin août ou début septembre**, quand FFvolley publie les poules de la nouvelle saison (la date exacte n'est pas connue : à confirmer sur la page du club).

Signaux qui peuvent te le rappeler (mais qui peuvent aussi ne jamais venir, voir l'étape 1) :

- la page affiche « Données anciennes : dernière collecte il y a N jours » (aucune collecte réussie depuis plus de 5 jours) ;
- tu reçois un e-mail d'échec de GitHub ;
- des cartes portent la mention « Non lu ». **Attention** : à ce moment-là, ces cartes montrent les résultats de la saison précédente ; la mention « Dernières données connues du … » donne leur date.

## Les étapes

| # | Étape | Qui | Durée estimée |
|---|---|---|---|
| 1 | Vérifier que la nouvelle saison est ouverte | toi | 5 min |
| 2 | Lancer Claude Code avec la consigne ci-dessous | toi | 2 min |
| 3 | Lire le diagnostic et répondre aux questions de Claude | toi | 10 à 20 min |
| 4 | Claude adapte la configuration, met à jour les pages de test et lance les tests | Claude | 30 à 60 min |
| 5 | Essai de collecte et vérification de la page | Claude puis toi | 10 min |
| 6 | Ton accord, puis publication | toi | 5 min |

Total : environ 1 h à 1 h 30, dont 20 à 30 minutes de ton temps.

### 1. Vérifier que la saison est ouverte

Cette page n'affiche pas la saison en toutes lettres : ne cherche pas à la lire. Demande simplement à Claude Code de lancer `python collect.py --diagnostic` (rien n'est écrit, 1 minute) : la première ligne donne la saison que la page club affiche.

- Si elle indique encore 2026/2027 (la saison configurée), attends quelques jours : FFvolley n'a pas fini de publier. Ne change rien.
- Si elle indique une nouvelle saison, passe à l'étape 2.

Aucun signal automatique ne te prévient dans ce cas : tant que FFvolley garde les pages de l'ancienne saison, les collectes réussissent et le site continue d'afficher l'ancienne saison sans alerte. **Mets un rappel dans ton agenda pour la fin août.**

### 2. La consigne à donner à Claude Code

Ouvre Claude Code dans le dossier du projet (`volley-vbg`) et colle :

```
Changement de saison : la nouvelle saison est AAAA/AAAA (à remplacer).
Lis SAISON.md et CADRAGE.md. Travaille sur une branche à part, ne pousse rien.
1. Lance « python collect.py --diagnostic » et montre-moi le rapport en français simple.
2. Propose la nouvelle configuration (saison, codes de poule, entités, noms du club) sans rien inventer :
   pour tout ce que tu ne peux pas lire sur les pages FFvolley, pose-moi la question.
3. Après mon accord : mets à jour collect.py, les pages de test et les tests, régénère la copie de secours
   (SECOURS) de docs/index.html avec regenerer_secours.py, à partir de la collecte d'essai, lance les deux suites de tests,
   puis une seule collecte d'essai vers un fichier temporaire, hors de docs/.
4. Fais relire le résultat par le sous-agent checker, puis dis-moi précisément ce que je dois faire pour publier.
```

### 3. Lire le diagnostic

La commande `python collect.py --diagnostic` lit seulement deux pages de FFvolley (la page club et la page hebdomadaire) et compare avec la configuration. **Elle n'écrit aucun fichier**, y compris `docs/data.json`. Elle se termine par :

- **« Aucun écart »** : la configuration correspond aux pages du club (code de sortie 0) ;
- **des lignes `ECART`** : à traiter avant de publier (code de sortie 2) ;
- **une page illisible** (téléchargement impossible) : réessaie plus tard (code de sortie 1) ;
- **« diagnostic impossible »** : les pages se sont téléchargées mais la page club n'a plus la forme attendue (FFvolley a changé sa présentation). Code de sortie 2 : ne rien publier, demande à Claude Code de regarder la page.

Sens des lignes :

| Ligne | Sens |
|---|---|
| `OK` | la poule est présente sur la page club, avec la bonne saison et la bonne entité |
| `NOTE … vue seulement sur la page hebdo` | les coupes (France, Bretagne) n'apparaissent que sur la page hebdomadaire : la poule existe, mais **la saison et l'entité ne sont pas vérifiées**. À contrôler à la première collecte |
| `NOTE … absente` | une équipe suit deux poules à tour de rôle (M18M région) et l'une est absente : normal en changement de phase |
| `ECART … absente` | la poule configurée n'existe plus : son code a changé ou l'équipe n'est plus engagée |
| `ECART … présente mais autrement` | même code mais autre saison ou autre entité |
| `ECART … la saison de la page club` | la page club affiche déjà une autre saison que la configuration : c'est le signal attendu au changement de saison |
| `ECART … compétition non suivie` | une poule existe pour le club mais n'est pas dans la configuration : nouvelle équipe ou nouvelle coupe. Elle n'est jamais ajoutée toute seule |

Le diagnostic ne vérifie pas le **nom du club à l'intérieur de chaque poule** : cela se voit à la première collecte, où une poule mal nommée devient « Non lu » (raison « club absent du classement », ou « aucun match du club dans … » quand le classement n'est pas encore publié).

Les options `--only` et `--out` sont ignorées avec `--diagnostic`, qui n'écrit jamais rien.

### 4 et 5. Ce que fait Claude, ce que tu regardes

Claude modifie `SAISON`, les listes `EQUIPES` et `COUPES` et les libellés (par exemple « Nationale 3 masculine · Poule F », écrit en dur pour la N3M et la PRM), enregistre de nouvelles pages de test et relance les tests.

À connaître :

- Les pages de test et les tests actuels portent sur 2026/2027. Tant qu'ils ne sont pas mis à jour, le workflow « Tests » de GitHub passe au rouge : c'est attendu et sans effet sur la collecte (le workflow de collecte ne lance aucun test).
- La copie de secours intégrée à `docs/index.html` (utilisée seulement au premier chargement sans réseau) garde les données de l'ancienne saison tant qu'elle n'est pas régénérée : Claude le fait à la fin.
- Si toutes les poules échouent, rien n'est écrit dans `data.json` : le site garde l'ancien contenu et finit par afficher « Données anciennes ».

Sur la page d'essai, vérifie à l'œil : le nom des équipes, leur rang, le prochain match de la N3M. Si un chiffre te paraît faux, ne publie pas.

### 6. Publication

Claude te donne la marche exacte (fusion de la branche dans `main` puis envoi). Rien n'est publié sans ton accord. Après publication : lance une collecte à la main (voir `MODE-D-EMPLOI.md`), puis vérifie la page sur ton téléphone.

## Changement de phase (janvier)

Certaines poules changent **en cours de saison** : les poules jeunes (M18M région : CPN puis CPE, par exemple) passent en janvier à une nouvelle phase, avec un nouveau code de poule. C'est un petit changement de saison : le robot le détecte tout seul, mais c'est toi qui décides quoi en faire.

### Comment tu t'en rends compte

À la première collecte après le changement, GitHub t'envoie un e-mail « Run failed : Collecte FFvolley ». Dans l'étape « Collecte », tu lis une ligne de ce genre :

```
ECHEC contrôle : poule non configurée CPF - M18M performance poule F (https://www.ffvbbeach.org/…poule=CPF), match du 10/01
```

Elle donne le **code**, le **titre** et l'**adresse** de la poule que FFvolley liste pour le club et que la configuration ne connaît pas. Les autres équipes restent à jour et publiées : seule la poule nouvelle manque. Tant que rien n'est fait, chaque collecte reste « rouge » : c'est voulu, pour que tu ne l'oublies pas.

D'autres lignes `ECHEC contrôle` possibles :

| Ligne | Sens |
|---|---|
| `match XXX0NN du JJ/MM listé par FFvolley, absent de la poule XXX` | FFvolley annonce pour le club un match que la poule lue ne contient pas : date ou poule changée, page en retard. Relance une collecte une heure plus tard ; si le message revient, demande à Claude Code de regarder |
| `page club illisible, contrôle impossible` | FFvolley n'a pas répondu à la vérification. Relance une collecte plus tard |

### Les deux issues pour une poule signalée

1. **La suivre** : Claude Code l'ajoute à la configuration (`EQUIPES` ou `COUPES` dans `collect.py`). Le nom exact du club dans cette poule (« ST GREGOIRE 2 », « VB GREGORIEN »…) n'est jamais deviné : Claude le lit sur la page de la poule et te pose la question en cas de doute. Pour une équipe qui change de phase, la nouvelle poule s'ajoute **en seconde position** de la même équipe : la page affiche la poule où le club a des matchs, et les résultats des deux phases sont fusionnés.
2. **L'ignorer** : si tu ne veux pas la suivre (par exemple une coupe qui ne t'intéresse pas), Claude Code l'ajoute à la liste `IGNOREES`. Elle n'est plus jamais signalée.

### La consigne à donner à Claude Code

```
Une poule a changé en cours de saison. Message du robot : <colle ici la ligne « ECHEC contrôle »>.
Lis SAISON.md (section « Changement de phase (janvier) »). Travaille sur une branche à part, ne pousse rien.
1. Lance « python collect.py --diagnostic » et explique-moi le rapport en français simple.
2. Propose soit l'ajout de la poule à la configuration, soit son ajout à IGNOREES, sans rien inventer :
   pose-moi la question pour tout ce que tu ne peux pas lire sur la page de la poule.
3. Après mon accord : modifie collect.py, enregistre la page de la poule dans tests/fixtures (anonymisée avec
   tests/anonymiser.py), ajoute les tests, lance les deux suites, puis une collecte d'essai vers un fichier
   temporaire, hors de docs/ (option --out). Régénère la copie de secours avec regenerer_secours.py.
4. Fais relire le résultat par le sous-agent checker, puis dis-moi précisément ce que je dois faire pour publier.
```

Durée estimée (jamais chronométrée) : 30 à 60 minutes, dont 10 minutes de ton temps. Rien n'est publié sans ton accord ; ne rien faire est sans danger (le site garde ses dernières données).

## En cas de doute

- Ne rien publier est toujours sans danger : le site reste en ligne avec ses dernières données et la ligne « Données anciennes » prévient les lecteurs.
- Une collecte lancée par erreur avec une mauvaise configuration ne peut pas vider le site (une poule illisible garde ses dernières données, marquées « non lu »), mais elle peut afficher les anciens résultats sous la mention « Non lu ».
