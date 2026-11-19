#!/usr/bin/env python3
"""Refuse tout noms d'arbitre en clair dans les pages de test (tests/**/*.html) avant qu'ils quittent la machine.

Appelé par les crochets git (.githooks/pre-commit et .githooks/pre-push). Ne lit que le contenu git (fichiers indexés,
ou fichiers des commits envoyés), pas le dossier de travail, et n'affiche JAMAIS un nom : seulement le fichier et le
nombre de cellules en cause.

Usage : python tests/verifier_arbitres.py --index                 (fichiers indexés, pour pre-commit)
        python tests/verifier_arbitres.py --commits A..B [...]    (commits envoyés, pour pre-push)
        option --depot DIR : dépôt à contrôler (défaut : dossier courant)
Code de sortie : 0 = rien en clair, 1 = noms en clair (commit ou envoi à bloquer), 2 = erreur d'utilisation.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anonymiser  # noqa: E402


def git(depot, *args):
    r = subprocess.run(["git", "-C", depot, *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("git %s : %s" % (" ".join(args), r.stderr.decode("utf-8", "replace").strip()))
    return r.stdout


def est_page_de_test(chemin):
    return chemin.startswith("tests/") and chemin.endswith(".html")


def en_cause_dans_index(depot):
    """[(chemin, nombre de cellules d'arbitres en clair)] pour les pages de test ajoutées ou modifiées dans l'index."""
    noms = git(depot, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").decode("utf-8", "replace")
    out = []
    for chemin in [c for c in noms.split("\0") if est_page_de_test(c)]:
        n = len(anonymiser.en_clair(git(depot, "show", ":" + chemin)))
        if n:
            out.append((chemin, n))
    return out


def en_cause_dans_commits(depot, plage):
    """[(commit, chemin, nombre)] pour chaque page de test touchée par les commits de `plage` (ex. « origine..HEAD »)."""
    out = []
    for c in git(depot, "rev-list", *plage.split()).decode().split():
        noms = git(depot, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-m", "-z", c).decode("utf-8", "replace")
        for chemin in [x for x in noms.split("\0") if est_page_de_test(x)]:
            try:
                n = len(anonymiser.en_clair(git(depot, "show", "%s:%s" % (c, chemin))))
            except RuntimeError:
                continue  # fichier supprimé par ce commit
            if n:
                out.append((c[:7], chemin, n))
    return out


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # accents lisibles quelle que soit la console
    depot = "."
    args = list(argv[1:])
    if "--depot" in args:
        i = args.index("--depot")
        depot = args[i + 1]
        del args[i:i + 2]
    try:
        if args[:1] == ["--index"]:
            trouves = [("indexé", c, n) for c, n in en_cause_dans_index(depot)]
        elif args[:1] == ["--commits"] and len(args) > 1:
            trouves = [x for plage in args[1:] for x in en_cause_dans_commits(depot, plage)]
        else:
            print(__doc__)
            return 2
    except RuntimeError as e:
        print("verifier_arbitres : erreur :", e)
        return 2
    for ou, chemin, n in trouves:
        print("BLOQUÉ : %s, %s : %d cellule(s) d'arbitres en clair (anonymiser avec tests/anonymiser.py)" % (ou, chemin, n))
    if trouves:
        print("Aucun nom n'est affiché ici. Anonymise la page avec « python tests/anonymiser.py <page.html> » puis recommence.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
