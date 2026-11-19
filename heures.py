"""Ajoute, remplace ou supprime une heure de match saisie par le club (workflow « Ajouter une heure »).

Les trois valeurs viennent de variables d'environnement (jamais de la ligne de commande) :
  HEURE_EQUIPE  nom exact d'une équipe de collect.EQUIPES
  HEURE_DATE    JJ/MM (l'année se déduit de la saison)
  HEURE_HEURE   HH:MM, ou vide pour supprimer la saisie de ce jour
Validation stricte : à la moindre erreur, code 1 et rien n'est écrit. Bibliothèque standard uniquement."""
import json
import os
import re
import sys
from datetime import date

import collect

ICI = os.path.dirname(os.path.abspath(__file__))
CHEMIN_HEURES = os.path.join(ICI, "heures.json")
CHEMIN_DATA = os.path.join(ICI, "docs", "data.json")


class SaisieRefusee(Exception):
    pass


def annee_de(mois):
    """Saison « 2026/2027 » : août à décembre dans la première année, janvier à juillet dans la seconde."""
    a, b = (int(x) for x in collect.SAISON.split("/"))
    return a if mois >= 8 else b


def date_iso(texte):
    m = re.fullmatch(r"(\d\d)/(\d\d)", texte, re.ASCII)
    if not m:
        raise SaisieRefusee("date : écrire JJ/MM (par exemple 21/11)")
    jour, mois = int(m.group(1)), int(m.group(2))
    try:
        return date(annee_de(mois), mois, jour).isoformat()
    except ValueError:
        raise SaisieRefusee("date impossible : %s" % texte)


def valider(equipe, date_txt, heure_txt, data):
    """(équipe, date ISO, heure ou None). None = suppression. Lève SaisieRefusee."""
    equipe, date_txt, heure_txt = (equipe or "").strip(), (date_txt or "").strip(), (heure_txt or "").strip()
    if equipe not in {e["nom"] for e in collect.EQUIPES}:
        raise SaisieRefusee("équipe inconnue")
    iso = date_iso(date_txt)
    if heure_txt == "":
        return equipe, iso, None
    if not collect.RE_HEURE.fullmatch(heure_txt):
        raise SaisieRefusee("heure : écrire HH:MM (par exemple 18:30)")
    entree = next((e for e in data.get("equipes", []) if e.get("nom") == equipe), None)
    if not entree or not collect.matchs_du_jour(entree, iso):
        raise SaisieRefusee("%s n'a pas de match le %s dans data.json" % (equipe, date_txt))
    return equipe, iso, heure_txt


def mettre_a_jour(saisies, equipe, iso, heure, saisie):
    """Nouvelle liste : une seule ligne par (équipe, jour). Heure None : supprime (refus s'il n'y en a pas)."""
    reste = [s for s in saisies if not (s["equipe"] == equipe and s["date"] == iso)]
    if heure is None:
        if len(reste) == len(saisies):
            raise SaisieRefusee("aucune heure saisie à supprimer pour %s le %s" % (equipe, iso))
        return reste
    reste.append({"equipe": equipe, "date": iso, "heure": heure, "saisie": saisie})
    return sorted(reste, key=lambda s: (s["date"], s["equipe"]))


def executer(env, chemin_heures, chemin_data, maintenant=None):
    """Applique une saisie. Renvoie le message à afficher ; lève SaisieRefusee sans rien écrire."""
    try:
        with open(chemin_data, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        raise SaisieRefusee("data.json illisible")
    equipe, iso, heure = valider(env.get("HEURE_EQUIPE"), env.get("HEURE_DATE"), env.get("HEURE_HEURE"), data)
    try:
        saisies = collect.charger_heures(chemin_heures)
    except ValueError as e:
        raise SaisieRefusee(str(e))  # on n'écrit jamais par-dessus un fichier illisible
    stamp = (maintenant or collect.maintenant_paris()).isoformat(timespec="minutes")
    neuf = mettre_a_jour(saisies, equipe, iso, heure, stamp)
    collect.ecrire_atomiquement(chemin_heures, neuf)
    return ("Heure supprimée : %s le %s" % (equipe, iso)) if heure is None else \
        "Heure enregistrée : %s le %s à %s" % (equipe, iso, heure)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(executer(os.environ, CHEMIN_HEURES, CHEMIN_DATA))
    except SaisieRefusee as e:
        print("REFUSE :", e)
        if os.environ.get("GITHUB_ACTIONS"):
            print("::error::Heure refusée : %s" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
