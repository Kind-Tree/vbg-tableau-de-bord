#!/usr/bin/env python3
"""Anonymise les pages FFvolley enregistrées pour les tests : les noms d'arbitres sont remplacés par
« ARBITREnnn TEST ». Aucun vrai nom d'arbitre ne doit entrer dans le dépôt.

Les arbitres sont dans une cellule de la ligne de match, à deux emplacements selon la page :
  - page club : <td class='liengris_pt'>NOM / NOM</td> juste avant <td></td></tr> ;
  - page de poule : <td class='liengris_pt' align='left'>NOM/NOM</td> juste après la cellule des points « 075-059 ».
Les cellules vides (matchs sans arbitre) ne bougent pas.

Usage : python tests/anonymiser.py brut.html [sortie.html]   (sans sortie : le fichier est réécrit)
"""
import re
import sys

# Cellule d'arbitres : texte non vide, à l'un des deux emplacements ci-dessus (groupes : début, noms, fin).
MOTIFS = [
    re.compile(rb"(<td class='liengris_pt'>)([^<]+)(</td><td></td></tr>)"),
    re.compile(rb"(class='liensuite4_pt'>\d+-\d+</td><td class='liengris_pt'[^>]*>)([^<]+)(</td>)"),
]


def anonymiser(octets, depart=500):
    """Retourne (octets anonymisés, nombre de cellules remplacées). Même nom -> même pseudo dans la page."""
    pseudos = {}

    def pseudo(nom):
        if nom not in pseudos:
            pseudos[nom] = b"ARBITRE%d TEST" % (depart + len(pseudos))
        return pseudos[nom]

    def remplacer(m):
        morceaux = re.split(rb"(\s*/\s*)", m.group(2))  # noms et séparateurs (le séparateur reste tel quel)
        return m.group(1) + b"".join(
            x if i % 2 else (pseudo(x.strip()) if x.strip() else x) for i, x in enumerate(morceaux)) + m.group(3)

    n = 0
    for motif in MOTIFS:
        octets, k = motif.subn(remplacer, octets)
        n += k
    return octets, n


def main(argv):
    src = argv[1]
    dst = argv[2] if len(argv) > 2 else src
    with open(src, "rb") as f:
        brut = f.read()
    sortie, n = anonymiser(brut)
    with open(dst, "wb") as f:
        f.write(sortie)
    print("%s : %d cellule(s) d'arbitres remplacée(s) -> %s" % (src, n, dst))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
