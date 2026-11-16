import os, re, sys, unittest
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


# ---- Lot 2 : « avenir » et « attente » (vue « Cette semaine ») ----
class AvenirTest(unittest.TestCase):
    def test_avenir_complet_et_trie(self):
        r = collect.analyser(page("prm_complet"), PRM, AUJ)
        brut = [m for m in collect.matchs(collect.lignes(page("prm_complet")), "1PM")
                if PRM["club"] in (m["dom"], m["ext"]) and not m["joue"] and m["date"] >= AUJ.isoformat()]
        self.assertGreater(len(brut), 1)
        self.assertEqual(len(r["avenir"]), len(brut))  # toute la liste, pas seulement le prochain
        cles = [(m["date"], m["heure"] or "") for m in r["avenir"]]
        self.assertEqual(cles, sorted(cles))
        self.assertEqual({m["adv"] for m in r["avenir"]} | {PRM["club"]},
                         {m["dom"] for m in brut} | {m["ext"] for m in brut})

    def test_champs_de_chaque_match_a_venir_sans_code(self):
        avenir = collect.analyser(page("n3m_complet"), N3M, AUJ)["avenir"]
        self.assertTrue(avenir)
        for m in avenir:
            self.assertEqual(set(m), {"date", "lieu", "adv", "heure", "salle"})

    def test_prochain_est_le_premier_avenir_pour_une_poule(self):
        for cfg in collect.EQUIPES + collect.COUPES:
            if len(cfg["poules"]) != 1:
                continue
            with self.subTest(nom=cfg["nom"]):
                p = cfg["poules"][0]
                r = collect.construire(cfg, [collect.analyser_poule(page(FIXTURE_DE[p["code"]]), p, AUJ)],
                                       coupe=cfg in collect.COUPES)
                self.assertEqual(r["prochain"], r["avenir"][0] if r["avenir"] else None)
                self.assertIn("attente", r)

    def test_coupes_servies_aussi(self):
        cfg = next(c for c in collect.COUPES if c["nom"] == "Coupe CD35 masculine")
        p = cfg["poules"][0]
        r = collect.construire(cfg, [collect.analyser_poule(page("coupe_gmc"), p, AUJ)], coupe=True)
        self.assertEqual(r["equipe"], "PRM")
        self.assertEqual(r["avenir"][0]["date"], "2026-12-12")
        self.assertEqual(r["prochain"], r["avenir"][0])
        self.assertEqual(r["attente"], [])
        vide = collect.analyser(page("coupe_com"), COM, AUJ, coupe=True)  # coupe sans match à venir
        self.assertEqual((vide["avenir"], vide["attente"]), ([], []))

    def test_fusion_multi_poules_triee_par_date_et_heure(self):
        cfg = next(e for e in collect.EQUIPES if e["nom"] == "M18M région")
        lues = [collect.analyser_poule(page(FIXTURE_DE[p["code"]]), p, AUJ) for p in cfg["poules"]]
        n0 = len(lues[0]["avenir"])
        autre = {"code": "CPE099", "date": "2026-11-21", "lieu": "D", "adv": "AUTRE", "heure": "10:00", "salle": None}
        avant = {"code": "CPE098", "date": "2026-11-19", "lieu": "E", "adv": "AVANT", "heure": None, "salle": None}
        lues[1] = dict(lues[1], avenir=[autre, avant])
        r = collect.construire(cfg, lues)
        self.assertEqual(r["avenir"][0]["adv"], "AVANT")  # la date la plus proche passe devant, quelle que soit la poule
        cles = [(m["date"], m["heure"] or "") for m in r["avenir"]]
        self.assertEqual(cles, sorted(cles))
        self.assertEqual(len(r["avenir"]), n0 + 2)
        self.assertEqual(r["prochain"]["adv"], "ETOILE ST LAURENT VB METROPOLE BREST")  # « prochain » ne change pas
        self.assertFalse(any("code" in m for m in r["avenir"]))

    def test_attente_match_du_jour_dont_l_heure_est_passee(self):
        jour = date(2026, 11, 21)  # PRM joue à 18 h 30
        avant = collect.analyser(page("prm_complet"), PRM, jour, heure="10:00")
        apres = collect.analyser(page("prm_complet"), PRM, jour, heure="19:00")
        self.assertEqual(avant["attente"], [])
        self.assertEqual([(m["date"], m["heure"]) for m in apres["attente"]], [("2026-11-21", "18:30")])
        self.assertNotIn("2026-11-21", [m["date"] for m in apres["avenir"]])
        self.assertNotIn("pour", apres["attente"][0])  # jamais de score inventé

    def test_attente_le_lendemain_puis_jusqu_au_dimanche_de_la_semaine_suivante(self):
        # Match du samedi 21/11 (semaine du lundi 16/11) : visible tout le reste de la semaine,
        # puis toute la semaine suivante jusqu'au dimanche 29/11 inclus, absent le lundi 30/11.
        for jour, present in ((date(2026, 11, 22), True), (date(2026, 11, 27), True), (date(2026, 11, 28), True),
                              (date(2026, 11, 29), True), (date(2026, 11, 30), False)):
            with self.subTest(jour=jour.isoformat()):
                r = collect.analyser(page("prm_complet"), PRM, jour, heure="07:00")
                # (les matchs suivants du calendrier deviennent aussi « sans score » avec le temps : on ne suit que celui-ci)
                self.assertEqual([m["date"] for m in r["attente"] if m["date"] == "2026-11-21"],
                                 ["2026-11-21"] if present else [])

    def test_attente_un_lundi_reste_jusqu_au_dimanche_d_apres(self):
        # Même match déplacé au lundi 16/11 : 13 jours plus tard (dimanche 29/11) il est encore là,
        # ce que l'ancienne règle des 7 jours aurait déjà supprimé.
        brut = page("prm_complet")
        i = brut.index(">1PMA022<")
        j = brut.index("21/11/26", i)
        self.assertLess(j - i, 200)  # bien la date de cette ligne
        lundi = brut[:j] + "16/11/26" + brut[j + len("21/11/26"):]
        for jour, present in ((date(2026, 11, 17), True), (date(2026, 11, 29), True), (date(2026, 11, 30), False)):
            with self.subTest(jour=jour.isoformat()):
                r = collect.analyser(lundi, PRM, jour, heure="07:00")
                self.assertEqual([m["date"] for m in r["attente"] if m["date"] == "2026-11-16"],
                                 ["2026-11-16"] if present else [])

    def test_attente_ne_contient_jamais_un_match_joue_ni_a_venir(self):
        for jour in (date(2026, 11, 16), date(2026, 11, 22), date(2026, 11, 30)):
            r = collect.analyser(page("prm_complet"), PRM, jour, heure="23:00")
            vus = {(m["date"], m["adv"]) for m in r["resultats"] + r["avenir"]}
            self.assertFalse({(m["date"], m["adv"]) for m in r["attente"]} & vus)
            self.assertTrue(all("pour" not in m for m in r["attente"]))

    def test_attente_score_illisible(self):
        brut = page("n3m_complet")
        i = brut.index(">3MF032<")
        j = brut.index("class='lienblanc_pt'>3<", i)
        brut = brut[:j] + "class='lienblanc_pt'>F<" + brut[j + len("class='lienblanc_pt'>3<"):]
        r = collect.analyser(brut, N3M, date(2026, 11, 10))
        ill = [m for m in r["attente"] if m.get("illisible")]
        self.assertEqual(len(ill), 1)
        self.assertEqual((ill[0]["date"], ill[0]["adv"], ill[0]["lieu"]), ("2026-11-08", "CESSON VOLLEY SAINT-BRIEUC COTES D'ARMOR 2", "D"))
        self.assertTrue(set(ill[0]) <= {"date", "lieu", "adv", "heure", "salle", "illisible"})
        self.assertNotIn("2026-11-08", [m["date"] for m in r["avenir"]])
        self.assertNotIn("2026-11-08", [m["date"] for m in r["resultats"]])
        # le match du dimanche 08/11 (semaine du 02/11) reste jusqu'au dimanche 15/11, puis quitte « attente »
        self.assertEqual(len([m for m in collect.analyser(brut, N3M, AUJ)["attente"] if m.get("illisible")]), 1)
        self.assertEqual([m for m in collect.analyser(brut, N3M, date(2026, 11, 16))["attente"] if m.get("illisible")], [])

    def test_match_joue_n_est_ni_a_venir_ni_en_attente(self):
        r = collect.analyser(page("n3m_complet"), N3M, date(2026, 11, 9))
        res = {(m["date"], m["adv"]) for m in r["resultats"]}
        autres = {(m["date"], m["adv"]) for m in r["avenir"] + r["attente"]}
        self.assertFalse(res & autres)

    def test_noms_reserves_par_la_page(self):
        import re
        import unicodedata
        for c in collect.EQUIPES:
            ascii_ = unicodedata.normalize("NFD", c["nom"]).encode("ascii", "ignore").decode().lower()
            self.assertNotIn(re.sub(r"[^a-z0-9]+", "-", ascii_).strip("-"), {"semaine", "coupes", "toutes"})


class FusionLot2Test(unittest.TestCase):
    def test_nouveaux_champs_recopies_pour_une_poule_lue(self):
        e = collect.analyser(page("prm_complet"), PRM, AUJ)
        d = collect.fusionner({}, {"PRM": e}, {}, ["PRM"], [], "2026-11-15T21:00:00+01:00", {})
        self.assertEqual(d["equipes"][0]["avenir"], e["avenir"])
        self.assertEqual(d["equipes"][0]["attente"], e["attente"])

    def test_carte_nonlu_garde_ses_anciens_champs(self):
        ancien = {"equipes": [{"nom": "N3M", "rang": 8, "avenir": [{"date": "2026-11-22"}], "attente": [],
                               "lu": "2026-11-08T21:00:00+01:00"}], "coupes": []}
        d = collect.fusionner(ancien, {}, {}, ["N3M"], [], "2026-11-15T21:00:00+01:00", {"N3M": "erreur"})
        e = d["equipes"][0]
        self.assertTrue(e["nonlu"])
        self.assertEqual(e["avenir"], [{"date": "2026-11-22"}])
        self.assertEqual(e["lu"], "2026-11-08T21:00:00+01:00")

    def test_ancien_data_json_sans_les_champs_passe(self):
        ancien = {"equipes": [{"nom": "N3M", "rang": 8, "prochain": None, "resultats": []}],
                  "coupes": [{"nom": "C", "prochain": None, "resultats": []}]}
        d = collect.fusionner(ancien, {}, {}, ["N3M"], ["C"], "2026-11-15T21:00:00+01:00", {"N3M": "x", "C": "y"})
        self.assertNotIn("avenir", d["equipes"][0])  # rien d'inventé : le champ reste absent
        self.assertTrue(d["equipes"][0]["nonlu"] and d["coupes"][0]["nonlu"])

    def test_collecte_complete_hors_ligne_sur_un_ancien_fichier_sans_les_champs(self):
        import io
        import json
        import re
        import tempfile
        from unittest import mock

        def fausse_page(url, *a, **k):
            if "planning_club_class" in url:
                return page("club_class")
            if "planning_club.php" in url:
                return page("planning_semaine")
            return page(FIXTURE_DE[re.search(r"poule=(\w+)", url).group(1)])

        with tempfile.TemporaryDirectory() as dossier:
            sortie = os.path.join(dossier, "data.json")
            ancien = {"maj": "x", "equipes": [{"nom": "N3M", "prochain": None, "resultats": []}],
                      "coupes": [], "nonsuivies": []}
            with open(sortie, "w", encoding="utf-8") as f:
                json.dump(ancien, f)
            with mock.patch.object(collect, "telecharger", side_effect=fausse_page), \
                    mock.patch.object(collect.time, "sleep"), mock.patch("sys.stdout", new=io.StringIO()):
                code = collect.main(["--out", sortie])
            self.assertEqual(code, 0)
            with open(sortie, encoding="utf-8") as f:
                d = json.load(f)
        self.assertEqual(len(d["equipes"]), len(collect.EQUIPES))
        for c in d["equipes"] + d["coupes"]:
            self.assertIsInstance(c["avenir"], list, c["nom"])
            self.assertIsInstance(c["attente"], list, c["nom"])
            self.assertFalse(c.get("nonlu"), c["nom"])


# ---- Lot 3 : bloc « Semaine dernière », collectes supplémentaires ----
class Lot3Test(unittest.TestCase):
    def test_resultats_portent_l_heure_pour_le_tri_de_la_page(self):
        r = collect.analyser(page("n3m_complet"), N3M, AUJ)
        self.assertTrue(all("heure" in x for x in r["resultats"]))
        self.assertEqual(r["resultats"][0]["heure"], "15:00")
        sans = collect.analyser(page("coupe_bcd"), BCD, AUJ, coupe=True)
        self.assertTrue(all("heure" in x for x in sans["resultats"]))  # None si FFvolley n'en donne pas

    def test_resultats_contiennent_tous_les_matchs_joues_de_la_semaine_precedente(self):
        """VALABLE POUR LES PAGES DE TEST SEULEMENT (au plus 2 matchs par carte sur deux semaines) : le plafond
        de 5 résultats par carte ne l'est pas par construction, voir test_plafond_de_5_limite_connue. Pour chaque carte et chaque semaine, tous les matchs joués de la semaine précédente figurent
        dans « resultats » pendant toute la semaine où la page les affiche (lundi au dimanche suivants)."""
        from datetime import timedelta
        verifies = 0
        for c in collect.EQUIPES + collect.COUPES:
            tous = []
            for p in c["poules"]:
                for m in collect.matchs(collect.lignes(page(FIXTURE_DE[p["code"]])), p["code"]):
                    v = collect.vu_du_club(m, p["club"])
                    if v and "pour" in v:
                        tous.append(v)
            for d0 in {date.fromisoformat(v["date"]) for v in tous}:
                lundi = d0 - timedelta(days=d0.weekday())
                attendus = {(v["date"], v["adv"]) for v in tous
                            if lundi.isoformat() <= v["date"] <= (lundi + timedelta(days=6)).isoformat()}
                for jour in (lundi + timedelta(days=7), lundi + timedelta(days=13)):  # lundi et dimanche d'après
                    lues = [collect.analyser_poule(page(FIXTURE_DE[p["code"]]), p, jour, "23:59") for p in c["poules"]]
                    # les pages de test datent du 15/11 : on ne garde que ce qui était déjà joué ce jour-là
                    lues = [dict(l, joues=[r for r in l["joues"] if r["date"] <= jour.isoformat()]) for l in lues]
                    if not any(l["mes"] for l in lues):
                        continue
                    out = collect.construire(c, lues, coupe=c in collect.COUPES)
                    presents = {(r["date"], r["adv"]) for r in out["resultats"]}
                    with self.subTest(carte=c["nom"], jour=jour.isoformat()):
                        self.assertLessEqual(attendus, presents)
                    verifies += 1
        self.assertGreater(verifies, 40)  # le test a bien parcouru les semaines de toutes les cartes

    def test_plafond_de_5_limite_connue(self):
        """Limite connue, NON corrigée (décision du président) : au-delà de 5 résultats, les plus anciens sont coupés,
        y compris un match de la semaine précédente."""
        lues = [{"code": "X", "titre": "T", "mes": 6, "illisibles": 0, "prochain": None, "avenir": [], "attente": [],
                 "classement": None,
                 "joues": [{"date": d, "heure": h, "lieu": "D", "adv": "A", "pour": 3, "contre": 0, "sets": "", "code": "X%d" % i}
                           for i, (d, h) in enumerate([("2026-11-21", "14:00"), ("2026-11-21", "10:00"), ("2026-11-15", "14:00"),
                                                       ("2026-11-15", "10:00"), ("2026-11-14", "14:00"), ("2026-11-14", "10:00")])]}]
        r = collect.construire({"nom": "X", "poules": [{"code": "X", "ent": "E", "club": "C"}]}, lues)
        self.assertEqual(len(r["resultats"]), collect.NB_RESULTATS)
        self.assertEqual(sum(x["date"] == "2026-11-14" for x in r["resultats"]), 1)  # l'un des deux matchs du 14/11 est perdu

    def test_pas_de_donnee_inventee_dans_l_attente(self):
        r = collect.analyser(page("prm_complet"), PRM, date(2026, 11, 22), heure="07:00")
        self.assertEqual(set(r["attente"][0]), {"date", "lieu", "adv", "heure", "salle"})


class PlanificationTest(unittest.TestCase):
    """collecte.yml : chaque cron est dans la bonne branche de l'étape « Saison »."""

    def setUp(self):
        with open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "collecte.yml"), encoding="utf-8") as f:
            self.yml = f.read()
        self.crons = re.findall(r'^\s*- cron: "([^"]+)"', self.yml, re.M)
        m = re.search(r'case "[^"]*" in\s*\n\s*(.*?\) planifie=\+0200 ;;)', self.yml, re.S)
        self.ete = set(re.findall(r'"([^"]+)"', m.group(1)))

    def test_dix_cron_sans_doublon(self):
        self.assertEqual(len(self.crons), 10)
        self.assertEqual(len(set(self.crons)), 10)

    def test_les_cinq_lignes_d_ete_sont_dans_la_branche_ete_et_aucune_autre(self):
        self.assertEqual(self.ete, {"0 16 * * 5", "0 7 * * 0", "0 19 * * 0", "0 21 * * 0", "0 5 * * 1"})
        self.assertTrue(self.ete <= set(self.crons))

    def test_passages_en_heure_de_paris(self):
        """Avec le décalage de leur branche, les passages sont exactement : ven 18 h, dim 9 h, 21 h, 23 h, lun 7 h,
        chacun une fois en été et une fois en hiver."""
        paris = []
        for cron in self.crons:
            mn, h, _, _, j = cron.split()
            self.assertEqual(mn, "0")
            paris.append((int(j), int(h) + (2 if cron in self.ete else 1)))
        self.assertEqual(sorted(paris), sorted([(5, 18), (0, 9), (0, 21), (0, 23), (1, 7)] * 2))
        self.assertEqual(sorted(p for c, p in zip(self.crons, paris) if c in self.ete),
                         sorted(p for c, p in zip(self.crons, paris) if c not in self.ete))

    def test_alerte_apres_la_publication_et_sans_tee(self):
        self.assertLess(self.yml.index("Publication de data.json"), self.yml.index("Alerte si une poule"))
        self.assertIn("steps.collecte.outputs.code == '2'", self.yml)
        ligne = next(x for x in self.yml.splitlines() if "python collect.py" in x)
        self.assertNotRegex(ligne.split("#")[0], r"(?<!\|)\|(?!\|)")  # un tube masquerait le code de sortie de Python

    def test_alerte_chaine_complete(self):
        """Le code de sortie est publié par l'étape « Collecte » (id), lu par l'alerte, qui échoue et nomme les poules."""
        collecte = self.yml.split("- name: Collecte")[1].split("- name: Publication")[0]
        alerte = self.yml.split("- name: Alerte")[1]
        self.assertIn("id: collecte", collecte)
        self.assertIn('echo "code=${code:-0}" >> "$GITHUB_OUTPUT"', collecte)
        self.assertRegex(collecte, r'-ge 3 \] \|\| \[ "\$\{code:-0\}" = 1 \]')  # 1 et >= 3 : rouge ; 2 : vert
        self.assertIn("if: steps.collecte.outputs.code == '2'", alerte)
        self.assertNotIn("-ge 2", self.yml)
        self.assertIn("::error::", alerte)
        self.assertRegex(alerte, r"(?m)^\s+exit 1\s*$")


if __name__ == "__main__":
    unittest.main()
