// Tests de docs/index.html : le script de la page est exécuté dans un DOM simulé (aucune dépendance).
// Lancer : node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RACINE = path.join(__dirname, "..", "docs");
const HTML = fs.readFileSync(path.join(RACINE, "index.html"), "utf8");
const SCRIPT = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const DATA = JSON.parse(fs.readFileSync(path.join(RACINE, "data.json"), "utf8"));

const CORPS = HTML.slice(HTML.indexOf("<body>"), HTML.indexOf("<script>"));
const IDS_HTML = new Set([...CORPS.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this.hidden = false; this.value = ""; this.listeners = {}; this.disabled = false; }
  append(...n) { for (const x of n) this.children.push(typeof x === "string" ? { text: x } : x); }
  replaceChildren(...n) { this.children = []; this.append(...n); }
  set textContent(v) { this.children = [{ text: String(v) }]; }
  get textContent() { return this.children.map(c => (c.text !== undefined ? c.text : c.textContent)).join(""); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  trouver(pred, out = []) { for (const c of this.children) { if (c.tag) { if (pred(c)) out.push(c); c.trouver(pred, out); } } return out; }
}

const tick = () => new Promise(r => setImmediate(r));

// Charge la page dans un contexte isolé.
async function charger({ hash = "", memo = null, aujourdhui = "2026-11-15T12:00:00Z", donnees = DATA, reseau = true, stockageCasse = false } = {}) {
  const elements = {};
  const winEcouteurs = {};
  const stock = {};
  if (memo) stock["vbg-vue"] = memo;
  const FIXE = new Date(aujourdhui).getTime();
  class Dfixe extends Date { constructor(...a) { if (a.length) super(...a); else super(FIXE); } static now() { return FIXE; } }
  const location = { hash };
  const etat = { reseau, donnees };
  const sandbox = {
    Date: Dfixe,
    AbortController,
    // les délais de 10 s de la page passent en 1 ms pour tester l'abandon d'une requête pendante
    setTimeout: (f, ms) => setTimeout(f, ms >= 1000 ? 1 : ms),
    clearTimeout,
    document: {
      // comme un vrai navigateur : un identifiant absent du HTML donne null (et le script plante)
      getElementById(id) {
        if (!IDS_HTML.has(id)) return null;
        return elements[id] || (elements[id] = new El("#" + id));
      },
      createElement(tag) { return new El(tag); },
    },
    window: { addEventListener(t, f) { (winEcouteurs[t] = winEcouteurs[t] || []).push(f); } },
    location,
    history: { replaceState(_a, _b, url) { location.hash = url; } },
    localStorage: stockageCasse
      ? { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("bloqué"); } }
      : { getItem: k => (k in stock ? stock[k] : null), setItem: (k, v) => { stock[k] = v; } },
    fetch: async (_u, opt = {}) => {
      if (etat.reseau === "pendante") {
        return new Promise((_ok, ko) => opt.signal && opt.signal.addEventListener("abort", () => ko(new Error("abandon"))));
      }
      if (!etat.reseau) throw new Error("hors ligne");
      return { ok: true, json: async () => etat.donnees };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  await new Promise(r => setTimeout(r, reseau === "pendante" ? 30 : 0));
  await tick();
  const p = {
    el: id => sandbox.document.getElementById(id), location, stock, sandbox, etat,
    cartes: () => p.el("grille").children,
    titres: () => p.el("grille").children.map(c => c.trouver(e => e.tag === "h2")[0].textContent),
    options: () => p.el("vue").children.map(o => ({ v: o.value, t: o.textContent })),
    choisir: async v => { p.el("vue").value = v; p.el("vue").listeners.change.forEach(f => f({ target: p.el("vue") })); await tick(); },
    clic: async id => { p.el(id).listeners.click.forEach(f => f({ preventDefault() {} })); await tick(); },
    hashchange: async h => { location.hash = h; winEcouteurs.hashchange.forEach(f => f()); await tick(); },
  };
  return p;
}

test("slug : accents, espaces et apostrophes", async () => {
  const p = await charger();
  const slug = vm.runInContext("slug", p.sandbox);
  assert.equal(slug("M18M région"), "m18m-region");
  assert.equal(slug("Loisir Compet'Lib 1"), "loisir-compet-lib-1");
  assert.equal(slug("N3M"), "n3m");
});

test("par défaut : « Cette semaine », adresse #semaine", async () => {
  const p = await charger();
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.equal(p.el("vue").value, "semaine");
  assert.equal(p.location.hash, "#semaine");
});

test("menu : « Cette semaine » en tête, puis équipes dans l'ordre des cartes, Coupes, Toutes les équipes", async () => {
  const p = await charger();
  const o = p.options();
  assert.deepEqual(o[0], { v: "semaine", t: "Cette semaine" });
  assert.deepEqual(o.slice(1, 6).map(x => x.t), ["N3M", "PNF", "PRM", "D1F", "D2M"]);
  assert.deepEqual(o.slice(-2).map(x => x.t), ["Coupes", "Toutes les équipes"]);
  assert.equal(o.length, DATA.equipes.length + 3);
  assert.deepEqual(o.slice(1, 1 + DATA.equipes.length).map(x => x.t), DATA.equipes.map(e => e.nom));
});

test("l'adresse l'emporte sur le choix mémorisé", async () => {
  const p = await charger({ hash: "#pnf", memo: "d1f" });
  assert.deepEqual(p.titres(), ["PNF"]);
});

test("sans adresse, le choix mémorisé est repris et reflété dans l'adresse", async () => {
  const p = await charger({ memo: "d1f" });
  assert.deepEqual(p.titres(), ["D1F"]);
  assert.equal(p.location.hash, "#d1f");
});

test("adresse inconnue : retour au choix mémorisé, puis à « Cette semaine »", async () => {
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "pnf" })).titres(), ["PNF"]);
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "nimporte" })).titres(), ["Cette semaine"]);
});

test("adresse avec accents encodés (#m18m-r%C3%A9gion n'existe pas, #m18m-region oui)", async () => {
  assert.deepEqual((await charger({ hash: "#m18m-region" })).titres(), ["M18M région"]);
  assert.deepEqual((await charger({ hash: "#%ZZ" })).titres(), ["Cette semaine"]); // adresse mal formée : pas de plantage
});

test("changer d'équipe : carte, adresse et mémoire", async () => {
  const p = await charger();
  await p.choisir("prm");
  assert.deepEqual(p.titres(), ["PRM"]);
  assert.equal(p.location.hash, "#prm");
  assert.equal(p.stock["vbg-vue"], "prm");
  assert.equal(p.el("vue").value, "prm");
});

test("vue Coupes : seule la carte Coupes", async () => {
  const p = await charger();
  await p.choisir("coupes");
  assert.deepEqual(p.titres(), ["Coupes"]);
});

test("Toutes les équipes : toutes les cartes, Coupes en fin de page si aucun match dans 7 jours", async () => {
  const p = await charger();
  await p.choisir("toutes");
  const t = p.titres();
  assert.equal(t.length, DATA.equipes.length + 1);
  assert.equal(t[t.length - 1], "Coupes");
  assert.equal(t[0], "N3M");
});

test("Toutes les équipes : Coupes en tête si un match de coupe a lieu dans les 7 jours", async () => {
  const p = await charger({ aujourdhui: "2026-12-08T12:00:00Z" }); // prochain match de coupe : 12/12
  await p.choisir("toutes");
  assert.equal(p.titres()[0], "Coupes");
});

test("ligne « Match de coupe cette semaine » : seulement en vue d'une équipe et dans les 7 jours", async () => {
  const loin = await charger({ hash: "#n3m" });
  assert.equal(loin.el("lien-coupe").hidden, true);
  const p = await charger({ hash: "#n3m", aujourdhui: "2026-12-08T12:00:00Z" });
  assert.equal(p.el("lien-coupe").hidden, false);
  assert.match(HTML, /Match de coupe cette semaine/);
  await p.choisir("semaine");
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("toutes");
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("coupes");
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("pnf");
  assert.equal(p.el("lien-coupe").hidden, false);
});

test("un match de coupe passé ou à plus de 7 jours ne déclenche pas la ligne", async () => {
  assert.equal((await charger({ hash: "#n3m", aujourdhui: "2026-12-04T12:00:00Z" })).el("lien-coupe").hidden, true); // 8 jours
  assert.equal((await charger({ hash: "#n3m", aujourdhui: "2026-12-05T12:00:00Z" })).el("lien-coupe").hidden, false); // 7 jours
  assert.equal((await charger({ hash: "#n3m", aujourdhui: "2026-12-13T12:00:00Z" })).el("lien-coupe").hidden, true); // passé
});

test("la ligne de coupe ouvre la carte Coupes", async () => {
  const p = await charger({ hash: "#n3m", aujourdhui: "2026-12-08T12:00:00Z" });
  await p.clic("lien-coupe");
  assert.deepEqual(p.titres(), ["Coupes"]);
  assert.equal(p.location.hash, "#coupes");
});

test("Actualiser conserve l'équipe choisie", async () => {
  const p = await charger();
  await p.choisir("m13f");
  await p.clic("btn");
  assert.deepEqual(p.titres(), ["M13F"]);
  assert.equal(p.el("vue").value, "m13f");
  assert.equal(p.location.hash, "#m13f");
});

test("modification manuelle de l'adresse", async () => {
  const p = await charger();
  await p.hashchange("#d2m");
  assert.deepEqual(p.titres(), ["D2M"]);
  await p.hashchange("#inconnue");
  assert.deepEqual(p.titres(), ["D2M"]); // adresse invalide : on garde la vue
});

test("heure de mise à jour et encart « non suivie » visibles dans toutes les vues", async () => {
  const d = JSON.parse(JSON.stringify(DATA));
  d.nonsuivies = [{ code: "ZZZ", libelle: "Coupe nouvelle", source: "page hebdo" }];
  const p = await charger({ donnees: d });
  for (const v of ["semaine", "n3m", "coupes", "toutes"]) {
    await p.choisir(v);
    assert.notEqual(p.el("maj").textContent, "–", v);
    assert.equal(p.el("encart").hidden, false, v);
    assert.match(p.el("encart").textContent, /Compétition non suivie : ZZZ, Coupe nouvelle/);
  }
});

test("localStorage bloqué : la page fonctionne quand même", async () => {
  const p = await charger({ stockageCasse: true });
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  await p.choisir("pnf");
  assert.deepEqual(p.titres(), ["PNF"]);
});

test("hors ligne : données intégrées affichées avec le même menu", async () => {
  const p = await charger({ reseau: false });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.ok(p.options().length > 3);
});

test("coupes absentes de data.json : pas d'entrée « Coupes », pas de plantage", async () => {
  const d = JSON.parse(JSON.stringify(DATA)); delete d.coupes;
  const p = await charger({ donnees: d, aujourdhui: "2026-12-08T12:00:00Z" });
  assert.ok(!p.options().some(o => o.v === "coupes"));
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("toutes");
  assert.equal(p.titres().length, d.equipes.length);
});

test("équipe mémorisée absente des nouvelles données : retour à « Cette semaine »", async () => {
  const p = await charger({ memo: "equipe-disparue" });
  assert.deepEqual(p.titres(), ["Cette semaine"]);
});

test("charte : pas de bleu, pas de dégradé, focus et tap-highlight orange/transparent", () => {
  assert.match(HTML, /-webkit-tap-highlight-color:transparent/);
  assert.match(HTML, /button:focus-visible,select:focus-visible[^{]*\{outline:3px solid #F26910/);
  assert.doesNotMatch(HTML, /gradient/i);
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  const couleurs = [...new Set(css.match(/#[0-9A-Fa-f]{6}\b/g).map(c => c.toUpperCase()))].sort();
  assert.deepEqual(couleurs, ["#111111", "#1A1A1A", "#1E7A3C", "#1F1F1F", "#6B6B6B", "#B3261E", "#D9D9D9", "#F26910", "#FFFFFF"]);
});

test("select : 48 px, fond #1F1F1F, texte blanc, bordure #D9D9D9 ; zones tactiles ≥ 44 px", () => {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  const regle = css.match(/select\{([^}]*)\}/)[1];
  assert.match(regle, /height:48px/);
  assert.match(regle, /background:#1F1F1F/);
  assert.match(regle, /color:#FFFFFF/);
  assert.match(regle, /border:1px solid #D9D9D9/);
  assert.match(css.match(/\.lien-coupe\{([^}]*)\}/)[1], /min-height:48px/);
});

// ---- Robustesse (rapport du checker) ----
test("données invalides sur une équipe : seule sa carte est abîmée, menu et choix intacts", async () => {
  const d = JSON.parse(JSON.stringify(DATA));
  d.equipes.find(e => e.nom === "D1F").prochain = { lieu: "D", adv: "X" }; // pas de date
  const p = await charger({ donnees: d });
  await p.choisir("toutes");
  assert.equal(p.titres().length, d.equipes.length + 1);
  assert.equal(p.location.hash, "#toutes");
  await p.choisir("d1f");
  assert.deepEqual(p.titres(), ["D1F"]);
  assert.match(p.cartes()[0].textContent, /illisibles/);
  assert.equal(p.location.hash, "#d1f");
  // le choix mémorisé ne doit pas renvoyer toute la page aux données intégrées au chargement suivant
  const p2 = await charger({ donnees: d, memo: "d1f" });
  assert.equal(p2.el("src").textContent, "Dernière mise à jour");
});

test("coupe avec une date manquante : la ligne de coupe ne plante pas", async () => {
  const d = JSON.parse(JSON.stringify(DATA));
  d.coupes[0].prochain = { lieu: "E", adv: "X" };
  const p = await charger({ donnees: d });
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("coupes");
  assert.deepEqual(p.titres(), ["Coupes"]);
});

test("nom d'équipe nul écarté ; maj absent affiché « – » ; équipes absentes : données intégrées", async () => {
  const d = JSON.parse(JSON.stringify(DATA));
  d.equipes.push({ nom: null }); delete d.maj;
  const p = await charger({ donnees: d });
  assert.equal(p.options().length, DATA.equipes.length + 3);
  assert.equal(p.el("maj").textContent, "–");
  const vide = JSON.parse(JSON.stringify(DATA)); delete vide.equipes;
  const p2 = await charger({ donnees: vide });
  assert.equal(p2.el("src").textContent, "Données intégrées du");
});

test("Actualiser hors ligne garde les données plus récentes déjà affichées", async () => {
  const d = JSON.parse(JSON.stringify(DATA)); d.maj = "2026-11-16T08:00:00+01:00";
  const p = await charger({ donnees: d });
  const avant = p.el("maj").textContent;
  p.etat.reseau = false;
  await p.clic("btn");
  assert.equal(p.el("maj").textContent, avant);
  assert.equal(p.el("src").textContent, "Actualisation impossible, données du");
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.equal(p.el("btn").disabled, false);
});

test("requête pendante au premier chargement : abandon, données intégrées, bouton réactivé", async () => {
  const p = await charger({ reseau: "pendante" });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.equal(p.el("btn").disabled, false);
});

// ---- Structure du HTML et charte (le DOM simulé ne les voit pas) ----
test("chaque identifiant lu par le script existe dans le HTML", () => {
  const ids = [...SCRIPT.matchAll(/getElementById\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 6);
  for (const id of new Set(ids)) assert.ok(IDS_HTML.has(id), "id manquant : " + id);
});

test("HTML : étiquette du menu, lien et encart masqués au départ", () => {
  assert.match(CORPS, /<select id="vue" aria-label="[^"]+"/);
  assert.match(CORPS, /<a [^>]*id="lien-coupe"[^>]*\shidden[\s>]/);
  assert.match(CORPS, /<div [^>]*id="encart"[^>]*\shidden[\s>]/);
});

function reglesCss() {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
  return { css, regles: [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), corps: m[2] })) };
}

test("charte : l'orange #F26910 seulement sur les éléments d'accent autorisés", () => {
  const permis = new Set(["h2", ".rang b", ".pastille", "button", ".lien-coupe", "option:checked",
    "button:focus-visible,select:focus-visible,.lien-coupe:focus-visible"]);
  for (const { sel, corps } of reglesCss().regles) {
    if (/#F26910/i.test(corps)) assert.ok(permis.has(sel), "orange non autorisé sur : " + sel);
  }
});

test("charte : tap-highlight transparent actif (pas en commentaire), focus orange sur menu, bouton et ligne", () => {
  const { css, regles } = reglesCss();
  assert.match(css, /-webkit-tap-highlight-color:transparent/);
  const focus = regles.find(r => /:focus-visible/.test(r.sel));
  for (const s of ["button:focus-visible", "select:focus-visible", ".lien-coupe:focus-visible"]) assert.ok(focus.sel.includes(s), s);
  assert.match(focus.corps, /outline:3px solid #F26910/);
});

test("mise en page : une seule règle select, tailles tactiles ≥ 44 px, grille compatible 360 px", () => {
  const { regles } = reglesCss();
  assert.equal(regles.filter(r => r.sel === "select").length, 1);
  const px = (sel, prop) => Number((regles.find(r => r.sel === sel).corps.match(new RegExp(prop + ":(\\d+)px")) || [])[1]);
  assert.ok(px("button", "min-height") >= 44);
  assert.ok(px("select", "height") >= 44);
  assert.ok(px(".lien-coupe", "min-height") >= 44);
  const grille = regles.find(r => r.sel === ".grille").corps;
  assert.ok(Number(grille.match(/minmax\((\d+)px/)[1]) <= 300);
});

test("« hidden » doit réellement masquer : aucun display explicite ne l'écrase (.lien-coupe, .encart)", () => {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const sel of [".lien-coupe", ".encart"]) {
    const debut = css.indexOf(sel + "{");
    assert.ok(debut >= 0, sel + " introuvable dans le CSS");
    const corps = css.slice(debut, css.indexOf("}", debut));
    if (/display:/.test(corps)) {
      assert.ok(css.includes(sel + "[hidden]{display:none}"), sel + " a un display sans règle [hidden]");
    }
  }
});

// ---- Application iPhone (icône sur l'écran d'accueil) ----
const TETE = HTML.slice(0, HTML.indexOf("</head>"));

function dimensionsPng(fichier) {
  const b = fs.readFileSync(path.join(RACINE, fichier));
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", fichier + " : signature PNG");
  assert.equal(b.subarray(12, 16).toString("ascii"), "IHDR", fichier + " : en-tête IHDR");
  // type de couleur 2 = RVB sans canal alpha : pas de transparence (iOS la remplirait en noir)
  return { l: b.readUInt32BE(16), h: b.readUInt32BE(20), couleur: b[25] };
}

test("application : liens du <head> vers le manifeste et l'icône, métadonnées iOS", () => {
  assert.match(TETE, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(TETE, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
  assert.match(TETE, /<meta name="apple-mobile-web-app-title" content="VBG">/);
  assert.match(TETE, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(TETE, /<meta name="apple-mobile-web-app-status-bar-style" content="black">/);
});

test("application : les fichiers liés existent, aux dimensions attendues, sans transparence", () => {
  for (const [f, t] of [["apple-touch-icon.png", 180], ["icone-192.png", 192], ["icone-512.png", 512]]) {
    assert.ok(fs.existsSync(path.join(RACINE, f)), f + " absent");
    const d = dimensionsPng(f);
    assert.deepEqual([d.l, d.h], [t, t], f);
    assert.equal(d.couleur, 2, f + " : doit être RVB sans alpha");
  }
  assert.ok(fs.existsSync(path.join(RACINE, "manifest.webmanifest")));
});

test("application : manifeste JSON valide avec les champs attendus", () => {
  const m = JSON.parse(fs.readFileSync(path.join(RACINE, "manifest.webmanifest"), "utf8"));
  assert.equal(m.name, "VBG – Tableau de bord");
  assert.equal(m.short_name, "VBG");
  assert.equal(m.lang, "fr");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.equal(m.background_color, "#111111");
  assert.equal(m.theme_color, "#111111");
  const tailles = m.icons.map(i => i.sizes).sort();
  assert.deepEqual(tailles, ["192x192", "512x512"]);
  for (const i of m.icons) {
    assert.equal(i.type, "image/png");
    const d = dimensionsPng(i.src);
    assert.equal(i.sizes, d.l + "x" + d.h, i.src + " : taille déclarée = taille réelle");
  }
});

test("application : pas de service worker (un cache pourrait servir un vieux data.json)", () => {
  assert.doesNotMatch(HTML, /serviceWorker/);
  assert.ok(!fs.existsSync(path.join(RACINE, "sw.js")));
});

test("application : en-tête sous la barre d'état (pas de viewport-fit=cover) ; menu et « Actualiser » restent la navigation", () => {
  assert.doesNotMatch(TETE, /viewport-fit/);
  // sans barre de navigateur : pas de retour ni de rechargement, tout passe par le menu et le bouton
  assert.ok(IDS_HTML.has("vue") && IDS_HTML.has("btn"));
});

// ---- Vue « Cette semaine » (lot 2) ----
// Semaine de référence : lundi 16/11/2026 au dimanche 22/11/2026 (heure de Paris, UTC+1 en novembre).
const SAMEDI_MIDI = "2026-11-21T11:00:00Z";      // samedi 21/11, 12 h à Paris
const DIMANCHE_2330 = "2026-11-22T22:30:00Z";    // dimanche 22/11, 23 h 30 à Paris
const LUNDI_0030 = "2026-11-22T23:30:00Z";       // lundi 23/11, 0 h 30 à Paris

function donneesSemaine() {
  return {
    maj: "2026-11-21T07:00:00+01:00",
    equipes: [
      { nom: "N3M", poule: "Nationale 3", lu: "2026-11-21T07:00:00+01:00",
        resultats: [
          { date: "2026-11-18", lieu: "D", adv: "ADV MERCREDI", pour: 3, contre: 0, sets: "25-18 25-20 25-15" },
          { date: "2026-11-08", lieu: "E", adv: "HORS SEMAINE", pour: 0, contre: 3, sets: "14-25 24-26 23-25" }],
        prochain: { date: "2026-11-21", lieu: "E", adv: "CPB RENNES", heure: "16:00", salle: "GYMNASE BOUGOUIN" },
        avenir: [{ date: "2026-11-21", lieu: "E", adv: "CPB RENNES", heure: "16:00", salle: "GYMNASE BOUGOUIN" },
                 { date: "2026-11-22", lieu: "D", adv: "ADV DIMANCHE", heure: "14:00", salle: null },
                 { date: "2026-11-28", lieu: "D", adv: "SEMAINE SUIVANTE", heure: "20:00", salle: null }],
        attente: [] },
      { nom: "PNF", poule: "Prénationale", lu: "2026-11-21T07:00:00+01:00",
        resultats: [], prochain: { date: "2026-11-21", lieu: "E", adv: "PLANCOET", heure: "19:00", salle: null },
        avenir: [{ date: "2026-11-21", lieu: "E", adv: "PLANCOET", heure: "19:00", salle: null }],
        attente: [{ date: "2026-11-20", lieu: "D", adv: "ADV ATTENTE", heure: "20:00", salle: null },
                  { date: "2026-11-17", lieu: "E", adv: "ADV ILLISIBLE", heure: null, salle: null, illisible: true }] },
      { nom: "M13F", poule: "M13", lu: "2026-11-21T07:00:00+01:00",
        resultats: [], prochain: { date: "2026-11-21", lieu: "E", adv: "CHATEAUBOURG", heure: null, salle: "LIFFRE" },
        avenir: [{ date: "2026-11-21", lieu: "E", adv: "CHATEAUBOURG", heure: null, salle: "LIFFRE" }], attente: [] },
      { nom: "Loisir", poule: "Compet lib", lu: "2026-11-21T07:00:00+01:00",
        resultats: [], prochain: { date: "2026-11-23", lieu: "D", adv: "ADV LUNDI", heure: "20:00", salle: "LA RICOQUAIS" },
        avenir: [{ date: "2026-11-23", lieu: "D", adv: "ADV LUNDI", heure: "20:00", salle: "LA RICOQUAIS" }], attente: [] },
    ],
    coupes: [
      { nom: "Coupe CD35 masculine", equipe: "PRM", lu: "2026-11-21T07:00:00+01:00", resultats: [],
        prochain: { date: "2026-11-21", lieu: "E", adv: "ROMILLE", heure: "10:00", salle: null },
        avenir: [{ date: "2026-11-21", lieu: "E", adv: "ROMILLE", heure: "10:00", salle: null }], attente: [] },
    ],
    nonsuivies: [],
  };
}

// Lit la carte « Cette semaine » : [{ titre, aujourdhui, lignes: [texte, ...] }] dans l'ordre d'affichage.
function jours(p) {
  const out = []; let cur = null;
  for (const n of p.cartes()[0].children) {
    if (n.tag === "h3") { cur = { titre: n.textContent.replace("Aujourd'hui", ""), aujourdhui: n.textContent.includes("Aujourd'hui"), lignes: [] }; out.push(cur); }
    else if (n.tag === "ul" && cur) for (const li of n.children) cur.lignes.push(li.textContent);
  }
  return out;
}
const titresJours = p => jours(p).map(j => j.titre);
const programme = p => jours(p).flatMap(j => j.lignes).join("");  // texte du programme seul (hors « Semaine dernière »)

async function avecFuseau(tz, f) {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try {
    assert.equal(new Date("2026-11-22T22:30:00Z").getTimezoneOffset(), { "Pacific/Auckland": -780, "America/Los_Angeles": 480 }[tz], "le fuseau du téléphone doit avoir changé");
    return await f();
  } finally { if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant; }
}

test("semaine : adresse #semaine réservée, par défaut sans adresse ni mémoire ; l'adresse puis la mémoire l'emportent", async () => {
  assert.deepEqual((await charger({ hash: "#semaine", memo: "pnf" })).titres(), ["Cette semaine"]);
  assert.deepEqual((await charger({ hash: "#pnf", memo: "semaine" })).titres(), ["PNF"]);
  assert.deepEqual((await charger({ memo: "d1f" })).titres(), ["D1F"]); // la mémoire n'est pas écrasée par la vue par défaut
  const p = await charger();
  assert.equal(p.location.hash, "#semaine");
  assert.equal(p.options()[0].v, "semaine");
  await p.choisir("n3m");
  assert.equal(p.stock["vbg-vue"], "n3m");
  await p.hashchange("#semaine");
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.equal(p.stock["vbg-vue"], "semaine");
});

test("semaine : lignes regroupées par jour, jour courant signalé, tri par heure (sans heure en dernier) puis ordre des cartes", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  const j = jours(p);
  assert.deepEqual(j.map(x => x.titre), ["mardi 17/11", "mercredi 18/11", "vendredi 20/11", "samedi 21/11", "dimanche 22/11"]);
  assert.deepEqual(j.map(x => x.aujourdhui), [false, false, false, true, false]);
  const samedi = j[3].lignes;
  assert.equal(samedi.length, 4);
  // 10 h coupe, 16 h N3M, 19 h PNF, puis le match sans heure
  assert.match(samedi[0], /10 h 00.*PRM · Coupe CD35 masculine.*ExtérieurROMILLE/);
  assert.match(samedi[1], /16 h 00N3MExtérieurCPB RENNESGYMNASE BOUGOUIN/);
  assert.match(samedi[2], /19 h 00PNFExtérieurPLANCOET/);
  assert.match(samedi[3], /Sans heureM13FExtérieurCHATEAUBOURGLIFFRE/);
  assert.match(j[4].lignes[0], /14 h 00N3MDomicileADV DIMANCHE/);
  assert.doesNotMatch(p.cartes()[0].textContent, /SEMAINE SUIVANTE|HORS SEMAINE|ADV LUNDI/);
  assert.match(p.cartes()[0].textContent, /Du 16\/11 au 22\/11/);
});

test("semaine : un résultat s'affiche avec pastille V ou D et score en sets", async () => {
  const d = donneesSemaine();
  d.equipes[0].resultats.push({ date: "2026-11-19", lieu: "E", adv: "ADV PERDU", pour: 1, contre: 3, sets: "20-25 25-20 18-25 22-25" });
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const j = jours(p);
  assert.match(j[1].lignes[0], /^VN3MDomicileADV MERCREDI3–0 · 25-18 25-20 25-15$/);
  assert.match(j.find(x => x.titre === "jeudi 19/11").lignes[0], /^DN3MExtérieurADV PERDU1–3 · 20-25 25-20 18-25 22-25$/);
});

test("semaine : deux matchs de la même équipe dans la semaine sont tous deux affichés", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  const n3m = jours(p).flatMap(j => j.lignes).filter(l => l.includes("N3M"));
  assert.equal(n3m.length, 3); // résultat de mercredi + deux matchs à venir (samedi et dimanche)
});

test("semaine : bornes lundi 0 h / dimanche 24 h en heure de Paris, téléphone réglé sur un autre fuseau", async () => {
  for (const tz of ["Pacific/Auckland", "America/Los_Angeles"]) {
    await avecFuseau(tz, async () => {
      const dim = await charger({ donnees: donneesSemaine(), aujourdhui: DIMANCHE_2330 });
      assert.match(dim.cartes()[0].textContent, /Du 16\/11 au 22\/11/, tz);
      assert.deepEqual(titresJours(dim), ["mardi 17/11", "mercredi 18/11", "vendredi 20/11", "samedi 21/11", "dimanche 22/11"], tz);
      assert.equal(jours(dim)[4].aujourdhui, true, tz);
      assert.doesNotMatch(programme(dim), /ADV LUNDI/, tz);
      const lun = await charger({ donnees: donneesSemaine(), aujourdhui: LUNDI_0030 });
      assert.match(lun.cartes()[0].textContent, /Du 23\/11 au 29\/11/, tz);
      assert.deepEqual(titresJours(lun), ["lundi 23/11", "samedi 28/11"], tz);
      assert.equal(jours(lun)[0].aujourdhui, true, tz);
      assert.match(jours(lun)[0].lignes[0], /20 h 00LoisirDomicileADV LUNDILA RICOQUAIS/, tz);
      assert.doesNotMatch(programme(lun), /ADV DIMANCHE|ADV MERCREDI/, tz); // semaine du 16/11 : désormais « Semaine dernière »
    });
  }
});

test("semaine : match passé à Paris sans score « Commencé, résultat au prochain relevé » ; sans heure, à venir jusqu'à la fin du jour", async () => {
  const apres = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T16:30:00Z" }); // samedi 17 h 30 Paris
  const s = jours(apres).find(x => x.titre === "samedi 21/11").lignes;
  assert.match(s.find(l => l.includes("CPB RENNES")), /Commencé, résultat au prochain relevé/);
  assert.doesNotMatch(s.find(l => l.includes("CPB RENNES")), /^[VD]/); // pas de pastille V ou D
  assert.doesNotMatch(s.find(l => l.includes("PLANCOET")), /Commencé/); // 19 h : pas encore
  assert.doesNotMatch(s.find(l => l.includes("CHATEAUBOURG")), /Commencé/); // sans heure : jusqu'à la fin du jour
  const lendemain = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-22T08:00:00Z" });
  const s2 = jours(lendemain).find(x => x.titre === "samedi 21/11").lignes;
  assert.ok(s2.every(l => /Commencé, résultat au prochain relevé/.test(l)), "tous les matchs de samedi sont passés dimanche");
});

test("semaine : à l'heure exacte du match, il compte comme passé (même règle que le collecteur)", async () => {
  const pile = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T15:00:00Z" }); // 16 h 00 Paris
  assert.match(jours(pile).find(x => x.titre === "samedi 21/11").lignes.find(l => l.includes("CPB RENNES")), /Commencé/);
  const avant = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T14:59:00Z" }); // 15 h 59
  assert.doesNotMatch(jours(avant).find(x => x.titre === "samedi 21/11").lignes.find(l => l.includes("CPB RENNES")), /Commencé/);
});

test("semaine : matchs « attente » (pas encore publié) et score illisible", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  const j = jours(p);
  assert.match(j.find(x => x.titre === "vendredi 20/11").lignes[0], /20 h 00PNFDomicileADV ATTENTERésultat pas encore publié sur FFvolley/);
  assert.match(j.find(x => x.titre === "mardi 17/11").lignes[0], /Sans heurePNFExtérieurADV ILLISIBLERésultat à lire sur FFvolley/);
});

test("semaine : carte non lue, ses lignes sont marquées « non lu depuis le … »", async () => {
  const d = donneesSemaine();
  Object.assign(d.equipes[1], { nonlu: true, raison: "x", lu: "2026-11-15T21:16:37+01:00" });
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const lignes = jours(p).flatMap(j => j.lignes);
  const pnf = lignes.filter(l => l.includes("PNF"));
  assert.equal(pnf.length, 3);
  assert.ok(pnf.every(l => /non lu depuis le 15 nov\./.test(l)));
  assert.ok(lignes.filter(l => !l.includes("PNF")).every(l => !/non lu/.test(l)));
  d.equipes[1].lu = undefined;
  assert.match(jours(await charger({ donnees: d, aujourdhui: SAMEDI_MIDI })).flatMap(j => j.lignes).find(l => l.includes("PNF")), /non lu$/);
});

test("semaine : « avenir » absent (ancien data.json) : repli sur « prochain » seul ; « avenir » présent, même vide, prime", async () => {
  const d = donneesSemaine();
  for (const e of [...d.equipes, ...d.coupes]) { delete e.avenir; delete e.attente; }
  d.equipes[0].prochain = { date: "2026-11-22", lieu: "D", adv: "SEUL PROCHAIN", heure: "14:00", salle: null };
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const lignes = jours(p).flatMap(j => j.lignes);
  assert.ok(lignes.some(l => l.includes("SEUL PROCHAIN")));
  assert.ok(!lignes.some(l => l.includes("ADV DIMANCHE") || l.includes("ADV ATTENTE")));
  assert.ok(lignes.some(l => l.includes("PLANCOET")));
  const e = donneesSemaine(); e.equipes[0].avenir = [];
  const q = await charger({ donnees: e, aujourdhui: SAMEDI_MIDI });
  assert.ok(!jours(q).flatMap(j => j.lignes).some(l => l.includes("CPB RENNES")), "« avenir » vide : « prochain » ignoré");
});

test("semaine : copie intégrée SECOURS (sans « avenir »), hors ligne, repli sur « prochain »", async () => {
  const p = await charger({ reseau: false, aujourdhui: "2026-11-16T10:00:00Z" });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  const t = p.cartes()[0].textContent;
  assert.match(t, /samedi 21\/11/);
  assert.match(t, /N3M.*CPB RENNES|C\.P\.B\. RENNES 35/);
  assert.doesNotMatch(t, /LOUVIGNE DE BAIS/); // 28/11 : semaine suivante
});

test("semaine vide : message dédié, titre conservé", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-12-30T11:00:00Z" });
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.match(p.cartes()[0].textContent, /Aucun match du club cette semaine\./);
  assert.equal(jours(p).length, 0);
});

test("semaine : « Actualiser » garde la vue et recharge les données", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  assert.equal(titresJours(p).length, 5);
  const d = donneesSemaine(); d.equipes[0].avenir = []; d.equipes[0].resultats = [];
  p.etat.donnees = d;
  await p.clic("btn");
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  assert.equal(p.el("vue").value, "semaine");
  assert.equal(p.location.hash, "#semaine");
  assert.ok(!jours(p).flatMap(j => j.lignes).some(l => l.includes("N3M")));
  await p.choisir("pnf");
  await p.clic("btn");
  assert.deepEqual(p.titres(), ["PNF"]); // une autre vue est aussi conservée
});

test("semaine : une carte ou une ligne illisible n'abîme que sa propre ligne", async () => {
  const d = donneesSemaine();
  d.equipes[2].avenir = "oups";                       // pas un tableau : ignoré
  d.equipes[3] = { nom: null };                        // filtré dès le chargement
  d.equipes[1].resultats = [{ date: "2026-11-19", lieu: "D", adv: "SCORE CASSE", pour: "3", contre: null }];
  d.coupes[0].avenir = [null, { date: "2026-11-21", lieu: "E", adv: "ROMILLE", heure: "10:00" }];
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const t = p.cartes()[0].textContent;
  assert.match(t, /Ligne illisible\./);
  assert.match(t, /CPB RENNES/);
  assert.match(t, /ROMILLE/);
  assert.equal(p.options().length, d.equipes.length - 1 + 3);
});

test("semaine : le libellé d'une coupe est « équipe · nom de la coupe » ; heure de mise à jour et encart visibles", async () => {
  const d = donneesSemaine();
  d.nonsuivies = [{ code: "ZZZ", libelle: "Coupe nouvelle", source: "page hebdo" }];
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  assert.match(p.cartes()[0].textContent, /PRM · Coupe CD35 masculine/);
  assert.notEqual(p.el("maj").textContent, "–");
  assert.equal(p.el("encart").hidden, false);
  assert.equal(p.el("lien-coupe").hidden, true);
});

test("semaine : textContent uniquement, aucune bibliothèque, aucun orange hors accents", () => {
  assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(HTML, /<script[^>]+src=/);
  for (const sel of [".hre", ".mt", ".mts", ".mt-txt", ".mt-carte", ".hre.sans", "h3 .pastille"]) {
    const r = reglesCss().regles.find(x => x.sel === sel);
    assert.ok(r, "règle absente : " + sel);
    assert.doesNotMatch(r.corps, /#F26910/i, sel);
  }
});

test("semaine : à heure égale, l'ordre des cartes décide", async () => {
  const d = donneesSemaine();
  d.equipes[1].avenir = [{ date: "2026-11-21", lieu: "E", adv: "PLANCOET", heure: "16:00", salle: null }];
  d.equipes[1].attente = [];
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const samedi = jours(p).find(x => x.titre === "samedi 21/11").lignes;
  assert.match(samedi[1], /16 h 00N3M/); // N3M avant PNF dans la liste des cartes
  assert.match(samedi[2], /16 h 00PNF/);
});

// ---- Lot 3 : bloc « Semaine dernière » ----
// Bloc de la carte « Cette semaine » : [{ titre, lignes: [texte, ...] }] ; null si le bloc est absent.
function blocPrecedent(p) {
  const s = p.cartes()[0].children.find(c => c.tag === "section");
  if (!s) return null;
  const out = []; let cur = null;
  for (const n of s.children) {
    if (n.tag === "h3") { cur = { titre: n.textContent.replace("Aujourd'hui", ""), aujourdhui: n.textContent.includes("Aujourd'hui"), lignes: [] }; out.push(cur); }
    else if (n.tag === "ul" && cur) for (const li of n.children) cur.lignes.push(li.textContent);
  }
  return { jours: out, texte: s.textContent, titre: s.trouver(e => e.tag === "h2")[0].textContent };
}

// Semaine dernière de référence (aujourd'hui = samedi 21/11) : lundi 9/11 au dimanche 15/11.
function donneesPrecedente() {
  const d = donneesSemaine();
  const n3m = d.equipes[0], pnf = d.equipes[1], m13 = d.equipes[2];
  n3m.resultats.push(
    { date: "2026-11-13", heure: "20:00", lieu: "D", adv: "ADV VENDREDI SOIR", pour: 3, contre: 1, sets: "25-20 20-25 25-18 25-21" },
    { date: "2026-11-15", heure: "15:00", lieu: "E", adv: "ADV DIMANCHE PERDU", pour: 0, contre: 3, sets: "20-25 18-25 19-25" },
    { date: "2026-11-09", lieu: "D", adv: "ADV LUNDI 9", pour: 3, contre: 0, sets: "25-10 25-10 25-10" });
  pnf.resultats.push({ date: "2026-11-14", heure: "18:00", lieu: "E", adv: "ADV PNF SAMEDI", pour: 3, contre: 2, sets: "25-20 20-25 25-20 20-25 15-13" });
  pnf.attente.push({ date: "2026-11-13", lieu: "D", adv: "ADV SANS SCORE", heure: "18:00", salle: "COSEC" },
                   { date: "2026-11-15", lieu: "E", adv: "ADV FORFAIT", heure: null, salle: null, illisible: true });
  m13.resultats.push({ date: "2026-11-16", lieu: "D", adv: "ADV CETTE SEMAINE", pour: 3, contre: 0, sets: "25-10 25-10 25-10" }); // lundi 16 : programme
  d.coupes[0].resultats.push({ date: "2026-11-14", heure: "10:00", lieu: "E", adv: "ADV COUPE", pour: 3, contre: 0, sets: "25-13 25-11 25-11" });
  return d;
}

test("semaine dernière : bloc permanent sous le programme, titre et dates (lundi au dimanche précédents)", async () => {
  const p = await charger({ donnees: donneesPrecedente(), aujourdhui: SAMEDI_MIDI });
  const b = blocPrecedent(p);
  assert.ok(b);
  assert.equal(b.titre, "Semaine dernière");
  assert.match(b.texte, /Du 09\/11 au 15\/11/);
  assert.equal(p.cartes().length, 1);                                    // même carte que le programme
  assert.deepEqual(p.titres(), ["Cette semaine"]);
  const enfants = p.cartes()[0].children;
  assert.ok(enfants.indexOf(enfants.find(c => c.tag === "section")) > enfants.findLastIndex(c => c.tag === "ul")); // sous le programme
  assert.deepEqual(titresJours(p), ["lundi 16/11", "mardi 17/11", "mercredi 18/11", "vendredi 20/11", "samedi 21/11", "dimanche 22/11"]); // programme : 16/11 compris, rien de la semaine dernière
  assert.ok(blocPrecedent(await charger({ donnees: donneesSemaine(), aujourdhui: "2026-12-30T11:00:00Z" })), "présent même vide");
});

test("semaine dernière : résultats (V ou D, score en sets) et matchs sans score, mêmes libellés que le programme, regroupés par jour", async () => {
  const b = blocPrecedent(await charger({ donnees: donneesPrecedente(), aujourdhui: SAMEDI_MIDI }));
  assert.deepEqual(b.jours.map(j => j.titre), ["lundi 09/11", "vendredi 13/11", "samedi 14/11", "dimanche 15/11"]);
  assert.ok(b.jours.every(j => !j.aujourdhui));
  assert.match(b.jours[0].lignes[0], /^VN3MDomicileADV LUNDI 93–0 · 25-10 25-10 25-10$/);
  const ven = b.jours[1].lignes;
  assert.equal(ven.length, 2);
  assert.ok(ven.some(l => /^VN3MDomicileADV VENDREDI SOIR3–1 · 25-20 20-25 25-18 25-21$/.test(l)));
  assert.ok(ven.some(l => /^18 h 00PNFDomicileADV SANS SCORECOSECRésultat pas encore publié sur FFvolley$/.test(l)));
  const dim = b.jours[3].lignes;
  assert.ok(dim.some(l => /^DN3MExtérieurADV DIMANCHE PERDU0–3 · 20-25 18-25 19-25$/.test(l)));
  assert.ok(dim.some(l => /^Sans heurePNFExtérieurADV FORFAITRésultat à lire sur FFvolley$/.test(l)));
  assert.doesNotMatch(b.texte, /HORS SEMAINE|ADV CETTE SEMAINE|ADV MERCREDI|CPB RENNES/); // 8/11, 16/11 et la semaine en cours : absents
});

test("semaine dernière : tri par heure (résultats compris) puis ordre des cartes, coupes incluses, étiquette de coupe", async () => {
  const d = donneesPrecedente();
  const b = blocPrecedent(await charger({ donnees: d, aujourdhui: SAMEDI_MIDI }));
  const ven = b.jours[1].lignes;
  assert.match(ven[0], /PNF.*ADV SANS SCORE/);                          // 18 h avant 20 h
  assert.match(ven[1], /ADV VENDREDI SOIR/);
  const sam = b.jours[2].lignes;
  assert.match(sam[0], /PRM · Coupe CD35 masculine.*ADV COUPE/);       // 10 h, coupe
  assert.match(sam[1], /^VPNFExtérieurADV PNF SAMEDI/);                 // 18 h
  // même heure : l'ordre des cartes décide ; résultat sans heure après les heures connues
  d.equipes[1].resultats[0].date = "2026-11-14"; d.equipes[0].resultats.push({ date: "2026-11-14", heure: "18:00", lieu: "D", adv: "ADV N3M 18H", pour: 3, contre: 0, sets: "25-1 25-1 25-1" });
  d.equipes[2].resultats.push({ date: "2026-11-14", lieu: "D", adv: "ADV M13 SANS HEURE", pour: 2, contre: 0, sets: "25-1 25-1" });
  const s2 = blocPrecedent(await charger({ donnees: d, aujourdhui: SAMEDI_MIDI })).jours[2].lignes;
  assert.match(s2[1], /N3M.*ADV N3M 18H/);
  assert.match(s2[2], /PNF.*ADV PNF SAMEDI/);
  assert.match(s2[3], /M13F.*ADV M13 SANS HEURE/);
});

test("semaine dernière : bloc vide, message dédié (le programme garde le sien)", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-12-30T11:00:00Z" });
  const b = blocPrecedent(p);
  assert.match(b.texte, /Aucun match du club la semaine dernière\./);
  assert.equal(b.jours.length, 0);
  assert.match(p.cartes()[0].textContent, /Aucun match du club cette semaine\./);
  // ancien data.json sans « heure » dans les résultats ni « attente » : pas de plantage
  const d = donneesSemaine(); for (const e of [...d.equipes, ...d.coupes]) delete e.attente;
  d.equipes[0].resultats.push({ date: "2026-11-13", lieu: "D", adv: "SANS HEURE", pour: 3, contre: 0, sets: "25-1 25-1 25-1" });
  assert.match(blocPrecedent(await charger({ donnees: d, aujourdhui: SAMEDI_MIDI })).texte, /SANS HEURE/);
});

test("semaine dernière : bornes lundi 0 h / dimanche 24 h en heure de Paris, téléphone réglé sur un autre fuseau", async () => {
  for (const tz of ["Pacific/Auckland", "America/Los_Angeles"]) {
    await avecFuseau(tz, async () => {
      const d = donneesPrecedente();
      d.equipes[1].resultats.push({ date: "2026-11-22", heure: "09:00", lieu: "D", adv: "ADV DIMANCHE 22", pour: 3, contre: 0, sets: "25-1 25-1 25-1" });
      // dimanche 15/11 23 h 30 Paris : semaine du 9 au 15, dernière semaine du 2 au 8
      const dim = blocPrecedent(await charger({ donnees: d, aujourdhui: "2026-11-15T22:30:00Z" }));
      assert.match(dim.texte, /Du 02\/11 au 08\/11/, tz);
      assert.match(dim.texte, /HORS SEMAINE/, tz);                       // 8/11 : dimanche de la semaine d'avant
      assert.doesNotMatch(dim.texte, /ADV LUNDI 9/, tz);
      // lundi 16/11 0 h 30 Paris : la semaine du 9 au 15 devient « dernière »
      const lun = blocPrecedent(await charger({ donnees: d, aujourdhui: "2026-11-15T23:30:00Z" }));
      assert.match(lun.texte, /Du 09\/11 au 15\/11/, tz);
      assert.deepEqual(lun.jours.map(j => j.titre), ["lundi 09/11", "vendredi 13/11", "samedi 14/11", "dimanche 15/11"], tz);
      assert.doesNotMatch(lun.texte, /HORS SEMAINE|ADV CETTE SEMAINE/, tz);
      // lundi 23/11 0 h 30 Paris : 16 au 22 (le dimanche 22 à 9 h est inclus, le lundi 9/11 non)
      const suiv = blocPrecedent(await charger({ donnees: d, aujourdhui: "2026-11-22T23:30:00Z" }));
      assert.match(suiv.texte, /Du 16\/11 au 22\/11/, tz);
      assert.match(suiv.texte, /ADV DIMANCHE 22/, tz);
      assert.match(suiv.texte, /ADV CETTE SEMAINE/, tz);
      assert.doesNotMatch(suiv.texte, /ADV LUNDI 9|ADV VENDREDI SOIR/, tz);
    });
  }
});

test("semaine dernière : match sans score d'avant-hier ou resté dans « avenir » (relevé en retard) : même libellé que le programme", async () => {
  const d = donneesSemaine();
  d.equipes[2].avenir = [{ date: "2026-11-14", lieu: "E", adv: "RELEVE EN RETARD", heure: "14:00", salle: null }]; // jamais passé en résultat
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const l = blocPrecedent(p).jours[0].lignes[0];
  assert.match(l, /14 h 00M13FExtérieurRELEVE EN RETARDCommencé, résultat au prochain relevé/);
  assert.doesNotMatch(l, /^[VD]/);
});

test("semaine dernière : carte non lue marquée, ligne ou score illisible n'abîment que leur ligne ; coupe non lue", async () => {
  const d = donneesPrecedente();
  Object.assign(d.equipes[1], { nonlu: true, raison: "x", lu: "2026-11-15T21:16:37+01:00" });
  d.equipes[0].resultats.push({ date: "2026-11-12", lieu: "D", adv: "SCORE CASSE", pour: "3", contre: null });
  d.equipes[2].resultats = [null, ...d.equipes[2].resultats];
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  const b = blocPrecedent(p);
  assert.match(b.texte, /Ligne illisible\./);
  assert.match(b.texte, /ADV VENDREDI SOIR/);
  assert.ok(b.jours.flatMap(j => j.lignes).filter(l => l.includes("PNF")).every(l => /non lu depuis le 15 nov\./.test(l)));
  assert.match(programme(p), /CPB RENNES/);                              // le programme est intact
});

test("semaine dernière : une erreur dans le bloc n'abîme pas le programme", async () => {
  const p = await charger({ donnees: donneesPrecedente(), aujourdhui: SAMEDI_MIDI });
  const vrai = p.sandbox.itemsSemaine; let appels = 0;
  p.sandbox.itemsSemaine = (...a) => { if (++appels === 2) throw new Error("panne"); return vrai(...a); };
  await p.clic("btn");
  assert.equal(appels, 2);
  assert.match(blocPrecedent(p).texte, /Données de la semaine dernière illisibles\./);
  assert.match(programme(p), /CPB RENNES/);
});

test("semaine dernière : copie intégrée SECOURS (résultats des coupes des 14 et 15/11, sans « heure »)", async () => {
  const p = await charger({ reseau: false, aujourdhui: "2026-11-16T10:00:00Z" });
  const b = blocPrecedent(p);
  assert.match(b.texte, /Du 09\/11 au 15\/11/);
  assert.deepEqual(b.jours.map(j => j.titre), ["lundi 09/11", "samedi 14/11", "dimanche 15/11"]);
  assert.match(b.jours[0].lignes[0], /^VLoisir Compet'Lib 1Extérieur/);
  assert.equal(b.jours[1].lignes.length, 2);                             // Coupe de France + Coupe CD35
  assert.match(b.jours[2].lignes.join(" "), /M18M région · Coupe de Bretagne M18M/);
  assert.doesNotMatch(b.texte, /CESSON VOLLEY SAINT-BRIEUC COTES D'ARMOR 2/); // 8/11 : avant la semaine dernière
});

test("semaine dernière : textContent uniquement, mise en forme sans orange hors titre", () => {
  const r = reglesCss().regles.find(x => x.sel === ".prec");
  assert.ok(r, "règle .prec absente");
  assert.doesNotMatch(r.corps, /#F26910/i);
  assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML|outerHTML/);
});
