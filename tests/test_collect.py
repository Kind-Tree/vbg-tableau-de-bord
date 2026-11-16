import os, sys, unittest
from datetime import date
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collect

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
AUJ = date(2026, 11, 15)


def page(nom):
    with open(os.path.join(FIX, nom + ".html"), "rb") as f:
        return collect.decoder(f.read())


N3M = {"nom": "N3M", "code": "3MF", "ent": "ABCCS", "club": "VOLLEY BALL GREGORIEN"}
PRM = {"nom": "PRM", "code": "1PM", "ent": "PTBR35", "club": "ST GREGOIRE 2"}
COM = {"nom": "Coupe de France", "equipe": "N3M", "code": "COM", "ent": "ABCCS", "club": "VOLLEY BALL GREGORIEN"}
BCD = {"nom": "Coupe de Bretagne", "equipe": "M18M région", "code": "BCD", "ent": "LIBR", "club": "VOLLEY BALL GREGORIEN"}


class N3MTest(unittest.TestCase):
    def setUp(self):
        self.r = collect.analyser(page("n3m_complet"), N3M, AUJ)

    def test_classement(self):
        r = self.r
        self.assertEqual((r["rang"], r["sur"], r["pts"], r["g"], r["p"]), (8, 12, 6, 2, 4))

    def test_prochain_exterieur_avec_salle(self):
        self.assertEqual(self.r["prochain"], {
            "date": "2026-11-22", "lieu": "E", "adv": "C.P.B. RENNES 35",
            "heure": "16:00", "salle": "GYMNASE CDT BOUGOUIN"})

    def test_dernier_resultat_domicile(self):
        d = self.r["resultats"][0]
        self.assertEqual((d["date"], d["lieu"], d["pour"], d["contre"], d["sets"]),
                         ("2026-11-08", "D", 3, 0, "25-18 28-26 25-15"))

    def test_resultats_recents_en_premier_et_limites(self):
        dates = [x["date"] for x in self.r["resultats"]]
        self.assertEqual(dates, sorted(dates, reverse=True))
        self.assertLessEqual(len(dates), 5)

    def test_extérieur_retourne_sets(self):
        for x in self.r["resultats"]:
            if x["lieu"] == "E":
                self.assertGreater(x["pour"] + x["contre"], 0)
                self.assertEqual(len(x["sets"].split()), x["pour"] + x["contre"])


class PRMTest(unittest.TestCase):
    def setUp(self):
        self.r = collect.analyser(page("prm_complet"), PRM, AUJ)

    def test_classement_per_vide(self):
        r = self.r
        self.assertEqual((r["rang"], r["sur"], r["pts"], r["g"], r["p"]), (1, 10, 12, 4, 0))

    def test_resultats_du_prototype(self):
        r = self.r["resultats"]
        self.assertEqual([(x["date"], x["lieu"], x["pour"], x["contre"]) for x in r],
                         [("2026-11-07", "D", 3, 0), ("2026-10-24", "E", 3, 1),
                          ("2026-10-10", "D", 3, 0), ("2026-10-03", "E", 3, 0)])
        self.assertEqual(r[1]["sets"], "25-20 19-25 25-19 25-20")
        self.assertEqual(r[3]["sets"], "25-13 25-14 25-19")  # extérieur : 13:25 -> 25-13

    def test_prochain_du_prototype(self):
        self.assertEqual(self.r["prochain"], {
            "date": "2026-11-21", "lieu": "E", "adv": "RENNES CPB 4",
            "heure": "18:30", "salle": "STADE CDT BOUGOUIN"})


class CoupesTest(unittest.TestCase):
    def test_coupe_de_france(self):
        r = collect.analyser(page("coupe_com"), COM, AUJ, coupe=True)
        self.assertNotIn("rang", r)
        self.assertEqual(r["resultats"][0]["date"], "2026-11-14")
        x = r["resultats"][0]
        self.assertEqual((x["lieu"], x["pour"], x["contre"], x["sets"]), ("E", 3, 0, "25-13 25-11 25-11"))
        self.assertIsNone(r["prochain"])

    def test_coupe_de_bretagne_deux_sets_et_heure_vide(self):
        r = collect.analyser(page("coupe_bcd"), BCD, AUJ, coupe=True)
        res = {x["adv"]: x for x in r["resultats"]}
        self.assertEqual(len(res), 2)
        self.assertTrue(all((x["pour"], x["contre"]) == (2, 0) for x in res.values()))
        self.assertEqual(res["MAEN ROCH VOLLEY BALL"]["sets"], "26-24 25-11")


class GardesTest(unittest.TestCase):
    def test_page_d_une_autre_poule_rejetee(self):
        with self.assertRaises(collect.PouleIllisible):
            collect.analyser(page("pnf"), N3M, AUJ)

    def test_club_inconnu_rejete(self):
        with self.assertRaises(collect.PouleIllisible):
            collect.analyser(page("n3m_complet"), dict(N3M, club="VOLLEY BALL GREG"), AUJ)

    def test_equipes_exemptes_ignorees(self):
        cfg = {"nom": "M13F", "code": "BFC", "ent": "PTBR35", "club": "VB GREGORIEN"}
        ms = collect.matchs(collect.lignes(page("m13f")), "BFC")
        self.assertTrue(ms)
        self.assertFalse([m for m in ms if "xxxxx" in (m["dom"].lower(), m["ext"].lower())])

    def test_classement_m13_sans_colonnes_de_sets(self):
        cl = collect.classement(collect.lignes(page("m13f")))
        self.assertTrue(cl)
        self.assertTrue(all("pts" in r and "g" in r for r in cl))


class HeureParisTest(unittest.TestCase):
    def test_heure_d_ete_et_d_hiver(self):
        from datetime import datetime, timezone
        f = lambda *a: collect.decalage_paris(datetime(*a, tzinfo=timezone.utc)).utcoffset(None).total_seconds() / 3600
        self.assertEqual(f(2027, 3, 28, 0, 59), 1)
        self.assertEqual(f(2027, 3, 28, 1, 0), 2)
        self.assertEqual(f(2026, 10, 25, 0, 59), 2)
        self.assertEqual(f(2026, 10, 25, 1, 0), 1)
        self.assertEqual(f(2026, 11, 15, 12, 0), 1)


class FusionTest(unittest.TestCase):
    def test_poule_non_lue_garde_les_anciennes_donnees(self):
        ancien = {"equipes": [{"nom": "N3M", "rang": 8, "lu": "2026-11-08T21:00:00+01:00"}], "coupes": []}
        d = collect.fusionner(ancien, {}, {}, ["N3M"], [], "2026-11-15T21:00:00+01:00", {"N3M": "erreur"})
        e = d["equipes"][0]
        self.assertTrue(e["nonlu"])
        self.assertEqual(e["rang"], 8)
        self.assertEqual(e["lu"], "2026-11-08T21:00:00+01:00")



FIXTURE_DE = {"3MF": "n3m_complet", "PNF": "pnf_complet", "1PM": "prm_complet", "D1F": "d1f",
              "DMA": "d2m", "CPE": "m18m_cpe", "CPN": "m18m_cpn", "HCB": "m18m_hcb",
              "CMD": "m18f1", "CHB": "m18f2", "MCF": "m15f", "MMB": "m15m", "BFC": "m13f",
              "BMD": "m13m", "XSZ": "loisir1", "XSX": "loisir2", "COM": "coupe_com",
              "BCD": "coupe_bcd", "GMC": "coupe_gmc"}


class ToutesLesPoulesTest(unittest.TestCase):
    def test_chaque_poule_configuree_se_lit_avec_son_nom_de_club_exact(self):
        for c in collect.EQUIPES + collect.COUPES:
            for p in c["poules"]:
                with self.subTest(code=p["code"]):
                    r = collect.analyser_poule(page(FIXTURE_DE[p["code"]]), p, AUJ)
                    self.assertGreater(r["mes"], 0)

    def test_configuration_complete(self):
        self.assertEqual(collect.codes_connus(), set(FIXTURE_DE))

    def test_ordre_des_cartes(self):
        self.assertEqual([e["nom"] for e in collect.EQUIPES][:5], ["N3M", "PNF", "PRM", "D1F", "D2M"])
        self.assertEqual([e["nom"] for e in collect.EQUIPES][5:], [
            "M18M région", "M18M départemental", "M18F 1", "M18F 2", "M15F", "M15M", "M13F", "M13M",
            "Loisir Compet'Lib 1", "Loisir Compet'Lib 2"])

    def test_gmc_est_une_coupe_pas_une_equipe(self):
        self.assertNotIn("GMC", {p["code"] for e in collect.EQUIPES for p in e["poules"]})
        self.assertIn("GMC", {p["code"] for e in collect.COUPES for p in e["poules"]})

    def test_exemption_jeunes_prochain_sans_heure_ni_invention(self):
        cfg = next(e for e in collect.EQUIPES if e["nom"] == "M13F")
        r = collect.construire(cfg, [collect.analyser_poule(page("m13f"), cfg["poules"][0], AUJ)])
        self.assertNotIn("xxxxx", json_texte(r))
        self.assertEqual((r["rang"] is not None), True)


def json_texte(o):
    import json
    return json.dumps(o, ensure_ascii=False).lower()


class M18MRegionTest(unittest.TestCase):
    def setUp(self):
        self.cfg = next(e for e in collect.EQUIPES if e["nom"] == "M18M région")
        self.lues = [collect.analyser_poule(page(FIXTURE_DE[p["code"]]), p, AUJ) for p in self.cfg["poules"]]

    def test_cpn_active_des_qu_elle_a_des_matchs(self):
        r = collect.construire(self.cfg, self.lues)
        self.assertEqual(r["prochain"]["date"], "2026-11-21")
        self.assertEqual(r["prochain"]["adv"], "ETOILE ST LAURENT VB METROPOLE BREST")
        self.assertIn("M18M performance poule C", r["poule"])

    def test_cpn_sans_classement_n_invente_pas_de_rang(self):
        r = collect.construire(self.cfg, self.lues)
        self.assertNotIn("rang", r)
        self.assertIn("noteRang", r)

    def test_resultats_fusionnes_avec_la_poule_d_origine(self):
        r = collect.construire(self.cfg, self.lues)
        self.assertEqual([x["date"] for x in r["resultats"]], ["2026-11-07", "2026-10-31", "2026-10-03"])
        self.assertTrue(all(x["compet"] == "Poule E" for x in r["resultats"]))

    def test_repli_sur_cpe_si_cpn_n_a_pas_de_match(self):
        cpn_vide = dict(self.lues[0], mes=0, prochain=None)
        r = collect.construire(self.cfg, [cpn_vide, self.lues[1]])
        self.assertEqual(r["rang"], 4)
        self.assertIn("M18M performance poule E", r["poule"])


class NonSuiviesTest(unittest.TestCase):
    def test_rien_d_inconnu_aujourd_hui(self):
        pages = {"page club": page("club_class"), "page hebdo": page("planning_semaine")}
        self.assertEqual(collect.poules_non_suivies(pages, collect.codes_connus()), [])

    def test_code_inconnu_liste_avec_son_libelle(self):
        faux = page("planning_semaine").replace("COM - COUPE DE FRANCE", "ZZZ - COUPE NOUVELLE")
        r = collect.poules_non_suivies({"page hebdo": faux}, collect.codes_connus())
        self.assertEqual([x["code"] for x in r], ["ZZZ"])
        self.assertEqual(r[0]["libelle"], "Coupe nouvelle federale masculine")

    def test_libelle_lisible(self):
        self.assertEqual(collect.joli("COMPET LIB' POULE Z"), "Compet lib' poule Z")
        self.assertEqual(collect.joli("D1 FEMININE"), "D1 feminine")
        self.assertEqual(collect.joli("M18M PERFORMANCE POULE E"), "M18M performance poule E")


class CorrectionsDuCheckerTest(unittest.TestCase):
    def test_repli_cpn_vide_vers_cpe_par_le_vrai_chemin(self):
        cfg = next(e for e in collect.EQUIPES if e["nom"] == "M18M région")
        cpn = page("m18m_cpn").replace("VOLLEY BALL GREGORIEN", "AUTRE CLUB")
        lues = [collect.analyser_poule(cpn, cfg["poules"][0], AUJ),
                collect.analyser_poule(page("m18m_cpe"), cfg["poules"][1], AUJ)]
        self.assertEqual(lues[0]["mes"], 0)
        r = collect.construire(cfg, lues)
        self.assertEqual(r["rang"], 4)
        self.assertIn("M18M performance poule E", r["poule"])

    def test_aucune_poule_avec_match_du_club_est_une_erreur(self):
        cfg = next(e for e in collect.EQUIPES if e["nom"] == "M18M région")
        cpn = page("m18m_cpn").replace("VOLLEY BALL GREGORIEN", "AUTRE CLUB")
        with self.assertRaises(collect.PouleIllisible):
            collect.construire(cfg, [collect.analyser_poule(cpn, cfg["poules"][0], AUJ)])

    def test_page_tronquee_refusee_au_telechargement(self):
        import io
        from unittest import mock
        with open(os.path.join(FIX, "d2m.html"), "rb") as f:
            complete = f.read()
        class Rep(io.BytesIO):
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
        with mock.patch.object(collect.urllib.request, "urlopen", side_effect=lambda *a, **k: Rep(complete[:len(complete) // 2])),              mock.patch.object(collect.time, "sleep"):
            with self.assertRaises(collect.PouleIllisible):
                collect.telecharger("http://x/")
        with mock.patch.object(collect.urllib.request, "urlopen", side_effect=lambda *a, **k: Rep(complete)),              mock.patch.object(collect.time, "sleep"):
            self.assertIn("DEPARTEMENTALE 2", collect.telecharger("http://x/"))

    def test_points_negatifs_gardes(self):
        html_ = ("<table><tr><td></td><td></td><td>Points</td><td>Jou.</td><td>Gag.</td><td>Per.</td></tr>"
                 "<tr><td>1.</td><td>CLUB</td><td>-2</td><td>3</td><td>0</td><td>3</td></tr></table>")
        self.assertEqual(collect.classement(collect.lignes(html_))[0]["pts"], -2)

    def test_score_non_numerique_signale_et_jamais_invente(self):
        brut = page("n3m_complet")
        i = brut.index(">3MF032<")
        j = brut.index("class='lienblanc_pt'>3<", i)
        brut = brut[:j] + "class='lienblanc_pt'>F<" + brut[j + len("class='lienblanc_pt'>3<"):]
        r = collect.analyser(brut, N3M, AUJ)
        self.assertEqual(r["resultats"][0]["date"], "2026-11-01")  # le match illisible n'est pas un résultat
        self.assertIn("1 match(s)", r["noteResultats"])

    def test_match_du_jour_deja_commence_n_est_plus_a_venir(self):
        jour = date(2026, 11, 21)
        avant = collect.analyser(page("prm_complet"), PRM, jour, heure="10:00")
        apres = collect.analyser(page("prm_complet"), PRM, jour, heure="19:00")
        self.assertEqual(avant["prochain"]["date"], "2026-11-21")
        self.assertNotEqual((apres["prochain"] or {}).get("date"), "2026-11-21")

    def test_deux_resultats_le_meme_jour_ordre_stable(self):
        r = collect.analyser(page("coupe_bcd"), BCD, AUJ, coupe=True)
        self.assertEqual([x["adv"] for x in r["resultats"]], ["MAEN ROCH VOLLEY BALL", "UNION SPORTIVE LIFFREENNE"])

    def test_pas_de_champ_code_dans_la_sortie(self):
        r = collect.analyser(page("n3m_complet"), N3M, AUJ)
        self.assertFalse(any("code" in x for x in r["resultats"] + [r["prochain"]]))


if __name__ == "__main__":
    unittest.main()
