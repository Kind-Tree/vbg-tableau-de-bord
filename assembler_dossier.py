"""Assemble dossier_revue/ (local, hors Git) à joindre à une conversation avec le conseiller."""
import os, re
ICI = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(ICI, "dossier_revue")
os.makedirs(D, exist_ok=True)
def lire(p): return open(os.path.join(ICI, p), encoding="utf-8").read()
def ecrire(nom, txt):
    open(os.path.join(D, nom), "w", encoding="utf-8", newline="\n").write(txt)
def concat(fichiers):
    return "".join("\n\n===== %s =====\n\n%s" % (f, lire(f)) for f in fichiers if os.path.exists(os.path.join(ICI, f)))
def section(txt, titre_re):
    m = re.search(r"^## (%s).*?(?=^## |\Z)" % titre_re, txt, re.S | re.M)
    return m.group(0).strip() if m else ""
etat = lire("ETAT.md")
regles = section(lire("CLAUDE.md"), "Règles de données")
ouverture = """# Message d'ouverture

## LE PROJET
Tableau de bord web mobile du Volley-Ball Grégorien (VBG) : programme des matchs, fiche par équipe, poules et classements.
Un collecteur Python lit les pages FFvolley et écrit docs/data.json ; la page docs/index.html (sans dépendance) est publiée par GitHub Pages.
Je suis le président du club, non développeur : je teste et je valide chaque étape.

## TON RÔLE
Trier mes retours, faire les calculs, rédiger mes consignes pour Claude Code dans un bloc à copier.

## FORMAT DES CONSIGNES
Première ligne « COÛT : » : LÉGER (aucun sous-agent, aucune vérification, moins de 10 min), MOYEN (pas de sous-agent, banc limité, une consultation du conseiller, 10 à 30 min) ou LOURD (seulement avec /brain, un seul objectif). Un seul changement par problème. Un /clear entre deux tâches.

## MON ORGANISATION
Sonnet avec Opus en conseiller, /brain pour le lourd, une seule session par dossier.

## RÈGLES PROPRES AU PROJET
(extrait de CLAUDE.md ; le détail est dans 1_ETAT.md)
""" + regles + """

## ÉTAT
""" + (section(etat, "Chantier « Heures") or etat[:1500]) + """

## POINTS EN SUSPENS
""" + section(etat, "En attente") + """

Réponses courtes, en français, en me tutoyant.
"""
ecrire("0_MESSAGE_OUVERTURE.md", ouverture)
ecrire("1_ETAT.md", concat(["ETAT.md", "CLAUDE.md", "INSTALLATION.md", "IDEES.md"]))
ecrire("2_DOCUMENTS.md", concat(["MODE-D-EMPLOI.md", "SAISON.md"]))
ecrire("3_SOURCES.md", concat(["collect.py", "heures.py", "regenerer_secours.py", "docs/index.html",
    ".github/workflows/collecte.yml", ".github/workflows/heure.yml", ".github/workflows/tests.yml"]))
for n in sorted(os.listdir(D)): print(n, os.path.getsize(os.path.join(D, n)) // 1024, "Ko")
