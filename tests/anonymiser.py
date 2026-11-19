#!/usr/bin/env python3
"""Anonymise les pages FFvolley enregistrées pour les tests : les noms d'arbitres sont remplacés par
« ARBITREnnn TEST ». Aucun vrai nom d'arbitre ne doit entrer dans le dépôt.

Les arbitres sont dans la dernière cellule d'une ligne de match : <td class='liengris_pt'>NOM / NOM</td>
juste avant <td></td></tr>. Les cellules vides (poules, matchs sans arbitre) ne bougent pas.

Usage : python tests/anonymiser.py brut.html [sortie.html]   (sans sortie : le fichier est réécrit)
"""
import re
import sys

# Cellule d'arbitres : texte non vide entre <td class='liengris_pt'> et </td><td></td></tr>.
MOTIF = re.compile(rb"(<td class='liengris_pt'>)([^<]+)(</td><td></td></tr>)")


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

    sortie, n = MOTIF.subn(remplacer, octets)
    return sortie, n


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
