"""Chantier « Programme » et « Poule » : toute la saison dans data.json, exempts, plateaux, contrôle par la page club.
Pages de test : poule_*.html (19/11) et club_s47 / club_s48 (semaines du 16/11 et du 23/11), arbitres anonymisés."""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collect
import test_collect as T

page = T.page
AUJ19 = date(2026, 11, 19)
# Pages du 19/11 pour les 4 poules ré-enregistrées ; les autres pages de test restent celles du 15-17/11.
FIXTURE_19 = dict(T.FIXTURE_DE, BMD="poule_bmd", BFC="poule_bfc", XSX="poule_xsx", D1F="poule_d1f")
BFC = {"code": "BFC", "ent": "PTBR35", "club": "VB GREGORIEN"}
BMD = {"code": "BMD", "ent": "PTBR35", "club": "VB GREGORIEN (masc)"}
XSX = {"code": "XSX", "ent": "PTBR35", "club": "ST GREGOIRE 2"}
D1F = {"code": "D1F", "ent": "PTBR35", "club": "ST GREGOIRE 2"}
_ANALYSES = {}


def texte(o):
    """JSON de `o`, casse conservée (T.json_texte met en minuscules : inutile pour chercher « ARBITRE »)."""
    return json.dumps(o, ensure_ascii=False)


def analyses_du_19():
    """{code de poule: analyse} de toutes les poules configurées (calculé une fois)."""
    if not _ANALYSES:
        for c in collect.EQUIPES + collect.COUPES:
            for p in c["poules"]:
                _ANALYSES[p["code"]] = collect.analyser_poule(page(FIXTURE_19[p["code"]]), p, AUJ19, "12:00")
    return _ANALYSES


def codes_des_poules():
    return {k: set(v["codes"]) for k, v in analyses_du_19().items()}


def carte_de(cfg_poule, fixture, nom="X"):
    a = collect.analyser_poule(page(fixture), cfg_poule, AUJ19, "12:00")
    return collect.construire({"nom": nom, "poules": [cfg_poule]}, [a])


class HeureDeParisTest(unittest.TestCase):
    def ts(self, y, m, j):
        return datetime.fromtimestamp(collect.minuit_paris(date(y, m, j)), timezone.utc).strftime("%Y-%m-%d %H:%M")

    def test_valeur_donnee_par_ffvolley_a_l_heure_d_hiver(self):
        self.assertEqual(collect.minuit_paris(date(2026, 11, 19)), 1795042800)  # lien « semaine précédente » de FFvolley

    def test_heure_d_ete_et_jours_de_changement_d_heure(self):
        self.assertEqual(self.ts(2027, 7, 14), "2027-07-13 22:00")
        self.assertEqual(self.ts(2027, 3, 28), "2027-03-27 23:00")  # minuit encore en heure d'hiver
        self.assertEqual(self.ts(2027, 3, 29), "2027-03-28 22:00")
        self.assertEqual(self.ts(2027, 10, 31), "2027-10-30 22:00")  # minuit encore en heure d'été
        self.assertEqual(self.ts(2027, 11, 1), "2027-10-31 23:00")

    def test_adresse_de_la_semaine(self):
        self.assertEqual(collect.url_semaine(AUJ19), collect.URL_HEBDO + "&date_jour=1795042800")


class ExemptsEtPlateauxTest(unittest.TestCase):
    def test_exempt_garde_avec_la_vraie_equipe_et_jamais_xxxxx(self):
        ms = collect.matchs(collect.lignes(page("poule_bfc")), "BFC")
        ex = [m for m in ms if m.get("exempt")]
        self.assertEqual(len(ex), 6)
        self.assertTrue(all(m["ext"] == "" and m["dom"] and m["dom"].lower() != "xxxxx" for m in ex))
        self.assertEqual([m["dom"] for m in ex if m["code"] == "BFCA014"], ["VB GREGORIEN"])

    def test_exempt_xxxxx_a_domicile_retrouve_la_vraie_equipe(self):
        def c(t, n=1):
            return {"t": t, "colspan": n}
        lg = [[c("ZZZA001"), c("07/11/26"), c(""), c("xxxxx"), c(""), c("ROUGE"), c("", 3)]]
        (m,) = collect.matchs(lg, "ZZZ")
        self.assertEqual((m["dom"], m["ext"], m["exempt"]), ("ROUGE", "", True))

    def test_un_exempt_n_est_jamais_un_match_du_club(self):
        ms = collect.matchs(collect.lignes(page("poule_bfc")), "BFC")
        ex = [m for m in ms if m.get("exempt") and m["dom"] == "VB GREGORIEN"]
        self.assertTrue(ex)
        self.assertTrue(all(collect.vu_du_club(m, "VB GREGORIEN") is None for m in ex))
        r = carte_de(BFC, "poule_bfc")
        self.assertNotIn("xxxxx", texte(r).lower())
        self.assertEqual(r["prochain"]["adv"], "CHATEAUBOURG MARPIRE 35 V 2")  # pas l'exempt du même jour

    def test_poule_impaire_les_tours_d_exemption_sont_publies_sans_xxxxx(self):
        r = carte_de(D1F, "poule_d1f")
        ex = [m for m in r["poules"][0]["matchs"] if m.get("exempt")]
        self.assertEqual(len(ex), 18)
        self.assertTrue(all(set(m) <= {"date", "heure", "dom", "j", "exempt"} for m in ex))
        self.assertNotIn("xxxxx", texte(r).lower())

    def test_plateau_plusieurs_matchs_le_meme_jour_au_meme_endroit(self):
        r = carte_de(BMD, "poule_bmd")
        jour = [m for m in r["poules"][0]["matchs"] if m["date"] == "2026-11-21"]
        self.assertEqual(len(jour), 7)
        self.assertEqual({m["heure"] for m in jour if not m.get("exempt")}, {"11:00"})
        les_notres = [m for m in jour if "VB GREGORIEN (masc)" in (m["dom"], m.get("ext"))]
        self.assertEqual(len(les_notres), 2)
        self.assertEqual({m["salle"] for m in les_notres}, {"ST GREGOIRE COSEC"})
        self.assertEqual({m["j"] for m in jour}, {2})

    def test_match_sans_heure_n_a_pas_de_cle_heure_dans_les_poules(self):
        r = carte_de(BFC, "poule_bfc")
        sans = [m for m in r["poules"][0]["matchs"] if m["date"] == "2026-11-21" and not m.get("exempt")]
        self.assertTrue(sans)
        self.assertTrue(all("heure" not in m for m in sans))
        self.assertIsNone(r["prochain"]["heure"])  # la carte existante garde sa clé (null)


class PoulesPublieesTest(unittest.TestCase):
    def test_noms_du_club_variables_toujours_ceux_de_la_configuration(self):
        for cfg, fix in ((BFC, "poule_bfc"), (BMD, "poule_bmd"), (XSX, "poule_xsx"), (D1F, "poule_d1f")):
            with self.subTest(club=cfg["club"]):
                (p,) = carte_de(cfg, fix)["poules"]
                self.assertEqual(p["nous"], cfg["club"])
                self.assertTrue(p["active"])
                self.assertEqual(len([r for r in p["classement"] if r["club"] == cfg["club"]]), 1)
                self.assertTrue(any(cfg["club"] in (m["dom"], m.get("ext")) for m in p["matchs"]))

    def test_classement_complet_et_matchs_de_toute_la_saison(self):
        (p,) = carte_de(XSX, "poule_xsx")["poules"]
        self.assertEqual(len(p["classement"]), 6)
        self.assertEqual(p["classement"][0],
                         {"rang": 1, "club": "LA CHAPELLE DES FGTZ 1", "pts": 9, "j": 3, "g": 3, "p": 0})
        self.assertEqual(len(p["matchs"]), 15)
        self.assertEqual({m["j"] for m in p["matchs"]}, {1, 2, 3, 4, 5})

    def test_match_futur_deja_marque_joue_a_son_score(self):
        r = carte_de(XSX, "poule_xsx")
        m = [x for x in r["poules"][0]["matchs"] if x["date"] == "2026-11-23" and x["dom"] == "ST GREGOIRE 2"][0]
        self.assertEqual((m["sd"], m["se"], m["sets"]), (3, 1, "25-19 21-25 25-22 25-23"))
        self.assertNotIn("salle", m)
        res = r["resultats"][0]
        self.assertEqual((res["date"], res["pour"], res["contre"]), ("2026-11-23", 3, 1))
        self.assertTrue(all(x["date"] != "2026-11-23" for x in r["avenir"]))  # plus « à venir » : il a un score

    def test_sets_de_la_poule_du_point_de_vue_de_celui_qui_recoit(self):
        r = carte_de(XSX, "poule_xsx")
        m = [x for x in r["poules"][0]["matchs"] if x["date"] == "2026-11-09" and x["dom"] == "GEVEZE 2"][0]
        self.assertEqual((m["sd"], m["se"], m["sets"]), (3, 2, "24-26 25-22 25-23 23-25 15-11"))
        # la carte du club (extérieur ce soir-là) garde les sets du point de vue du VBG
        club = [x for x in r["resultats"] if x["date"] == "2026-11-09"][0]
        self.assertEqual((club["pour"], club["contre"], club["sets"]), (2, 3, "26-24 22-25 23-25 25-23 11-15"))

    def test_match_a_venir_porte_sa_salle_mais_pas_les_matchs_joues(self):
        (p,) = carte_de(XSX, "poule_xsx")["poules"]
        joue = [m for m in p["matchs"] if "sd" in m]
        venir = [m for m in p["matchs"] if "sd" not in m and not m.get("exempt")]
        self.assertTrue(joue)
        self.assertTrue(all("salle" not in m for m in joue))
        self.assertTrue(any(m.get("salle") == "SALLE PARQUET" for m in venir))

    def test_aucun_code_de_match_n_est_publie(self):
        (p,) = carte_de(BMD, "poule_bmd")["poules"]
        self.assertTrue(all("code" not in m for m in p["matchs"]))

    def test_forfait_publie_comme_illisible(self):
        out = collect.publier_match({"code": "X1", "date": "2026-11-21", "heure": None, "dom": "A", "ext": "B",
                                     "joue": False, "salle": None, "illisible": True, "j": 4})
        self.assertEqual(out, {"date": "2026-11-21", "dom": "A", "j": 4, "ext": "B", "illisible": True})

    def test_m18m_region_publie_les_deux_phases_une_seule_active(self):
        cfg = [e for e in collect.EQUIPES if e["nom"] == "M18M région"][0]
        lues = [analyses_du_19()["CPN"], analyses_du_19()["CPE"]]
        r = collect.construire(cfg, lues)
        self.assertEqual(len(r["poules"]), 2)
        self.assertEqual(sum(p["active"] for p in r["poules"]), 1)
        self.assertEqual([p["titre"] for p in r["poules"]], [l["titre"] for l in lues])

    def test_toutes_les_cartes_ont_leurs_poules(self):
        a = analyses_du_19()
        for cfg in collect.EQUIPES + collect.COUPES:
            r = collect.construire(cfg, [a[p["code"]] for p in cfg["poules"]], coupe=cfg in collect.COUPES)
            self.assertEqual(len(r["poules"]), len(cfg["poules"]), cfg["nom"])
            self.assertTrue(all(p["matchs"] for p in r["poules"]), cfg["nom"])

    def test_poule_non_lue_garde_ses_poules_et_est_marquee_non_lue(self):
        e = carte_de(BMD, "poule_bmd", "M13M")
        d = collect.fusionner({"equipes": [e], "coupes": []}, {}, {}, ["M13M"], [], "2026-11-19T21:00:00+01:00",
                              {"M13M": "erreur"})
        self.assertTrue(d["equipes"][0]["nonlu"])
        self.assertEqual(d["equipes"][0]["poules"], e["poules"])

    def test_ancien_format_sans_poules_reste_valide(self):
        ancien = {"equipes": [{"nom": "N3M", "prochain": None, "resultats": []}], "coupes": []}
        d = collect.fusionner(ancien, {}, {}, ["N3M"], [], "2026-11-19T21:00:00+01:00", {"N3M": "x"})
        self.assertNotIn("poules", d["equipes"][0])  # rien d'inventé


class ControleParLaPageClubTest(unittest.TestCase):
    def controle(self, pages, codes=None, non_lues=(), connus=None, ignorees=None):
        return collect.controler(pages, codes if codes is not None else codes_des_poules(), set(non_lues),
                                 collect.codes_connus() if connus is None else connus,
                                 collect.codes_ignores() if ignorees is None else ignorees)

    def test_tout_concorde_sur_les_deux_semaines(self):
        self.assertEqual(self.controle([page("club_s47"), page("club_s48")]), [])

    def test_les_matchs_lus_sur_la_page_club_n_ont_ni_arbitre_ni_exempt(self):
        lus = collect.matchs_page_club(page("club_s47"))
        self.assertEqual(len(lus), 14)
        self.assertNotIn("BFCA014", [m["code"] for m in lus])  # exempt
        self.assertTrue(all(set(m) == {"poule", "titre", "lien", "code", "date"} for m in lus))
        self.assertNotIn("ARBITRE", texte(lus))

    def test_match_absent_de_la_poule_est_signale_avec_son_code_et_sa_date(self):
        codes = codes_des_poules()
        codes["3MF"] = codes["3MF"] - {"3MF041"}
        self.assertEqual(self.controle([page("club_s47")], codes),
                         ["match 3MF041 du 22/11 listé par FFvolley, absent de la poule 3MF"])

    def test_un_match_present_dans_deux_semaines_n_est_signale_qu_une_fois(self):
        codes = codes_des_poules()
        codes["XSX"] = codes["XSX"] - {"XSXA012"}
        msgs = self.controle([page("club_s47"), page("club_s47")], codes)
        self.assertEqual(len(msgs), 1)
        self.assertIn("XSXA012", msgs[0])

    def test_exempt_de_la_page_club_ne_declenche_rien(self):
        codes = codes_des_poules()
        codes["BFC"] = codes["BFC"] - {"BFCA014"}
        self.assertEqual(self.controle([page("club_s47")], codes), [])

    def test_competition_ignoree_n_est_pas_signalee(self):
        faux = page("club_s47").replace("3MF - NATIONALE 3 MASCULINE POULE F",
                                        "JMJ - COUPE DE FRANCE M21 MASCULIN POULE J")
        self.assertNotEqual(faux, page("club_s47"))
        connus = collect.codes_connus() - {"3MF"}
        self.assertEqual(self.controle([faux], connus=connus, ignorees={"JMJ"}), [])
        self.assertEqual(len(self.controle([faux], connus=connus, ignorees=set())), 1)  # sans la liste : signalée
        self.assertEqual({c["code"] for c in collect.IGNOREES}, {"JMJ"})  # la configuration réelle ignore JMJ

    def test_poule_non_configuree_est_signalee_avec_son_titre_et_son_adresse(self):
        faux = page("club_s47").replace("CPN - M18M PERFORMANCE POULE C", "CPF - M18M PERFORMANCE POULE F")
        faux = faux.replace("&poule=CPN", "&poule=CPF")
        msgs = self.controle([faux])
        self.assertEqual(len(msgs), 1)
        self.assertIn("poule non configurée CPF - M18M performance poule F", msgs[0])
        self.assertIn("vbspo_calendrier.php?saison=2026/2027&codent=LIBR&saison=2026/2027&poule=CPF", msgs[0])
        self.assertIn("match du 21/11", msgs[0])

    def test_la_meme_poule_non_configuree_n_est_signalee_qu_une_fois(self):
        faux = page("club_s47").replace("1PM - PRE REGIONALE MASCULINE", "ZZZ - POULE NOUVELLE")
        self.assertNotEqual(faux, page("club_s47"))
        self.assertEqual(len(self.controle([faux, faux])), 1)

    def test_poule_deja_non_lue_n_est_pas_signalee_deux_fois(self):
        codes = codes_des_poules()
        codes["3MF"] = codes["3MF"] - {"3MF041"}
        self.assertEqual(self.controle([page("club_s47")], codes, non_lues={"3MF"}), [])


class CollecteCompleteTest(unittest.TestCase):
    """main() hors ligne : pages de poule du 19/11, page club de la semaine du 16/11 puis du 23/11."""

    def lancer(self, args=(), club=None, erreur_suivante=False, erreur_courante=False, urls=None):
        def fausse_page(url, *a, **k):
            if urls is not None:
                urls.append(url)
            if "planning_club_class" in url:
                return page("club_class")
            if "planning_club.php" in url:
                if "date_jour" in url:
                    if erreur_suivante:
                        raise collect.PouleIllisible("HTTP 503")
                    return page("club_s48")
                if erreur_courante:
                    raise collect.PouleIllisible("HTTP 503")
                return club if club is not None else page("club_s47")
            code = url.split("poule=")[1].split("&")[0]
            return page(FIXTURE_19[code])

        with tempfile.TemporaryDirectory() as dossier:
            sortie = os.path.join(dossier, "data.json")
            tampon = io.StringIO()
            with mock.patch.object(collect, "telecharger", side_effect=fausse_page), \
                    mock.patch.object(collect.time, "sleep"), mock.patch("sys.stdout", new=tampon), \
                    mock.patch.object(collect, "maintenant_paris", return_value=datetime(2026, 11, 19, 12, 0)):
                code = collect.main(["--out", sortie, *args])
            data = None
            if os.path.exists(sortie):
                with open(sortie, encoding="utf-8") as f:
                    data = json.load(f)
        return code, tampon.getvalue(), data

    def test_tout_concorde_code_0_poules_et_salles_du_club_publiees(self):
        code, sortie, d = self.lancer()
        self.assertEqual(code, 0, sortie)
        self.assertNotIn("ECHEC", sortie)
        self.assertEqual(d["salles_club"], collect.SALLES_CLUB)
        for c in d["equipes"] + d["coupes"]:
            self.assertTrue(c["poules"], c["nom"])
            self.assertFalse(c.get("nonlu"), c["nom"])
        t = texte(d)
        self.assertNotIn("xxxxx", t.lower())
        self.assertNotIn("ARBITRE", t)
        self.assertEqual(d["nonsuivies"], [])

    def test_la_semaine_suivante_est_demandee_par_son_horodatage(self):
        urls = []
        self.lancer(urls=urls)
        self.assertIn(collect.URL_HEBDO + "&date_jour=%d" % collect.minuit_paris(date(2026, 11, 26)), urls)

    def test_match_absent_code_2_message_clair_donnees_publiees_equipe_non_marquee(self):
        code, sortie, d = self.lancer(club=page("club_s47").replace("3MF041", "3MF999"))
        self.assertEqual(code, 2)
        self.assertIn("ECHEC contrôle : match 3MF999 du 22/11 listé par FFvolley, absent de la poule 3MF", sortie)
        self.assertIsNotNone(d)  # data.json est publié
        self.assertFalse(any(c.get("nonlu") for c in d["equipes"] + d["coupes"]))

    def test_poule_non_configuree_code_2_avec_titre_et_adresse(self):
        club = page("club_s47").replace("CPN - M18M PERFORMANCE POULE C", "CPF - M18M PERFORMANCE POULE F")
        code, sortie, d = self.lancer(club=club.replace("&poule=CPN", "&poule=CPF"))
        self.assertEqual(code, 2)
        self.assertIn("ECHEC contrôle : poule non configurée CPF - M18M performance poule F (", sortie)
        self.assertIn("&poule=CPF)", sortie)

    def test_competition_ignoree_code_0_et_absente_de_nonsuivies(self):
        club = page("club_s47").replace("CPN - M18M PERFORMANCE POULE C", "JMJ - COUPE DE FRANCE M21 MASCULIN POULE J")
        code, sortie, d = self.lancer(club=club.replace("&poule=CPN", "&poule=JMJ"))
        self.assertEqual(code, 0, sortie)
        self.assertEqual(d["nonsuivies"], [])

    def test_page_club_de_la_semaine_suivante_illisible_code_2(self):
        code, sortie, d = self.lancer(erreur_suivante=True)
        self.assertEqual(code, 2)
        self.assertIn("ECHEC contrôle : page club illisible, contrôle impossible (semaine suivante", sortie)
        self.assertIsNotNone(d)

    def test_page_club_de_la_semaine_en_cours_illisible_code_2(self):
        code, sortie, d = self.lancer(erreur_courante=True)
        self.assertEqual(code, 2)
        self.assertIn("ECHEC contrôle : page club illisible, contrôle impossible (semaine en cours)", sortie)

    def test_option_only_ne_lance_pas_le_controle(self):
        urls = []
        code, sortie, _ = self.lancer(["--only", "N3M"], urls=urls)
        self.assertFalse([u for u in urls if "date_jour" in u])
        self.assertIn("Contrôle par la page club ignoré", sortie)


class CopieDeSecoursTest(unittest.TestCase):
    PAGE = "<html>\n// Données de secours : ancienne.\nconst SECOURS={\"maj\":\"x\"};\nconst AUTRE=1;\n</html>\n"
    DATA = {"maj": "2026-11-19T10:17:00+01:00", "salles_club": ["COSEC"],
            "equipes": [{"nom": "N3M", "rang": 8, "poules": [{"matchs": [1, 2, 3]}]}],
            "coupes": [{"nom": "C", "poules": [{"matchs": []}]}], "nonsuivies": []}

    def secours(self, html):
        import json
        ligne = [l for l in html.split("\n") if l.startswith("const SECOURS=")][0]
        return json.loads(ligne[len("const SECOURS="):-1])

    def test_la_copie_est_allegee_sans_poules_et_le_reste_est_intact(self):
        import regenerer_secours
        sortie = regenerer_secours.regenerer(self.PAGE, self.DATA)
        copie = self.secours(sortie)
        self.assertEqual(copie["equipes"], [{"nom": "N3M", "rang": 8}])
        self.assertEqual(copie["coupes"], [{"nom": "C"}])
        self.assertEqual((copie["maj"], copie["nonsuivies"]), (self.DATA["maj"], []))
        self.assertIn("copie de data.json du 19/11/2026", sortie)
        self.assertIn("const AUTRE=1;", sortie)
        self.assertIn("poules", self.DATA["equipes"][0])  # la donnée d'origine n'est pas modifiée

    def test_ligne_ou_commentaire_introuvable_est_une_erreur_claire(self):
        import regenerer_secours
        with self.assertRaises(ValueError):
            regenerer_secours.regenerer("<html></html>", self.DATA)

    def test_les_fins_de_ligne_de_la_page_sont_conservées(self):
        import regenerer_secours
        with tempfile.TemporaryDirectory() as dossier:
            page, data = os.path.join(dossier, "index.html"), os.path.join(dossier, "data.json")
            with open(page, "wb") as f:
                f.write(self.PAGE.replace("\n", "\r\n").encode("utf-8"))
            with open(data, "w", encoding="utf-8") as f:
                json.dump(self.DATA, f)
            with mock.patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(regenerer_secours.main(["x", data, page]), 0)
            with open(page, "rb") as f:
                octets = f.read()
        self.assertIn(b"\r\n", octets)
        self.assertNotIn(b"\n", octets.replace(b"\r\n", b""))

    def test_la_copie_integree_de_la_page_est_complete_legere_et_sans_poules(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "docs", "index.html"), encoding="utf-8") as f:
            html = f.read().replace("\r\n", "\n")
        copie = self.secours(html)
        self.assertEqual([e["nom"] for e in copie["equipes"]], [e["nom"] for e in collect.EQUIPES])
        self.assertEqual([c["nom"] for c in copie["coupes"]], [c["nom"] for c in collect.COUPES])
        self.assertFalse([e for e in copie["equipes"] + copie["coupes"] if "poules" in e])
        self.assertLess(len(html.encode("utf-8")), 80000, "la page doit rester légère (copie de secours sans les poules)")
        self.assertNotIn("ARBITRE", html)


RACINE = os.path.join(os.path.dirname(__file__), "..")
PAGE_CLUB_REELLE = (b"<tr><td></td><td class='liengris_pt'>DUPONT JEAN / MARTIN LUC</td><td></td></tr>")
PAGE_POULE_REELLE = (b"<td class='liensuite4_pt'>075-059</td><td class='liengris_pt' align='left'>DUPONT JEAN</td><form>")
PAGE_ANONYME = (b"<tr><td></td><td class='liengris_pt'>ARBITRE500 TEST / ARBITRE501 TEST</td><td></td></tr>"
                b"<td class='liensuite4_pt'>075-059</td><td class='liengris_pt' align='left'>ARBITRE502 TEST/ARBITRE503 TEST</td><form>")


def git_ok(depot, *args, **kw):
    return subprocess.run(["git", "-C", depot, "-c", "user.name=t", "-c", "user.email=t@example.org", *args],
                          capture_output=True, **kw)


def depot_de_test(dossier, avec_crochets=False):
    """Petit dépôt git jetable avec les outils d'anonymisation (et, si demandé, les crochets du projet)."""
    import shutil
    os.makedirs(os.path.join(dossier, "tests", "fixtures"))
    for nom in ("anonymiser.py", "verifier_arbitres.py"):
        shutil.copy(os.path.join(RACINE, "tests", nom), os.path.join(dossier, "tests", nom))
    git_ok(dossier, "init", "-q")
    if avec_crochets:
        shutil.copytree(os.path.join(RACINE, ".githooks"), os.path.join(dossier, ".githooks"))
        git_ok(dossier, "config", "core.hooksPath", ".githooks")
    return dossier


def ecrire(dossier, nom, octets):
    with open(os.path.join(dossier, "tests", "fixtures", nom), "wb") as f:
        f.write(octets)
    git_ok(dossier, "add", "tests/fixtures/" + nom)


class VerificationDesArbitresTest(unittest.TestCase):
    def verifier(self, dossier, *args):
        r = subprocess.run([sys.executable, os.path.join(dossier, "tests", "verifier_arbitres.py"), "--depot", dossier, *args],
                           capture_output=True)
        return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")

    def test_les_deux_emplacements_de_la_cellule_d_arbitres_sont_vus_et_les_pseudos_acceptes(self):
        import anonymiser
        self.assertEqual(len(anonymiser.en_clair(PAGE_CLUB_REELLE)), 1)
        self.assertEqual(len(anonymiser.en_clair(PAGE_POULE_REELLE)), 1)
        self.assertEqual(anonymiser.en_clair(PAGE_ANONYME), [])

    def test_index_un_nom_en_clair_bloque_sans_jamais_l_afficher(self):
        with tempfile.TemporaryDirectory() as d:
            depot_de_test(d)
            ecrire(d, "ok.html", PAGE_ANONYME)
            self.assertEqual(self.verifier(d, "--index")[0], 0)
            for nom, page in (("club.html", PAGE_CLUB_REELLE), ("poule.html", PAGE_POULE_REELLE)):
                ecrire(d, nom, page)
                code, sortie = self.verifier(d, "--index")
                self.assertEqual(code, 1, nom)
                self.assertIn(nom, sortie)
                self.assertNotIn("DUPONT", sortie)
                self.assertNotIn("MARTIN", sortie)
                git_ok(d, "rm", "-q", "--cached", "-f", "tests/fixtures/" + nom)

    def test_commits_un_commit_envoye_avec_un_nom_est_vu_meme_si_le_fichier_est_corrige_apres(self):
        with tempfile.TemporaryDirectory() as d:
            depot_de_test(d)
            ecrire(d, "poule.html", PAGE_ANONYME)
            git_ok(d, "commit", "-q", "-m", "base")
            ecrire(d, "poule.html", PAGE_POULE_REELLE)
            git_ok(d, "commit", "-q", "-m", "fuite")
            ecrire(d, "poule.html", PAGE_ANONYME)
            git_ok(d, "commit", "-q", "-m", "correction")
            code, sortie = self.verifier(d, "--commits", "HEAD~2..HEAD")
            self.assertEqual(code, 1)
            self.assertIn("poule.html", sortie)
            self.assertNotIn("DUPONT", sortie)
            self.assertEqual(self.verifier(d, "--commits", "HEAD~1..HEAD")[0], 0)

    def test_usage_incorrect_code_2(self):
        with tempfile.TemporaryDirectory() as d:
            depot_de_test(d)
            self.assertEqual(self.verifier(d)[0], 2)


class CrochetsGitTest(unittest.TestCase):
    def test_pre_commit_refuse_le_commit_d_une_page_avec_un_nom_en_clair_puis_accepte_la_page_anonymisee(self):
        with tempfile.TemporaryDirectory() as d:
            depot_de_test(d, avec_crochets=True)
            ecrire(d, "poule.html", PAGE_POULE_REELLE)
            r = git_ok(d, "commit", "-m", "page brute")
            self.assertNotEqual(r.returncode, 0, "le commit doit être refusé")
            self.assertIn("BLOQUÉ".encode("utf-8"), r.stdout + r.stderr)
            self.assertNotIn(b"DUPONT", r.stdout + r.stderr)
            self.assertEqual(git_ok(d, "rev-list", "--all", "--count").stdout.strip(), b"0")
            ecrire(d, "poule.html", PAGE_ANONYME)
            self.assertEqual(git_ok(d, "commit", "-m", "page anonymisée").returncode, 0)

    def test_pre_push_refuse_l_envoi_meme_apres_un_commit_fait_avec_no_verify(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as distant:
            git_ok(distant, "init", "-q", "--bare")
            depot_de_test(d, avec_crochets=True)
            git_ok(d, "remote", "add", "origin", distant)
            ecrire(d, "poule.html", PAGE_ANONYME)
            self.assertEqual(git_ok(d, "commit", "-q", "-m", "base").returncode, 0)
            ecrire(d, "poule.html", PAGE_POULE_REELLE)
            self.assertEqual(git_ok(d, "commit", "-q", "--no-verify", "-m", "fuite").returncode, 0)
            r = git_ok(d, "push", "origin", "HEAD:refs/heads/essai")
            self.assertNotEqual(r.returncode, 0, "l'envoi doit être refusé")
            self.assertEqual(git_ok(distant, "rev-list", "--all", "--count").stdout.strip(), b"0", "rien n'est arrivé sur le serveur")
            self.assertNotIn(b"DUPONT", r.stdout + r.stderr)
            git_ok(d, "reset", "-q", "--hard", "HEAD~1")
            self.assertEqual(git_ok(d, "push", "origin", "HEAD:refs/heads/essai").returncode, 0)

    def test_les_crochets_du_projet_appellent_le_verificateur_et_le_test_d_anonymisation(self):
        with open(os.path.join(RACINE, ".githooks", "pre-commit"), encoding="utf-8") as f:
            pre_commit = f.read()
        self.assertIn("tests/verifier_arbitres.py --index", pre_commit)
        self.assertIn("tests.test_collect.AnonymisationTest", pre_commit)
        with open(os.path.join(RACINE, ".githooks", "pre-push"), encoding="utf-8") as f:
            self.assertIn("tests/verifier_arbitres.py --commits", f.read())
        with open(os.path.join(RACINE, ".gitattributes"), encoding="utf-8") as f:
            self.assertIn(".githooks/* text eol=lf", f.read())  # un crochet en CRLF ne s'exécuterait pas
        self.assertNotIn(b"\r\n", open(os.path.join(RACINE, ".githooks", "pre-commit"), "rb").read())


if __name__ == "__main__":
    unittest.main()
