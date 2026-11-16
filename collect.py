#!/usr/bin/env python3
"""Collecte des poules FFvolley du VBG -> data.json (bibliothèque standard seulement).

Règles : rien n'est inventé ; une poule illisible garde ses dernières données
connues (marquées « nonlu ») ; data.json n'est jamais écrasé par un fichier
vide ou partiel ; une requête par poule, avec pause et User-Agent identifiable.
Les compétitions présentes sur les pages club et hebdo mais absentes de la
configuration sont listées dans data.json (« nonsuivies »), jamais ajoutées.

Usage : python collect.py [--only N3M,PRM,COM] [--out data.json]
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

SAISON = "2026/2027"
BASE = "https://www.ffvbbeach.org/ffvbapp/resu/"
URL_CLUB = BASE + "planning_club_class.php?cnclub=0357988"
URL_HEBDO = BASE + "planning_club.php?cnclub=0357988"
URL_POULE = BASE + "vbspo_calendrier.php?saison=" + SAISON + "&codent={ent}&poule={code}&calend=COMPLET"
USER_AGENT = "VBG-tableau-de-bord/1.0 (club amateur Saint-Gregoire; releve hebdomadaire)"
PAUSE = 2.0
NB_RESULTATS = 5

VBG = "VOLLEY BALL GREGORIEN"


def _p(code, ent, club):
    return {"code": code, "ent": ent, "club": club}


# Configuration par équipe : jamais de recherche approximative.
# "poules" : par ordre de priorité. Pour une équipe qui change de phase (M18M région),
# la poule active est la première où le club a des matchs ; les résultats sont fusionnés.
EQUIPES = [
    # seniors
    {"nom": "N3M", "poules": [_p("3MF", "ABCCS", VBG)], "libelle": "Nationale 3 masculine · Poule F"},
    {"nom": "PNF", "poules": [_p("PNF", "LIBR", VBG)]},
    {"nom": "PRM", "poules": [_p("1PM", "PTBR35", "ST GREGOIRE 2")],
     "libelle": "Pré-régionale masculine · ST GREGOIRE 2"},
    {"nom": "D1F", "poules": [_p("D1F", "PTBR35", "ST GREGOIRE 2")]},
    {"nom": "D2M", "poules": [_p("DMA", "PTBR35", "ST GREGOIRE 3")]},
    # jeunes, du plus âgé au plus jeune
    {"nom": "M18M région", "poules": [_p("CPN", "LIBR", VBG), _p("CPE", "LIBR", VBG)]},
    {"nom": "M18M départemental", "poules": [_p("HCB", "PTBR35", "ST GREGOIRE")]},
    {"nom": "M18F 1", "poules": [_p("CMD", "PTBR35", "ST GREGOIRE 1")]},
    {"nom": "M18F 2", "poules": [_p("CHB", "PTBR35", "ST GREGOIRE 2")]},
    {"nom": "M15F", "poules": [_p("MCF", "PTBR35", "ST GREGOIRE")]},
    {"nom": "M15M", "poules": [_p("MMB", "PTBR35", "ST GREGOIRE")]},
    {"nom": "M13F", "poules": [_p("BFC", "PTBR35", "VB GREGORIEN")]},
    {"nom": "M13M", "poules": [_p("BMD", "PTBR35", "VB GREGORIEN (masc)")]},
    # loisir
    {"nom": "Loisir Compet'Lib 1", "poules": [_p("XSZ", "PTBR35", "ST GREGOIRE 1")]},
    {"nom": "Loisir Compet'Lib 2", "poules": [_p("XSX", "PTBR35", "ST GREGOIRE 2")]},
]
# Coupes : affichées dans la carte « Coupes », pas dans les cartes d'équipe.
COUPES = [
    {"nom": "Coupe de France fédérale masculine", "equipe": "N3M", "poules": [_p("COM", "ABCCS", VBG)]},
    {"nom": "Coupe de Bretagne M18M", "equipe": "M18M région", "poules": [_p("BCD", "LIBR", VBG)]},
    {"nom": "Coupe CD35 masculine", "equipe": "PRM", "poules": [_p("GMC", "PTBR35", "ST GREGOIRE 2")]},
]


def codes_connus():
    return {p["code"] for c in EQUIPES + COUPES for p in c["poules"]}


# --------------------------------------------------------------- heure de Paris
def _dernier_dimanche(annee, mois):
    d = date(annee, mois, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def decalage_paris(utc):
    """Décalage de Paris à l'instant `utc` (aware). Règle UE codée à la main :
    pas de base de fuseaux (tzdata) garantie sous Windows."""
    a = utc.year
    debut = datetime(a, 3, _dernier_dimanche(a, 3).day, 1, tzinfo=timezone.utc)
    fin = datetime(a, 10, _dernier_dimanche(a, 10).day, 1, tzinfo=timezone.utc)
    return timezone(timedelta(hours=2 if debut <= utc < fin else 1))


def maintenant_paris():
    utc = datetime.now(timezone.utc)
    return utc.astimezone(decalage_paris(utc)).replace(microsecond=0)


# ---------------------------------------------------------------- analyse HTML
class _Lignes(HTMLParser):
    """Aplatit la page en lignes de cellules. Les tableaux imbriqués et les
    <form> intercalés rendent un découpage par expression régulière fragile."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lignes, self.ligne, self.cellule = [], None, None

    def _fermer_cellule(self):
        if self.cellule is not None and self.ligne is not None:
            txt = re.sub(r"\s+", " ", "".join(self.cellule["t"]).replace("\xa0", " ")).strip()
            self.ligne.append({"t": txt, "colspan": self.cellule["colspan"]})
        self.cellule = None

    def _fermer_ligne(self):
        self._fermer_cellule()
        if self.ligne:
            self.lignes.append(self.ligne)
        self.ligne = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._fermer_ligne()
            self.ligne = []
        elif tag == "td":
            self._fermer_cellule()
            if self.ligne is None:
                self.ligne = []
            a = dict(attrs)
            try:
                cs = int(a.get("colspan") or 1)
            except ValueError:
                cs = 1
            self.cellule = {"t": [], "colspan": cs}

    def handle_endtag(self, tag):
        if tag == "td":
            self._fermer_cellule()

    def handle_data(self, data):
        if self.cellule is not None:
            self.cellule["t"].append(data)

    def close(self):
        super().close()
        self._fermer_ligne()


def decoder(octets):
    return octets.decode("cp1252", errors="replace")


def lignes(page):
    p = _Lignes()
    p.feed(page)
    p.close()
    return p.lignes


def norm(s):
    return re.sub(r"\s+", " ", html.unescape(s or "").replace("\xa0", " ")).strip()


class PouleIllisible(Exception):
    pass


def titre_poule(page, code):
    m = re.search(r">\s*" + re.escape(code) + r" - ([^<]+)<", page)
    return norm(m.group(1)) if m else None


def classement(lg):
    """Lit le classement par intitulés de colonnes (le M13 n'a pas les 3-0, 3-1…)."""
    entete = None
    out = []
    for ligne in lg:
        textes = [c["t"] for c in ligne]
        if entete is None:
            if "Points" in textes and "Jou." in textes:
                entete = {t: i for i, t in enumerate(textes) if t}
            continue
        if ligne and re.fullmatch(r"\d+\.", ligne[0]["t"]):
            def val(k):
                i = entete.get(k)
                v = ligne[i]["t"] if i is not None and i < len(ligne) else ""
                return int(v) if re.fullmatch(r"-?\d+", v) else 0
            out.append({"rang": int(ligne[0]["t"][:-1]), "club": norm(ligne[1]["t"]),
                        "pts": val("Points"), "j": val("Jou."), "g": val("Gag."), "p": val("Per.")})
    return out


def matchs(lg, code):
    """Tous les matchs de la poule. Un code de match qui ne commence pas par le
    code de la poule signale une page d'une autre poule : on lève une erreur."""
    out = []
    for c in lg:
        if len(c) > 5 and re.fullmatch(r"\d\d/\d\d/\d\d", c[1]["t"]):
            if not c[0]["t"].startswith(code):
                raise PouleIllisible("code de match %r hors poule %s" % (c[0]["t"], code))
            dom, ext = norm(c[3]["t"]), norm(c[5]["t"])
            if "xxxxx" in (dom.lower(), ext.lower()):
                continue  # équipe exempte
            j, m, a = c[1]["t"].split("/")
            m_ = {"code": c[0]["t"], "date": "20%s-%s-%s" % (a, m, j),
                  "heure": c[2]["t"] if re.fullmatch(r"\d\d:\d\d", c[2]["t"]) else None,
                  "dom": dom, "ext": ext, "joue": False, "salle": None}
            if len(c) > 7 and c[6]["colspan"] == 1 and (c[6]["t"] or c[7]["t"])                     and not (c[6]["t"].isdigit() and c[7]["t"].isdigit()):
                m_["illisible"] = True  # forfait ou score non numérique : jamais deviné
            elif len(c) > 7 and c[6]["t"].isdigit() and c[7]["t"].isdigit():
                m_.update(joue=True, sd=int(c[6]["t"]), se=int(c[7]["t"]),
                          detail=[s.strip() for s in c[8]["t"].split(",") if s.strip()] if len(c) > 8 else [])
            else:
                for i in range(6, len(c)):
                    if c[i]["colspan"] == 2:
                        if i + 1 < len(c):
                            m_["salle"] = norm(c[i + 1]["t"]) or None
                        break
            out.append(m_)
    return out


def vu_du_club(m, club):
    """Match du point de vue du club : pour/contre et sets retournés si extérieur."""
    if m["dom"] == club:
        lieu, adv = "D", m["ext"]
    elif m["ext"] == club:
        lieu, adv = "E", m["dom"]
    else:
        return None
    base = {"date": m["date"], "lieu": lieu, "adv": adv, "code": m["code"]}
    if m.get("illisible"):
        base.update(illisible=True, heure=m["heure"], salle=m["salle"])
        return base
    if m["joue"]:
        pour, contre = (m["sd"], m["se"]) if lieu == "D" else (m["se"], m["sd"])
        sets = []
        for s in m["detail"]:
            a, _, b = s.partition(":")
            if not (a.isdigit() and b.isdigit()):
                continue
            sets.append("%s-%s" % ((a, b) if lieu == "D" else (b, a)))
        # L'heure sert seulement au tri de la vue « Cette semaine » (jamais affichée pour un résultat).
        base.update(pour=pour, contre=contre, sets=" ".join(sets), heure=m["heure"])
    else:
        base.update(heure=m["heure"], salle=m["salle"])
    return base


def joli(titre):
    """MAJUSCULES de la FFvolley -> casse lisible ; garde les sigles (D1, M18M, lettre seule)."""
    def mot(w):
        return w if len(w) == 1 or re.search(r"\d", w) else w.lower()
    t = " ".join(mot(w) for w in titre.split())
    return t[:1].upper() + t[1:]


def _cle_recent(m):
    """Clé de tri chronologique d'un match : jour, puis heure, puis code de match. Utilisée en ordre
    décroissant (le plus récent en premier). Un match sans heure compte comme la fin de journée,
    comme dans la vue « Cette semaine » de la page (sans heure en dernier) : il passe donc devant les
    matchs horaires du même jour dans une liste « récent en premier »."""
    return (m["date"], m.get("heure") or "99:99", m.get("code", ""))


def analyser_poule(page, p, aujourdhui, heure=None):
    """Page de poule -> infos brutes du club. Lève PouleIllisible."""
    code, club = p["code"], p["club"]
    titre = titre_poule(page, code)
    if not titre:
        raise PouleIllisible("titre %s introuvable : page d'une autre poule ?" % code)
    lg = lignes(page)
    tous = matchs(lg, code)
    if not tous:
        raise PouleIllisible("aucun match dans la page de la poule %s" % code)
    mes = [x for x in (vu_du_club(m, club) for m in tous) if x]
    cl = classement(lg)
    moi = [r for r in cl if r["club"] == club]
    if cl and len(moi) != 1:
        raise PouleIllisible("club %r absent du classement (%d lignes)" % (club, len(moi)))
    joues = sorted((m for m in mes if "pour" in m), key=_cle_recent, reverse=True)

    def a_venir_ok(m):
        if "pour" in m or m.get("illisible") or m["date"] < aujourdhui.isoformat():
            return False
        # match du jour dont l'heure est passée : résultat pas encore saisi, plus « à venir »
        return not (heure and m["date"] == aujourdhui.isoformat() and m["heure"] and m["heure"] <= heure)
    a_venir = sorted((m for m in mes if a_venir_ok(m)), key=lambda m: (m["date"], m["heure"] or ""))
    # Matchs sans score lisible qui ne sont plus « à venir » (résultat pas encore saisi) ou dont le
    # score est illisible, datés de la semaine en cours ou de la semaine précédente (lundi au dimanche,
    # heure de Paris) : la page les garde dans « Cette semaine » et « Semaine dernière ». Un match du lundi
    # 9/11 reste donc disponible jusqu'au dimanche 22/11 inclus, et disparaît le lundi 23/11.
    limite = (aujourdhui - timedelta(days=aujourdhui.weekday() + 7)).isoformat()
    attente = sorted((m for m in mes if "pour" not in m and m["date"] >= limite
                      and (m.get("illisible") or not a_venir_ok(m))),
                     key=lambda m: (m["date"], m["heure"] or "", m["code"]))
    return {"code": code, "titre": joli(titre), "mes": len(mes), "joues": joues,
            "illisibles": sum(1 for m in mes if m.get("illisible")),
            "prochain": a_venir[0] if a_venir else None,
            "avenir": a_venir, "attente": attente,
            "classement": (moi[0], len(cl)) if cl else None}


def _sans_code(listes):
    """Fusionne des listes de matchs de plusieurs poules, trie par (date, heure) et retire le code."""
    tous = sorted((m for liste in listes for m in liste), key=lambda m: (m["date"], m["heure"] or "", m["code"]))
    return [{k: v for k, v in m.items() if k != "code"} for m in tous]


def construire(cfg, lues, coupe=False):
    """Fusionne les poules lues (dans l'ordre de priorité) en une entrée de carte."""
    active = next((l for l in lues if l["mes"]), None)  # première poule où le club a des matchs
    if active is None:
        raise PouleIllisible("aucun match du club dans %s" % ", ".join(l["code"] for l in lues))
    multi = len(lues) > 1
    res = []
    for l in lues:
        for r in l["joues"]:
            r = dict(r)
            if multi:
                m = re.search(r"\b(poule \w)$", l["titre"], re.I)
                if m:
                    r["compet"] = m.group(1)[:1].upper() + m.group(1)[1:]
            res.append(r)
    res.sort(key=_cle_recent, reverse=True)
    res = [{k: v for k, v in r.items() if k != "code"} for r in res]
    prochain = {k: v for k, v in active["prochain"].items() if k != "code"} if active["prochain"] else None
    out = {"nom": cfg["nom"], "prochain": prochain, "resultats": res[:NB_RESULTATS],
           "avenir": _sans_code(l["avenir"] for l in lues),
           "attente": _sans_code(l["attente"] for l in lues)}
    nb_ill = sum(l["illisibles"] for l in lues)
    if nb_ill:
        out["noteResultats"] = "%d match(s) à lire sur FFvolley (forfait ou score non numérique)." % nb_ill
    if coupe:
        out["equipe"] = cfg["equipe"]
        return out
    club = cfg["poules"][lues.index(active)]["club"]
    out["poule"] = cfg.get("libelle") or (active["titre"] + ("" if club == VBG else " · " + club))
    if active["classement"]:
        r, sur = active["classement"]
        out.update(rang=r["rang"], sur=sur, pts=r["pts"], g=r["g"], p=r["p"])
    else:
        out["noteRang"] = "Classement de la poule pas encore publié."
    return out


def analyser(page, cfg, aujourdhui, coupe=False, heure=None):
    """Raccourci pour une équipe à une seule poule (tests)."""
    p = cfg["poules"][0] if "poules" in cfg else cfg
    return construire(dict(cfg, poules=[p]), [analyser_poule(page, p, aujourdhui, heure)], coupe)


# --------------------------------------------------------------------- réseau
def telecharger(url):
    derniere = None
    for essai in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    octets = r.read()
                    texte = decoder(octets) if len(octets) > 2000 else ""
                    if texte and "</html>" in texte[-600:].lower():
                        return texte
                    derniere = "page trop courte ou tronquée (%d octets)" % len(octets)
                else:
                    derniere = "HTTP %s" % r.status
        except Exception as e:  # noqa: BLE001 - on veut tout rapporter
            derniere = repr(e)
        time.sleep(PAUSE * (essai + 1))
    raise PouleIllisible("téléchargement impossible : %s" % derniere)


def poules_de_page(page):
    """{code: libellé} des compétitions citées par une page FFvolley (« CODE - LIBELLE »)."""
    out = {}
    for ligne in lignes(page):
        for c in ligne:
            m = re.fullmatch(r"([A-Z0-9]{3}) - (.+)", c["t"])
            if m:
                out.setdefault(m.group(1), norm(m.group(2)))
    return out


def poules_non_suivies(pages, connus):
    """pages : {source: html}. Tout code absent de la configuration est listé, jamais ajouté."""
    res = {}
    for source, page in pages.items():
        for code, lib in poules_de_page(page).items():
            if code not in connus and code not in res:
                res[code] = {"code": code, "libelle": joli(lib), "source": source}
    return sorted(res.values(), key=lambda x: x["code"])


# ------------------------------------------------------------------- sortie
def fusionner(ancien, nouveau_equipes, nouveau_coupes, ordre_eq, ordre_co, maj_iso, echecs):
    """Reprend les anciennes entrées pour les poules non lues, avec « nonlu »."""
    def choisir(noms, lus, vieux):
        res = []
        for nom in noms:
            if nom in lus:
                e = dict(lus[nom])
                e["lu"] = maj_iso
                res.append(e)
            elif nom in vieux:
                e = dict(vieux[nom])
                if nom in echecs:
                    e["nonlu"] = True
                    e["raison"] = echecs[nom]
                res.append(e)
            elif nom in echecs:
                res.append({"nom": nom, "nonlu": True, "raison": echecs[nom],
                            "prochain": None, "resultats": []})
        return res
    vieux_eq = {e["nom"]: e for e in ancien.get("equipes", [])}
    vieux_co = {e["nom"]: e for e in ancien.get("coupes", [])}
    return {"maj": maj_iso,
            "equipes": choisir(ordre_eq, nouveau_equipes, vieux_eq),
            "coupes": choisir(ordre_co, nouveau_coupes, vieux_co)}


def ecrire_atomiquement(chemin, data):
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(tmp, encoding="utf-8") as f:
        json.load(f)  # relecture : le fichier doit être du JSON valide
    os.replace(tmp, chemin)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="noms ou codes séparés par des virgules (équipes ou coupes)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "data.json"))
    args = ap.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None

    def voulu(c):
        return not only or c["nom"] in only or any(p["code"] in only for p in c["poules"])

    maintenant = maintenant_paris()
    aujourdhui = maintenant.date()
    heure = maintenant.strftime("%H:%M")
    maj_iso = maintenant.isoformat()

    try:
        with open(args.out, encoding="utf-8") as f:
            ancien = json.load(f)
    except (OSError, ValueError):
        ancien = {}

    lus_eq, lus_co, echecs = {}, {}, {}
    cache = {}  # une seule requête par poule
    travaux = [(c, False, lus_eq) for c in EQUIPES if voulu(c)] + [(c, True, lus_co) for c in COUPES if voulu(c)]
    for cfg, coupe, dest in travaux:
        try:
            lues = []
            for p in cfg["poules"]:
                cle = (p["ent"], p["code"], p["club"])
                if cle not in cache:
                    time.sleep(PAUSE)
                    page = telecharger(URL_POULE.format(ent=p["ent"], code=p["code"]))
                    cache[cle] = analyser_poule(page, p, aujourdhui, heure)
                lues.append(cache[cle])
            dest[cfg["nom"]] = construire(cfg, lues, coupe)
            print("OK   ", cfg["nom"])
        except PouleIllisible as e:
            echecs[cfg["nom"]] = str(e)
            print("ECHEC", cfg["nom"], "-", e)

    # Poules non suivies : comparaison avec la page club et la page hebdomadaire.
    pages = {}
    for source, url in (("page club", URL_CLUB), ("page hebdo", URL_HEBDO)):
        time.sleep(PAUSE)
        try:
            pages[source] = telecharger(url)
        except PouleIllisible as e:
            print("AVERTISSEMENT :", source, "illisible :", e)
    if len(pages) == 2:
        nonsuivies = poules_non_suivies(pages, codes_connus())
        vus = set(poules_de_page(pages["page club"])) | set(poules_de_page(pages["page hebdo"]))
        for code in sorted(codes_connus() - vus):
            print("AVERTISSEMENT : poule configurée absente des pages club et hebdo :", code)
    else:
        nonsuivies = ancien.get("nonsuivies", [])  # comparaison impossible : on garde la dernière

    if not lus_eq and not lus_co:
        print("Aucune poule lue : data.json inchangé.")
        return 1
    data = fusionner(ancien, lus_eq, lus_co,
                     [e["nom"] for e in EQUIPES], [c["nom"] for c in COUPES], maj_iso, echecs)
    data["nonsuivies"] = nonsuivies
    encore_configurees = {e["nom"] for e in ancien.get("equipes", [])} & {e["nom"] for e in EQUIPES}
    if len(data["equipes"]) < len(encore_configurees):
        print("Moins d'équipes qu'avant : data.json inchangé.")
        return 1
    ecrire_atomiquement(args.out, data)
    for n in nonsuivies:
        print("Compétition non suivie : %s, %s" % (n["code"], n["libelle"]))
    print("Écrit", args.out)
    return 0 if not echecs else 2


if __name__ == "__main__":
    sys.exit(main())
