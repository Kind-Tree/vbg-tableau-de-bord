# ETAT : chantier en cours

Mis à jour à la fin de chaque tâche. Le stable est dans CLAUDE.md.

## Chantier « Programme » et « Poule »
Branche `programme-poule`. Rien n'est fusionné sur main avant le feu vert du président (après les passages du 20 et du 22/11).
Plan complet : `C:\Users\samue\.claude\plans\co-t-lourd-lis-swirling-reef.md`
- [x] 1 préparation (branche, ETAT.md)
- [x] 2 pages de test anonymisées
- [x] 3 collect.py (exempt, poules, contrôle page club) : 124 tests Python, 9 mutations détectées
- [x] 4 vue Programme : 108 tests Node, 18 mutations détectées, vérifiée à 360 px sur données réelles
- [x] 5 vue Poule (#poule-<équipe>) : 109 tests Node, 34 mutations détectées au total, bloc « Calendrier » retiré
- [x] 6 essai réel (code 0, contrôle page club OK) et SECOURS régénérée sans « poules » (regenerer_secours.py)
- [ ] 7 relecture
- [ ] 8 livraison (CLAUDE.md, SAISON.md, liste iPhone)

## En attente / à surveiller
- Vendredi 20/11/2026 18 h : premier passage planifié jamais exécuté (vérifier l'onglet Actions). Dimanche 22/11 : résultat de la N3M à Rennes.
- Non vérifiés : e-mail d'échec réel, rendu iPhone (blocs « Calendrier », « Semaine dernière », « Données anciennes »).
- Décisions ouvertes : garder le bloc « Calendrier » (sera remplacé par la vue Poule), historique Git (vrais noms d'arbitres dans `ebf790f`), adresse et propriétaire du dépôt, rappel d'agenda fin août 2027.
- Défauts mineurs connus : plafond de 5 résultats par carte, ordre à égalité de date, page ouverte non recalculée avant retour au premier plan, SECOURS à régénérer à la main.
