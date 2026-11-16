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

test("par défaut : N3M seule, adresse #n3m", async () => {
  const p = await charger();
  assert.deepEqual(p.titres(), ["N3M"]);
  assert.equal(p.el("vue").value, "n3m");
  assert.equal(p.location.hash, "#n3m");
});

test("menu : équipes dans l'ordre des cartes, puis Coupes, puis Toutes les équipes", async () => {
  const p = await charger();
  const o = p.options();
  assert.deepEqual(o.slice(0, 5).map(x => x.t), ["N3M", "PNF", "PRM", "D1F", "D2M"]);
  assert.deepEqual(o.slice(-2).map(x => x.t), ["Coupes", "Toutes les équipes"]);
  assert.equal(o.length, DATA.equipes.length + 2);
  assert.deepEqual(o.slice(0, DATA.equipes.length).map(x => x.t), DATA.equipes.map(e => e.nom));
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

test("adresse inconnue : retour au choix mémorisé, puis à N3M", async () => {
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "pnf" })).titres(), ["PNF"]);
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "nimporte" })).titres(), ["N3M"]);
});

test("adresse avec accents encodés (#m18m-r%C3%A9gion n'existe pas, #m18m-region oui)", async () => {
  assert.deepEqual((await charger({ hash: "#m18m-region" })).titres(), ["M18M région"]);
  assert.deepEqual((await charger({ hash: "#%ZZ" })).titres(), ["N3M"]); // adresse mal formée : pas de plantage
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
  const loin = await charger();
  assert.equal(loin.el("lien-coupe").hidden, true);
  const p = await charger({ aujourdhui: "2026-12-08T12:00:00Z" });
  assert.equal(p.el("lien-coupe").hidden, false);
  assert.match(HTML, /Match de coupe cette semaine/);
  await p.choisir("toutes");
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("coupes");
  assert.equal(p.el("lien-coupe").hidden, true);
  await p.choisir("pnf");
  assert.equal(p.el("lien-coupe").hidden, false);
});

test("un match de coupe passé ou à plus de 7 jours ne déclenche pas la ligne", async () => {
  assert.equal((await charger({ aujourdhui: "2026-12-04T12:00:00Z" })).el("lien-coupe").hidden, true); // 8 jours
  assert.equal((await charger({ aujourdhui: "2026-12-05T12:00:00Z" })).el("lien-coupe").hidden, false); // 7 jours
  assert.equal((await charger({ aujourdhui: "2026-12-13T12:00:00Z" })).el("lien-coupe").hidden, true); // passé
});

test("la ligne de coupe ouvre la carte Coupes", async () => {
  const p = await charger({ aujourdhui: "2026-12-08T12:00:00Z" });
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
  for (const v of ["n3m", "coupes", "toutes"]) {
    await p.choisir(v);
    assert.notEqual(p.el("maj").textContent, "–", v);
    assert.equal(p.el("encart").hidden, false, v);
    assert.match(p.el("encart").textContent, /Compétition non suivie : ZZZ, Coupe nouvelle/);
  }
});

test("localStorage bloqué : la page fonctionne quand même", async () => {
  const p = await charger({ stockageCasse: true });
  assert.deepEqual(p.titres(), ["N3M"]);
  await p.choisir("pnf");
  assert.deepEqual(p.titres(), ["PNF"]);
});

test("hors ligne : données intégrées affichées avec le même menu", async () => {
  const p = await charger({ reseau: false });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["N3M"]);
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

test("équipe mémorisée absente des nouvelles données : retour à N3M", async () => {
  const p = await charger({ memo: "equipe-disparue" });
  assert.deepEqual(p.titres(), ["N3M"]);
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
  assert.equal(p.options().length, DATA.equipes.length + 2);
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
  assert.deepEqual(p.titres(), ["N3M"]);
  assert.equal(p.el("btn").disabled, false);
});

test("requête pendante au premier chargement : abandon, données intégrées, bouton réactivé", async () => {
  const p = await charger({ reseau: "pendante" });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["N3M"]);
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
