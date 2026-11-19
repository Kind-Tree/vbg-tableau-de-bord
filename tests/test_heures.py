"""Heures saisies par le club : validation (heures.py), application à data.json (collect.appliquer_heures),
persistance d'une collecte à l'autre, et contrôle des deux workflows (heure.yml, collecte.yml)."""
import io
import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.join(ICI, "..")
sys.path.insert(0, ICI)
sys.path.insert(0, RACINE)
import collect
import heures
import test_programme as P


def donnees():
    """data.json minimal : M13F a un plateau le 21/11 (2 matchs du club + 1 match étranger + notre ligne exempte)."""
    nous = "VB GREGORIEN"
    return {"equipes": [
        {"nom": "M13F", "prochain": {"date": "2026-11-21", "adv": "A", "heure": None},
         "avenir": [{"date": "2026-11-21", "adv": "A", "heure": None},
                    {"date": "2026-11-21", "adv": "B", "heure": None},
                    {"date": "2026-12-05", "adv": "C", "heure": None}],
         "attente": [], "resultats": [],
         "poules": [{"nous": nous, "matchs": [
             {"date": "2026-11-21", "dom": "X", "ext": nous},
             {"date": "2026-11-21", "dom": nous, "ext": "Y"},
             {"date": "2026-11-21", "dom": "Z", "ext": "W"},
             {"date": "2026-11-21", "dom": nous, "exempt": True},
             {"date": "2026-12-05", "dom": "X", "ext": nous}]}]},
        {"nom": "N3M", "prochain": {"date": "2027-01-16", "adv": "D", "heure": "20:00"},
         "avenir": [{"date": "2027-01-16", "adv": "D", "heure": "20:00"}], "attente": [], "resultats": [],
         "poules": [{"nous": "VOLLEY BALL GREGORIEN", "matchs": [
             {"date": "2027-01-16", "dom": "VOLLEY BALL GREGORIEN", "ext": "D", "heure": "20:00"}]}]}]}


def tous(e):
    return collect._tous_les_matchs(e)


class DossierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.chemin = os.path.join(self.tmp.name, "heures.json")
        self.data = os.path.join(self.tmp.name, "data.json")
        with open(self.data, "w", encoding="utf-8") as f:
            json.dump(donnees(), f)

    def lancer(self, equipe, date, heure, maintenant=None):
        env = {"HEURE_EQUIPE": equipe, "HEURE_DATE": date, "HEURE_HEURE": heure}
        return heures.executer(env, self.chemin, self.data, maintenant or datetime(2026, 11, 19, 12, 0))

    def lues(self):
        with open(self.chemin, encoding="utf-8") as f:
            return json.load(f)


class ValidationTest(DossierTest):
    REFUS = [
        ("N3M;rm -rf /", "16/01", "18:30"), ("$(id)", "16/01", "18:30"), ("`id`", "16/01", "18:30"),
        ("n3m", "16/01", "20:00"), ("", "16/01", "20:00"), ("Equipe inconnue", "16/01", "20:00"),
        ("M13F", "31/02", "18:30"), ("M13F", "2026-11-21", "18:30"), ("M13F", "21/11/2026", "18:30"),
        ("M13F", "21-11", "18:30"), ("M13F", "99/99", "18:30"), ("M13F", "", "18:30"),
        ("M13F", "21/11", "25:00"), ("M13F", "21/11", "18h30"), ("M13F", "21/11", "18:30\nx"),
        ("M13F", "21/11", "18:3"), ("M13F", "21/11", "1830"), ("M13F", "21/11", "18:30; ls"),
        ("M13F", "21/11", "$(id)"), ("M13F", "21/11\n22/11", "18:30"),
        ("M13F", "22/11", "18:30"),   # pas de match ce jour-là
        ("N3M", "21/11", "18:30"),    # match de M13F, pas de N3M
        ("M13F", "29/02", "18:30"),   # 2027 n'est pas bissextile
    ]

    def test_entrees_refusees_et_rien_n_est_ecrit(self):
        for equipe, date, heure in self.REFUS:
            with self.subTest(equipe=equipe, date=date, heure=heure):
                with self.assertRaises(heures.SaisieRefusee):
                    self.lancer(equipe, date, heure)
                self.assertFalse(os.path.exists(self.chemin))

    def test_saisie_valide_et_espaces_du_clavier_retires(self):
        self.lancer(" M13F ", " 21/11 ", " 18:30 ")
        self.assertEqual(self.lues(), [{"equipe": "M13F", "date": "2026-11-21", "heure": "18:30",
                                        "saisie": "2026-11-19T12:00"}])

    def test_annee_deduite_de_la_saison(self):
        self.assertEqual(collect.SAISON, "2026/2027")  # si la saison change, revoir ces cas
        for jj, attendu in (("21/11", "2026-11-21"), ("15/01", "2027-01-15"), ("31/07", "2027-07-31"),
                            ("01/08", "2026-08-01"), ("31/12", "2026-12-31")):
            self.assertEqual(heures.date_iso(jj), attendu)

    def test_match_de_janvier_accepte_avec_annee_2027(self):
        self.lancer("N3M", "16/01", "21:00")
        self.assertEqual(self.lues()[0]["date"], "2027-01-16")

    def test_remplacement_une_seule_ligne_par_equipe_et_jour(self):
        self.lancer("M13F", "21/11", "18:30")
        self.lancer("M13F", "21/11", "19:00")
        self.lancer("N3M", "16/01", "21:00")
        self.assertEqual([(s["equipe"], s["date"], s["heure"]) for s in self.lues()],
                         [("M13F", "2026-11-21", "19:00"), ("N3M", "2027-01-16", "21:00")])

    def test_heure_vide_supprime(self):
        self.lancer("M13F", "21/11", "18:30")
        self.lancer("N3M", "16/01", "21:00")
        self.assertIn("supprimée", self.lancer("M13F", "21/11", ""))
        self.assertEqual([s["equipe"] for s in self.lues()], ["N3M"])

    def test_suppression_d_une_heure_inexistante_refusee(self):
        self.lancer("N3M", "16/01", "21:00")
        avant = self.lues()
        with self.assertRaises(heures.SaisieRefusee):
            self.lancer("M13F", "21/11", "")
        self.assertEqual(self.lues(), avant)

    def test_suppression_possible_meme_si_le_match_a_disparu_de_data_json(self):
        self.lancer("M13F", "21/11", "18:30")
        with open(self.data, "w", encoding="utf-8") as f:
            json.dump({"equipes": []}, f)
        self.lancer("M13F", "21/11", "")
        self.assertEqual(self.lues(), [])

    def test_heures_json_illisible_jamais_ecrase(self):
        with open(self.chemin, "w", encoding="utf-8") as f:
            f.write("{pas du json")
        with self.assertRaises(heures.SaisieRefusee):
            self.lancer("M13F", "21/11", "18:30")
        with open(self.chemin, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{pas du json")

    def test_data_json_illisible_refuse(self):
        with open(self.data, "w", encoding="utf-8") as f:
            f.write("")
        with self.assertRaises(heures.SaisieRefusee):
            self.lancer("M13F", "21/11", "18:30")

    def test_main_code_1_sur_refus_et_0_sur_succes(self):
        env = {"HEURE_EQUIPE": "M13F", "HEURE_DATE": "31/02", "HEURE_HEURE": "18:30"}
        with mock.patch.object(heures, "CHEMIN_HEURES", self.chemin), mock.patch.object(heures, "CHEMIN_DATA", self.data), \
                mock.patch.dict(os.environ, env), mock.patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(heures.main(), 1)
            os.environ["HEURE_DATE"] = "21/11"
            self.assertEqual(heures.main(), 0)


class ApplicationTest(unittest.TestCase):
    def saisie(self, equipe, date, heure):
        return {"equipe": equipe, "date": date, "heure": heure, "saisie": "x"}

    def appliquer(self, data, saisies):
        messages = []
        collect.appliquer_heures(data, saisies, messages.append)
        return messages

    def test_plateau_tous_les_matchs_du_club_ce_jour_mais_pas_les_autres(self):
        d = donnees()
        self.appliquer(d, [self.saisie("M13F", "2026-11-21", "18:30")])
        e = d["equipes"][0]
        self.assertEqual(e["prochain"]["heure_saisie"], "18:30")
        self.assertEqual([m.get("heure_saisie") for m in e["avenir"]], ["18:30", "18:30", None])
        ms = e["poules"][0]["matchs"]
        self.assertEqual([m.get("heure_saisie") for m in ms], ["18:30", "18:30", None, None, None])
        self.assertIsNone(d["equipes"][1]["prochain"].get("heure_saisie"))

    def test_l_heure_de_ffvolley_n_est_jamais_modifiee_et_l_ecart_est_signale(self):
        d = donnees()
        messages = self.appliquer(d, [self.saisie("N3M", "2027-01-16", "18:30")])
        self.assertEqual(d["equipes"][1]["prochain"]["heure"], "20:00")
        self.assertEqual(d["equipes"][1]["prochain"]["heure_saisie"], "18:30")
        ecarts = [m for m in messages if m.startswith("ECART heure")]
        self.assertEqual(ecarts, ["ECART heure : N3M 2027-01-16 FFvolley 20:00, saisie 18:30"])

    def test_pas_d_ecart_quand_ffvolley_donne_la_meme_heure(self):
        d = donnees()
        self.assertEqual(self.appliquer(d, [self.saisie("N3M", "2027-01-16", "20:00")]), [])

    def test_saisie_sans_match_avertie_et_rien_ajoute(self):
        d = donnees()
        messages = self.appliquer(d, [self.saisie("M13F", "2026-11-22", "18:30"), self.saisie("PNF", "2026-11-21", "18:30")])
        self.assertEqual(len([m for m in messages if m.startswith("AVERTISSEMENT heure saisie sans match")]), 2)
        self.assertNotIn("heure_saisie", json.dumps(d))

    def test_heure_retiree_de_heures_json_disparait_de_data_json(self):
        d = donnees()
        self.appliquer(d, [self.saisie("M13F", "2026-11-21", "18:30")])
        self.assertIn("heure_saisie", json.dumps(d))
        self.appliquer(d, [])
        self.assertNotIn("heure_saisie", json.dumps(d))

    def test_charger_heures(self):
        with tempfile.TemporaryDirectory() as dossier:
            chemin = os.path.join(dossier, "heures.json")
            self.assertEqual(collect.charger_heures(chemin), [])   # absent
            bon = self.saisie("M13F", "2026-11-21", "18:30")
            mauvais = [{"equipe": "M13F", "date": "21/11", "heure": "18:30"}, {"equipe": "M13F", "date": "2026-11-21", "heure": "25:00"},
                       {"equipe": 3, "date": "2026-11-21", "heure": "18:30"}, "texte", {"date": "2026-11-21"}]
            with open(chemin, "w", encoding="utf-8") as f:
                json.dump([bon] + mauvais, f)
            self.assertEqual(collect.charger_heures(chemin), [bon])
            with open(chemin, "w", encoding="utf-8") as f:
                f.write("{")
            with self.assertRaises(ValueError):
                collect.charger_heures(chemin)
            with open(chemin, "w", encoding="utf-8") as f:
                f.write("{}")
            with self.assertRaises(ValueError):
                collect.charger_heures(chemin)


class PersistanceTest(unittest.TestCase):
    """main() hors ligne (pages de poule du 19/11) : une heure saisie reste affichée après chaque collecte,
    même si FFvolley ne la publie jamais, même si la poule de l'équipe n'a pas pu être lue."""

    def lancer(self, sortie, chemin_heures, poule_en_echec=None):
        def fausse_page(url, *a, **k):
            if "planning_club_class" in url:
                return P.page("club_class")
            if "planning_club.php" in url:
                return P.page("club_s48" if "date_jour" in url else "club_s47")
            code = url.split("poule=")[1].split("&")[0]
            if code == poule_en_echec:
                raise collect.PouleIllisible("HTTP 503")
            return P.page(P.FIXTURE_19[code])

        tampon = io.StringIO()
        with mock.patch.object(collect, "telecharger", side_effect=fausse_page), \
                mock.patch.object(collect.time, "sleep"), mock.patch("sys.stdout", new=tampon), \
                mock.patch.object(collect, "maintenant_paris", return_value=datetime(2026, 11, 19, 12, 0)):
            code = collect.main(["--out", sortie, "--heures", chemin_heures])
        with open(sortie, encoding="utf-8") as f:
            return code, tampon.getvalue(), json.load(f)

    def equipe(self, d, nom="M18F 1"):
        return next(e for e in d["equipes"] if e["nom"] == nom)

    def test_heure_saisie_reste_apres_chaque_collecte_meme_poule_non_lue(self):
        with tempfile.TemporaryDirectory() as dossier:
            sortie, chemin = os.path.join(dossier, "data.json"), os.path.join(dossier, "heures.json")
            with open(chemin, "w", encoding="utf-8") as f:
                json.dump([{"equipe": "M18F 1", "date": "2026-11-21", "heure": "18:30", "saisie": "x"}], f)
            code, sortie_texte, d = self.lancer(sortie, chemin)
            self.assertEqual(code, 0, sortie_texte)
            e = self.equipe(d)
            self.assertIsNone(e["prochain"]["heure"], "précondition : FFvolley ne donne pas l'heure de ce match")
            self.assertEqual(e["prochain"]["date"], "2026-11-21")
            self.assertEqual(e["prochain"]["heure_saisie"], "18:30")
            self.assertTrue(all(m["heure_saisie"] == "18:30" for m in e["avenir"] if m["date"] == "2026-11-21"))
            nous = next(p for p in e["poules"] if p["active"])["nous"]
            moi = [m for m in next(p for p in e["poules"] if p["active"])["matchs"]
                   if m["date"] == "2026-11-21" and nous in (m["dom"], m.get("ext")) and not m.get("exempt")]
            self.assertTrue(moi and all(m["heure_saisie"] == "18:30" for m in moi))
            # deuxième collecte : FFvolley ne publie toujours rien
            code, _, d = self.lancer(sortie, chemin)
            self.assertEqual(self.equipe(d)["prochain"]["heure_saisie"], "18:30")
            # troisième collecte : la poule de l'équipe n'est pas lisible (ancien contenu conservé)
            code, _, d = self.lancer(sortie, chemin, poule_en_echec="CMD")
            e = self.equipe(d)
            self.assertTrue(e.get("nonlu"))
            self.assertEqual(e["prochain"]["heure_saisie"], "18:30")
            # l'heure supprimée de heures.json disparaît au passage suivant
            with open(chemin, "w", encoding="utf-8") as f:
                json.dump([], f)
            code, _, d = self.lancer(sortie, chemin)
            self.assertNotIn("heure_saisie", json.dumps(d))

    def test_heures_json_illisible_la_collecte_continue(self):
        with tempfile.TemporaryDirectory() as dossier:
            sortie, chemin = os.path.join(dossier, "data.json"), os.path.join(dossier, "heures.json")
            with open(chemin, "w", encoding="utf-8") as f:
                f.write("{")
            code, texte, d = self.lancer(sortie, chemin)
            self.assertEqual(code, 0, texte)
            self.assertIn("heures.json illisible", texte)
            self.assertEqual(len(d["equipes"]), len(collect.EQUIPES))

    def test_ecart_dans_le_rapport_de_collecte(self):
        with tempfile.TemporaryDirectory() as dossier:
            sortie, chemin = os.path.join(dossier, "data.json"), os.path.join(dossier, "heures.json")
            code, _, d = self.lancer(sortie, os.path.join(dossier, "absent.json"))
            e = next(e for e in d["equipes"] if e["prochain"] and e["prochain"].get("heure"))
            with open(chemin, "w", encoding="utf-8") as f:
                json.dump([{"equipe": e["nom"], "date": e["prochain"]["date"], "heure": "07:07", "saisie": "x"}], f)
            code, texte, d = self.lancer(sortie, chemin)
            self.assertEqual(code, 0, texte)
            self.assertIn("ECART heure : %s %s FFvolley %s, saisie 07:07" % (e["nom"], e["prochain"]["date"], e["prochain"]["heure"]), texte)
            self.assertEqual(self.equipe(d, e["nom"])["prochain"]["heure"], e["prochain"]["heure"])


def lire(nom):
    with open(os.path.join(RACINE, ".github", "workflows", nom), encoding="utf-8") as f:
        return f.read()


class WorkflowsTest(unittest.TestCase):
    CRONS = ["0 16 * * 5", "0 7 * * 0", "0 19 * * 0", "0 21 * * 0", "0 5 * * 1",
             "0 17 * * 5", "0 8 * * 0", "0 20 * * 0", "0 22 * * 0", "0 6 * * 1"]

    def test_liste_deroulante_identique_aux_equipes_de_la_configuration(self):
        texte = lire("heure.yml")
        bloc = re.search(r"\n      equipe:\n(.*?)\n      date:", texte, re.S).group(1)
        self.assertIn("type: choice", bloc)
        options = re.findall(r'^          - "(.*)"$', bloc, re.M)
        self.assertEqual(options, [e["nom"] for e in collect.EQUIPES])

    def test_aucune_entree_dans_un_run(self):
        # Une entrée n'a le droit de figurer que dans un `env:` (ligne « NOM: ${{ inputs.x }} »).
        for nom in ("heure.yml", "collecte.yml"):
            for n, ligne in enumerate(lire(nom).splitlines(), 1):
                if ligne.lstrip().startswith("#"):
                    continue
                if re.search(r"\binputs\b|github\.event\.inputs", ligne) and "${{" in ligne:
                    self.assertRegex(ligne, r"^\s+[A-Z_]+: \$\{\{ inputs\.(equipe|date|heure) \}\}$", "%s:%d" % (nom, n))
        # et la collecte n'a aucune entrée
        self.assertNotIn("inputs", lire("collecte.yml").replace("workflow_dispatch: {}", ""))

    def test_expressions_dans_les_run_limitees_a_ce_qui_est_sur(self):
        # Dans heure.yml, aucun « ${{ » ailleurs que dans les `env:` (3 entrées, jeton, branche) et checkout/setup.
        autorises = re.compile(r"^\s+(HEURE_EQUIPE|HEURE_DATE|HEURE_HEURE|GH_TOKEN|BRANCHE): \$\{\{ (inputs\.\w+|github\.token|github\.ref_name) \}\}$")
        for n, ligne in enumerate(lire("heure.yml").splitlines(), 1):
            if "${{" in ligne and not ligne.lstrip().startswith("#"):
                self.assertRegex(ligne, autorises, "heure.yml:%d" % n)

    def test_file_d_attente_et_pas_d_annulation(self):
        for nom, groupe in (("heure.yml", "heures"), ("collecte.yml", "collecte")):
            texte = lire(nom)
            bloc = re.search(r"\nconcurrency:\n((?:  .*\n)+)", texte).group(1)
            self.assertIn("group: " + groupe, bloc)
            self.assertRegex(bloc, r"(?m)^  queue: max\b")
            self.assertRegex(bloc, r"(?m)^  cancel-in-progress: false\b")
            self.assertNotIn("cancel-in-progress: true", texte)

    def test_heure_yml_lancement_manuel_seulement_et_nom(self):
        texte = lire("heure.yml")
        self.assertTrue(texte.startswith("name: Ajouter une heure\n"))
        self.assertIn("workflow_dispatch:", texte)
        for interdit in ("schedule:", "push:", "pull_request"):
            self.assertNotIn(interdit, texte)
        self.assertRegex(texte, r"(?m)^  contents: write$")
        self.assertRegex(texte, r"(?m)^  actions: write$")
        self.assertIn('git commit -m "Heure saisie"', texte)
        self.assertIn("git add heures.json", texte)
        self.assertNotIn("git add docs", texte)

    def test_horaires_planifies_inchanges(self):
        self.assertEqual(re.findall(r'^    - cron: "([^"]+)"', lire("collecte.yml"), re.M), self.CRONS)


if __name__ == "__main__":
    unittest.main()
