#!/usr/bin/env python3
"""Régénère la copie de secours (SECOURS) de docs/index.html à partir d'un data.json.

La copie de secours ne sert qu'au premier chargement hors ligne. Pour que la page reste légère, elle est écrite
SANS le champ « poules » (toute la saison de chaque poule : l'essentiel du poids). Hors ligne au premier chargement,
le Programme se reconstruit alors à partir de avenir / resultats / attente, et la vue Poule dit d'attendre la collecte.

Usage : python regenerer_secours.py chemin/vers/data.json [docs/index.html]
"""
import json
import re
import sys
from datetime import datetime


def secours_depuis(data):
    """Copie allégée de data.json : mêmes champs, sans « poules »."""
    copie = dict(data)
    for cle in ("equipes", "coupes"):
        copie[cle] = [{k: v for k, v in e.items() if k != "poules"} for e in data.get(cle, [])]
    return copie


def regenerer(texte_html, data):
    """Retourne le HTML dont la ligne « const SECOURS=… » et le commentaire qui la précède sont remplacés."""
    copie = secours_depuis(data)
    ligne = "const SECOURS=" + json.dumps(copie, ensure_ascii=False, separators=(",", ":")) + ";"
    jour = datetime.fromisoformat(data["maj"]).strftime("%d/%m/%Y")
    commentaire = ("// Données de secours : copie de data.json du %s (toutes les équipes, sans le champ « poules » pour rester légère), "
                   "à régénérer avec regenerer_secours.py." % jour)
    sortie, n = re.subn(r"^const SECOURS=.*;[ \t]*$", lambda m: ligne, texte_html, count=1, flags=re.M)
    if n != 1:
        raise ValueError("ligne « const SECOURS=… » introuvable dans la page")
    sortie, n = re.subn(r"^// Données de secours :.*$", lambda m: commentaire, sortie, count=1, flags=re.M)
    if n != 1:
        raise ValueError("commentaire « Données de secours » introuvable dans la page")
    return sortie


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    page = argv[2] if len(argv) > 2 else "docs/index.html"
    with open(argv[1], encoding="utf-8") as f:
        data = json.load(f)
    with open(page, "rb") as f:
        brut = f.read().decode("utf-8")
    fin = "\r\n" if "\r\n" in brut else "\n"
    nouveau = regenerer(brut.replace("\r\n", "\n"), data).replace("\n", fin)
    with open(page, "wb") as f:
        f.write(nouveau.encode("utf-8"))
    print("SECOURS régénérée (%d octets au total) -> %s" % (len(nouveau.encode("utf-8")), page))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
