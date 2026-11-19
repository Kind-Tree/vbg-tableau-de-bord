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
  focus() { El.actif = this; }
  setAttribute(k, v) { (this.attrs = this.attrs || {})[k] = String(v); }
  getAttribute(k) { return this.attrs && k in this.attrs ? this.attrs[k] : null; }
  trouver(pred, out = []) { for (const c of this.children) { if (c.tag) { if (pred(c)) out.push(c); c.trouver(pred, out); } } return out; }
}

El.actif = null; // élément qui a reçu le focus (focus() du DOM simulé)

const tick = () => new Promise(r => setImmediate(r));

// Charge la page dans un contexte isolé.
async function charger({ hash = "", memo = null, aujourdhui = "2026-11-15T12:00:00Z", donnees = DATA, reseau = true, stockageCasse = false } = {}) {
  const elements = {};
  const winEcouteurs = {};
  const stock = {};
  if (memo) stock["vbg-vue"] = memo;
  const docEcouteurs = {};
  let FIXE = new Date(aujourdhui).getTime(); // modifiable : p.horloge() fait avancer l'heure de la page
  El.actif = null;
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
      visibilityState: "visible",
      addEventListener(t, f) { (docEcouteurs[t] = docEcouteurs[t] || []).push(f); },
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
    horloge: iso => { FIXE = new Date(iso).getTime(); },
    actif: () => El.actif,
    // retour sur la page : onglet de nouveau visible, ou page restaurée (pageshow)
    revenir: async (via = "visibilitychange") => {
      sandbox.document.visibilityState = "visible";
      (via === "pageshow" ? winEcouteurs.pageshow : docEcouteurs.visibilitychange || []).forEach(f => f());
      await tick();
    },
    cacher: async () => { sandbox.document.visibilityState = "hidden"; (docEcouteurs.visibilitychange || []).forEach(f => f()); await tick(); },
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
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(p.el("vue").value, "programme");
  assert.equal(p.location.hash, "#programme");
});

test("menu : « Programme » en tête, puis équipes dans l'ordre des cartes, Coupes, Toutes les équipes", async () => {
  const p = await charger();
  const o = p.options();
  assert.deepEqual(o[0], { v: "programme", t: "Programme" });
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

test("adresse inconnue : retour au choix mémorisé, puis au Programme", async () => {
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "pnf" })).titres(), ["PNF"]);
  assert.deepEqual((await charger({ hash: "#nimporte", memo: "nimporte" })).titres(), ["Programme"]);
});

test("adresse : accents encodés, majuscules et mal formée ouvrent la bonne équipe ou le Programme", async () => {
  for (const h of ["#m18m-region", "#m18m-r%C3%A9gion", "#M18M-R%C3%89GION", "#m18m-région", "#m18m%20r%C3%A9gion"]) {
    assert.deepEqual((await charger({ hash: h })).titres(), ["M18M région"], h);
  }
  assert.deepEqual((await charger({ hash: "#loisir-compet%27lib-1" })).titres(), ["Loisir Compet'Lib 1"]);
  assert.deepEqual((await charger({ hash: "#%ZZ" })).titres(), ["Programme"]); // adresse mal formée : pas de plantage
  const p = await charger({ hash: "#m18m-r%C3%A9gion" });
  assert.equal(p.location.hash, "#m18m-region"); // l'adresse affichée est réécrite sous sa forme normale
  assert.equal(p.el("vue").value, "m18m-region");
  await p.hashchange("#m13f");
  await p.hashchange("#m18m-r%C3%A9gion");
  assert.deepEqual(p.titres(), ["M18M région"]); // aussi quand l'adresse est modifiée à la main
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
  await p.choisir("programme");
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
  for (const v of ["programme", "n3m", "coupes", "toutes"]) {
    await p.choisir(v);
    assert.notEqual(p.el("maj").textContent, "–", v);
    assert.equal(p.el("encart").hidden, false, v);
    assert.match(p.el("encart").textContent, /Compétition non suivie : ZZZ, Coupe nouvelle/);
  }
});

test("localStorage bloqué : la page fonctionne quand même", async () => {
  const p = await charger({ stockageCasse: true });
  assert.deepEqual(p.titres(), ["Programme"]);
  await p.choisir("pnf");
  assert.deepEqual(p.titres(), ["PNF"]);
});

test("hors ligne : données intégrées affichées avec le même menu", async () => {
  const p = await charger({ reseau: false });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["Programme"]);
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

test("équipe mémorisée absente des nouvelles données : retour au Programme", async () => {
  const p = await charger({ memo: "equipe-disparue" });
  assert.deepEqual(p.titres(), ["Programme"]);
});

test("charte : palette hexadécimale fermée (aucun bleu nommé), pas de dégradé, focus et tap-highlight orange/transparent", () => {
  assert.match(HTML, /-webkit-tap-highlight-color:transparent/);
  assert.match(HTML, /button:focus-visible,select:focus-visible[^{]*\{outline:3px solid #F26910/);
  assert.doesNotMatch(HTML, /gradient/i);
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  // Aucune couleur nommée ni fonctionnelle (bleus compris) : chaque valeur de couleur est un hexadécimal de la palette ci-dessous.
  assert.doesNotMatch(css, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
  const valeurs = [...css.matchAll(/(?:^|[;{\s])(color|background(?:-color)?|border(?:-(?:top|right|bottom|left|color))?|outline(?:-color)?|fill|stroke|box-shadow|text-decoration-color):\s*([^;}]+)/g)].map(m => m[2].trim());
  assert.ok(valeurs.length > 20, "valeurs de couleur lues : " + valeurs.length);
  const motsPermis = new Set(["solid", "none", "transparent", "inherit", "currentcolor"]);
  for (const v of valeurs) {
    for (const mot of v.split(/[\s,]+/)) {
      if (/^#/.test(mot)) assert.match(mot, /^#[0-9A-F]{6}$/, "hexadécimal hors forme #RRGGBB : " + mot);
      else if (/^[a-z-]+$/i.test(mot)) assert.ok(motsPermis.has(mot.toLowerCase()), "couleur nommée ou mot inconnu : " + mot + " dans « " + v + " »");
    }
  }
  const couleurs = [...new Set(css.match(/#[0-9A-Fa-f]{6}\b/g).map(c => c.toUpperCase()))].sort();
  assert.deepEqual(couleurs, ["#111111", "#1A1A1A", "#1E7A3C", "#1F1F1F", "#6B6B6B", "#B3261E", "#D9D9D9", "#F26910", "#FFFFFF"]);
});

test("select et ligne de coupe : select de 48 px, fond #1F1F1F, texte blanc, bordure #D9D9D9 ; ligne de coupe de 48 px au moins", () => {
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
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(p.el("btn").disabled, false);
});

test("requête pendante au premier chargement : abandon, données intégrées, bouton réactivé", async () => {
  const p = await charger({ reseau: "pendante" });
  assert.equal(p.el("src").textContent, "Données intégrées du");
  assert.deepEqual(p.titres(), ["Programme"]);
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
  const permis = new Set(["h2", ".rang b", ".pastille", "button", ".lien-coupe", "option:checked", ".bascule[aria-pressed=\"true\"]", ".lien-poule", ".cl li.moi",
    "button:focus-visible,select:focus-visible,.lien-coupe:focus-visible,.lien-poule:focus-visible"]);
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

test("application : pas de viewport-fit dans le <head> ; le menu (#vue) et le bouton (#btn) existent dans le HTML", () => {
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

// Lit la carte « Programme » : [{ titre, aujourdhui, lignes: [texte, ...] }] dans l'ordre d'affichage.
function jours(p) {
  const out = []; let cur = null;
  const zone = p.cartes()[0].children.find(c => c.className === "jours");
  for (const n of zone.children) {
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
  assert.deepEqual((await charger({ hash: "#programme", memo: "pnf" })).titres(), ["Programme"]);
  assert.deepEqual((await charger({ hash: "#pnf", memo: "programme" })).titres(), ["PNF"]);
  assert.deepEqual((await charger({ memo: "d1f" })).titres(), ["D1F"]); // la mémoire n'est pas écrasée par la vue par défaut
  const p = await charger();
  assert.equal(p.location.hash, "#programme");
  assert.equal(p.options()[0].v, "programme");
  await p.choisir("n3m");
  assert.equal(p.stock["vbg-vue"], "n3m");
  await p.hashchange("#programme");
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(p.stock["vbg-vue"], "programme");
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
  assert.match(samedi[3], /Heure à confirmerM13FExtérieurCHATEAUBOURGLIFFRE/);
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

test("semaine : match passé à Paris sans score « Résultat pas encore publié sur FFvolley » ; sans heure, à venir jusqu'à la fin du jour", async () => {
  const apres = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T16:30:00Z" }); // samedi 17 h 30 Paris
  const s = jours(apres).find(x => x.titre === "samedi 21/11").lignes;
  assert.match(s.find(l => l.includes("CPB RENNES")), /Résultat pas encore publié sur FFvolley/);
  assert.doesNotMatch(s.find(l => l.includes("CPB RENNES")), /^[VD]/); // pas de pastille V ou D
  assert.doesNotMatch(s.find(l => l.includes("PLANCOET")), /Résultat pas encore publié/); // 19 h : pas encore
  assert.doesNotMatch(s.find(l => l.includes("CHATEAUBOURG")), /Résultat pas encore publié/); // sans heure : jusqu'à la fin du jour
  const lendemain = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-22T08:00:00Z" });
  const s2 = jours(lendemain).find(x => x.titre === "samedi 21/11").lignes;
  assert.ok(s2.every(l => /Résultat pas encore publié sur FFvolley/.test(l)), "tous les matchs de samedi sont passés dimanche");
});

test("semaine : à l'heure exacte du match, il compte comme passé (même règle que le collecteur)", async () => {
  const pile = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T15:00:00Z" }); // 16 h 00 Paris
  assert.match(jours(pile).find(x => x.titre === "samedi 21/11").lignes.find(l => l.includes("CPB RENNES")), /Résultat pas encore publié/);
  const avant = await charger({ donnees: donneesSemaine(), aujourdhui: "2026-11-21T14:59:00Z" }); // 15 h 59
  assert.doesNotMatch(jours(avant).find(x => x.titre === "samedi 21/11").lignes.find(l => l.includes("CPB RENNES")), /Résultat pas encore publié/);
});

test("semaine : matchs « attente » (pas encore publié) et score illisible", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  const j = jours(p);
  assert.match(j.find(x => x.titre === "vendredi 20/11").lignes[0], /20 h 00PNFDomicileADV ATTENTERésultat pas encore publié sur FFvolley/);
  assert.match(j.find(x => x.titre === "mardi 17/11").lignes[0], /Heure à confirmerPNFExtérieurADV ILLISIBLERésultat à lire sur FFvolley/);
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
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.match(p.cartes()[0].textContent, /Aucun match du club cette semaine\./);
  assert.equal(jours(p).length, 0);
});

test("semaine : « Actualiser » garde la vue et recharge les données", async () => {
  const p = await charger({ donnees: donneesSemaine(), aujourdhui: SAMEDI_MIDI });
  assert.equal(titresJours(p).length, 5);
  const d = donneesSemaine(); d.equipes[0].avenir = []; d.equipes[0].resultats = [];
  p.etat.donnees = d;
  await p.clic("btn");
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(p.el("vue").value, "programme");
  assert.equal(p.location.hash, "#programme");
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

test("semaine : ni innerHTML ni script externe ; pas d'orange dans les règles .hre, .mt, .mts, .mt-txt, .mt-carte, .hre.sans, h3 .pastille", () => {
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

// ---- Données anciennes (nuit du 16/11/2026) ----
// Écart en jours de calendrier à Paris entre « maj » et aujourd'hui ; ligne affichée au-delà de 5 jours.
const MAJ_LUNDI = "2026-11-16T07:00:00+01:00";
const avecMaj = maj => { const d = JSON.parse(JSON.stringify(DATA)); if (maj === undefined) delete d.maj; else d.maj = maj; return d; };

test("données anciennes : 5 jours, rien ; 6 jours, ligne « il y a 6 jours » sous l'heure de mise à jour", async () => {
  const cinq = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-21T11:00:00Z" });
  assert.equal(cinq.el("ancien").hidden, true);
  assert.equal(cinq.el("ancien").textContent, "");
  const six = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-22T11:00:00Z" });
  assert.equal(six.el("ancien").hidden, false);
  assert.equal(six.el("ancien").textContent, "Données anciennes : dernière collecte il y a 6 jours");
  const dix = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-26T11:00:00Z" });
  assert.equal(dix.el("ancien").textContent, "Données anciennes : dernière collecte il y a 10 jours");
});

test("données anciennes : la ligne est dans le bloc de mise à jour, après l'heure, et visible dans toutes les vues", async () => {
  assert.match(HTML, /<b id="maj">[^<]*<\/b><span class="ancien" id="ancien" hidden><\/span><\/p>/);
  const p = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-30T11:00:00Z" });
  for (const v of ["programme", "n3m", "coupes", "toutes"]) {
    await p.choisir(v);
    assert.equal(p.el("ancien").hidden, false, v);
    assert.match(p.el("ancien").textContent, /il y a 14 jours$/, v);
  }
});

test("données anciennes : jours de calendrier à Paris (23 h 30 le lundi, 0 h 30 le dimanche suivant = 6 jours), téléphone sur un autre fuseau", async () => {
  const maj = "2026-11-16T23:30:00+01:00", maintenant = "2026-11-21T23:30:00Z"; // dimanche 22/11, 0 h 30 à Paris
  for (const tz of ["Pacific/Auckland", "America/Los_Angeles"]) {
    await avecFuseau(tz, async () => {
      const p = await charger({ donnees: avecMaj(maj), aujourdhui: maintenant });
      assert.equal(p.el("ancien").textContent, "Données anciennes : dernière collecte il y a 6 jours", tz);
    });
  }
  const veille = await charger({ donnees: avecMaj(maj), aujourdhui: "2026-11-21T22:30:00Z" }); // samedi 21/11, 23 h 30 : 5 jours
  assert.equal(veille.el("ancien").hidden, true);
  // collecte du mardi 17/11 à 0 h 30 à Paris (= lundi 16/11 à 23 h 30 en UTC) : le jour de Paris compte, pas celui d'UTC
  const minuit = await charger({ donnees: avecMaj("2026-11-17T00:30:00+01:00"), aujourdhui: "2026-11-23T11:00:00Z" });
  assert.equal(minuit.el("ancien").textContent, "Données anciennes : dernière collecte il y a 6 jours");
});

test("données anciennes : jamais deviné quand « maj » est absent, nul, illisible, du futur ou d'un autre type", async () => {
  for (const maj of [undefined, null, "n'importe quoi", "", 0, 12345, "2099-01-01T00:00:00+01:00"]) {
    const p = await charger({ donnees: avecMaj(maj), aujourdhui: "2026-12-30T11:00:00Z" });
    assert.equal(p.el("ancien").hidden, true, String(maj));
    assert.equal(p.el("ancien").textContent, "", String(maj));
  }
});

test("données anciennes : des données fraîches effacent la ligne (Actualiser)", async () => {
  const p = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-25T11:00:00Z" });
  assert.equal(p.el("ancien").hidden, false);
  p.etat.donnees = avecMaj("2026-11-25T07:00:00+01:00");
  await p.clic("btn");
  assert.equal(p.el("ancien").hidden, true);
  assert.equal(p.el("ancien").textContent, "");
});

test("données anciennes : hors ligne, la ligne suit les données affichées (copie intégrée, ou données déjà chargées)", async () => {
  // dix jours après la date de la copie intégrée, quelle que soit sa date de régénération
  const jourCopie = SCRIPT.match(/const SECOURS=\{"maj":"(\d{4}-\d\d-\d\d)/)[1];
  const dixJoursApres = new Date(new Date(jourCopie + "T11:00:00Z").getTime() + 10 * 864e5).toISOString();
  const integree = await charger({ reseau: false, aujourdhui: dixJoursApres });
  assert.equal(integree.el("src").textContent, "Données intégrées du");
  assert.equal(integree.el("ancien").textContent, "Données anciennes : dernière collecte il y a 10 jours");
  const p = await charger({ donnees: avecMaj("2026-11-25T07:00:00+01:00"), aujourdhui: "2026-11-25T11:00:00Z" });
  p.etat.reseau = false;
  await p.clic("btn");
  assert.equal(p.el("src").textContent, "Actualisation impossible, données du");
  assert.equal(p.el("ancien").hidden, true); // les données gardées sont celles de 07 h : rien d'ancien
});

test("données anciennes : blanc gras, jamais orange, masquage réel (hidden)", () => {
  const { regles, css } = reglesCss();
  const r = regles.find(x => x.sel === ".ancien");
  assert.ok(r, "règle .ancien absente");
  assert.match(r.corps, /color:#FFFFFF/);
  assert.match(r.corps, /font-weight:bold/);
  assert.doesNotMatch(r.corps, /#F26910|#C2500A|orange/i);
  assert.ok(css.includes(".ancien[hidden]{display:none}"));
  assert.match(SCRIPT, /textContent/);
  assert.doesNotMatch(SCRIPT.slice(SCRIPT.indexOf("function signalerAncien"), SCRIPT.indexOf("let donnees=null")), /innerHTML/);
});

test("données anciennes : Actualiser hors ligne recalcule l'âge (la page est restée ouverte, le jour a changé)", async () => {
  // données de 5 jours au chargement ; la page reste ouverte et l'horloge avance d'un jour
  const p = await charger({ donnees: avecMaj(MAJ_LUNDI), aujourdhui: "2026-11-21T11:00:00Z" });
  assert.equal(p.el("ancien").hidden, true);
  p.horloge("2026-11-22T11:00:00Z");
  p.etat.reseau = false;
  await p.clic("btn");
  assert.equal(p.el("src").textContent, "Actualisation impossible, données du");
  assert.equal(p.el("ancien").hidden, false);
  assert.equal(p.el("ancien").textContent, "Données anciennes : dernière collecte il y a 6 jours");
});

test("données anciennes : seul le format ISO du collecteur est accepté, jamais une date devinée par le navigateur", async () => {
  for (const maj of ["Nov 1", "1", "2026", "2026-11-16", "2026-11-16T07:00:00"]) {
    const p = await charger({ donnees: avecMaj(maj), aujourdhui: "2026-11-22T11:00:00Z" });
    assert.equal(p.el("ancien").hidden, true, maj);
  }
  for (const maj of ["2026-11-16T07:00:00+01:00", "2026-11-16T06:00:00Z", "2026-11-16T07:00:00.123+01:00", "2026-11-16T07:00+01:00"]) {
    const p = await charger({ donnees: avecMaj(maj), aujourdhui: "2026-11-22T11:00:00Z" });
    assert.equal(p.el("ancien").textContent, "Données anciennes : dernière collecte il y a 6 jours", maj);
  }
});

// ---- Défauts mineurs (nuit du 16/11/2026) : focus, changement de date de Paris ----
test("focus : après « Match de coupe cette semaine », le focus clavier passe au menu au lieu d'être perdu", async () => {
  const p = await charger({ hash: "#n3m", aujourdhui: "2026-12-08T12:00:00Z" });
  assert.equal(p.el("lien-coupe").hidden, false);
  assert.equal(p.actif(), null);
  await p.clic("lien-coupe");
  assert.deepEqual(p.titres(), ["Coupes"]);
  assert.equal(p.el("lien-coupe").hidden, true);
  assert.equal(p.actif(), p.el("vue")); // le menu porte l'anneau de focus orange (règle select:focus-visible)
  assert.equal(p.el("vue").value, "coupes");
});

test("focus : un simple changement de vue ne déplace pas le focus", async () => {
  const p = await charger();
  await p.choisir("pnf");
  assert.equal(p.actif(), null);
});

test("changement de date à Paris : au retour sur la page, tout est recalculé (jour courant, ligne « Données anciennes »)", async () => {
  const d = donneesSemaine(); d.maj = MAJ_LUNDI;
  const p = await charger({ donnees: d, aujourdhui: "2026-11-21T22:30:00Z" }); // samedi 21/11, 23 h 30 à Paris
  assert.deepEqual(jours(p).filter(j => j.aujourdhui).map(j => j.titre), ["samedi 21/11"]);
  assert.equal(p.el("ancien").hidden, true); // 5 jours
  const carteAvant = p.cartes()[0];
  p.horloge("2026-11-21T23:30:00Z"); // dimanche 22/11, 0 h 30 à Paris : la page est restée ouverte
  assert.deepEqual(jours(p).filter(j => j.aujourdhui).map(j => j.titre), ["samedi 21/11"]); // sans retour sur la page, rien ne bouge
  await p.revenir();
  assert.notEqual(p.cartes()[0], carteAvant);
  assert.deepEqual(jours(p).filter(j => j.aujourdhui).map(j => j.titre), ["dimanche 22/11"]);
  assert.equal(p.el("ancien").hidden, false);
  assert.match(p.el("ancien").textContent, /il y a 6 jours$/);
  assert.equal(p.el("vue").value, "programme"); // la vue choisie est conservée
});

test("changement de date à Paris : la vue d'une équipe et l'adresse sont conservées au nouveau rendu", async () => {
  const p = await charger({ hash: "#pnf", aujourdhui: "2026-11-21T22:30:00Z" });
  const avant = p.cartes()[0];
  p.horloge("2026-11-21T23:30:00Z");
  await p.revenir("pageshow");
  assert.notEqual(p.cartes()[0], avant);
  assert.deepEqual(p.titres(), ["PNF"]);
  assert.equal(p.location.hash, "#pnf");
});

test("changement de date à Paris : pas de nouveau rendu le même jour, ni onglet masqué, ni avant le premier affichage", async () => {
  const p = await charger({ aujourdhui: "2026-11-21T22:30:00Z" });
  const avant = p.cartes()[0];
  p.horloge("2026-11-21T22:50:00Z"); // toujours le samedi 21/11 à Paris
  await p.revenir();
  assert.equal(p.cartes()[0], avant);
  p.horloge("2026-11-21T23:30:00Z"); // dimanche à Paris, mais onglet masqué : on attend le retour
  await p.cacher();
  assert.equal(p.cartes()[0], avant);
  await p.revenir();
  assert.notEqual(p.cartes()[0], avant);
  const vide = await charger({ reseau: "pendante" }); // aucun relevé encore : pas de plantage au retour
  await vide.revenir();
  await vide.revenir("pageshow");
});

test("changement de date à Paris : même fuseau de Paris, quel que soit celui du téléphone", async () => {
  await avecFuseau("Pacific/Auckland", async () => {
    const p = await charger({ aujourdhui: "2026-11-21T22:30:00Z" }); // Auckland : déjà dimanche 11 h 30, Paris : samedi 23 h 30
    const avant = p.cartes()[0];
    p.horloge("2026-11-21T22:59:00Z");
    await p.revenir();
    assert.equal(p.cartes()[0], avant); // minuit n'est pas passé à Paris
    p.horloge("2026-11-21T23:00:00Z");
    await p.revenir();
    assert.notEqual(p.cartes()[0], avant); // minuit passé à Paris
  });
});

test("Actualiser hors ligne après minuit à Paris : le jour courant est recalculé en même temps que l'âge des données", async () => {
  const d = donneesSemaine(); d.maj = MAJ_LUNDI;
  const p = await charger({ donnees: d, aujourdhui: "2026-11-21T22:30:00Z" }); // samedi 21/11, 23 h 30 à Paris
  p.horloge("2026-11-21T23:30:00Z"); // dimanche 22/11, 0 h 30
  p.etat.reseau = false;
  await p.clic("btn");
  assert.equal(p.el("src").textContent, "Actualisation impossible, données du");
  assert.deepEqual(jours(p).filter(j => j.aujourdhui).map(j => j.titre), ["dimanche 22/11"]);
  assert.match(p.el("ancien").textContent, /il y a 6 jours$/);
});

test("adresse modifiée à la main : l'adresse affichée est toujours celle de la vue ouverte", async () => {
  const p = await charger({ hash: "#m18m-region" });
  await p.hashchange("#M18M-R%C3%89GION"); // même vue, autre écriture
  assert.equal(p.location.hash, "#m18m-region");
  assert.deepEqual(p.titres(), ["M18M région"]);
  await p.hashchange("#inconnue"); // adresse inconnue : la vue reste, l'adresse est corrigée
  assert.equal(p.location.hash, "#m18m-region");
  await p.hashchange("#%ZZ");
  assert.equal(p.location.hash, "#m18m-region");
  assert.deepEqual(p.titres(), ["M18M région"]);
});

// ---- Vue « Programme » (chantier Programme et Poule) : toute la saison, plateaux, exempts, filtre, navigation ----
// Jeudi 19/11/2026 midi à Paris. Semaine affichée : lundi 16/11 au dimanche 22/11.
const JEUDI_19 = "2026-11-19T11:00:00Z";
const LU_19 = "2026-11-19T07:00:00+01:00";

function donneesPoules() {
  const poule = (nous, matchs, titre = "Poule") => ({ titre, nous, active: true, classement: [], matchs });
  return {
    maj: LU_19,
    salles_club: ["SALLE DU COSEC", "COSEC", "ST GREGOIRE COSEC", "la ricoquais"],
    equipes: [
      { nom: "N3M", poule: "Nationale 3", lu: LU_19, prochain: null, resultats: [], poules: [poule("VOLLEY BALL GREGORIEN", [
        { date: "2026-11-08", heure: "15:00", dom: "VOLLEY BALL GREGORIEN", ext: "CESSON", j: 5, sd: 3, se: 0, sets: "25-18 28-26 25-15" },
        { date: "2026-11-22", heure: "16:00", dom: "C.P.B. RENNES 35", ext: "VOLLEY BALL GREGORIEN", j: 6, salle: "GYMNASE CDT BOUGOUIN" },
        { date: "2026-11-22", heure: "16:00", dom: "AUTRE A", ext: "AUTRE B", j: 6 }])]},          // sans nous : jamais affiché
      { nom: "M13M", poule: "M13", lu: LU_19, prochain: null, resultats: [], poules: [poule("VB GREGORIEN (masc)", [
        { date: "2026-11-07", dom: "VB GREGORIEN (masc)", ext: "ANTRAIN US (mixte)", j: 1, sd: 2, se: 1, sets: "25-15 17-25 15-10" },
        { date: "2026-11-07", dom: "VB GREGORIEN (masc)", exempt: true, j: 1 },
        { date: "2026-11-21", heure: "11:00", dom: "VB GREGORIEN (masc)", ext: "VIC COMBOURG (mixte)", salle: "ST GREGOIRE COSEC", j: 2 },
        { date: "2026-11-21", heure: "11:00", dom: "VE GUIPEL LANGAN 3 (mixte)", ext: "VB GREGORIEN (masc)", salle: "ST GREGOIRE COSEC", j: 2 },
        { date: "2026-12-05", dom: "VB GREGORIEN (masc)", ext: "RENNES TA 1 (masc)", salle: "RENNES TA", j: 3 },
        { date: "2026-12-05", dom: "VB GREGORIEN (masc)", ext: "RENNES TA 2 (mixte)", salle: "RENNES TA", j: 3 }])]},
      { nom: "M13F", poule: "M13", lu: LU_19, prochain: null, resultats: [], poules: [poule("VB GREGORIEN", [
        { date: "2026-11-21", dom: "CHATEAUBOURG MARPIRE 35 V 2", ext: "VB GREGORIEN", salle: "LIFFRE", j: 2 },
        { date: "2026-11-21", dom: "VB GREGORIEN", exempt: true, j: 2 }])]},
      { nom: "M18F 2", poule: "M18", lu: LU_19, prochain: null, resultats: [], poules: [poule("ST GREGOIRE 2", [
        { date: "2026-11-21", dom: "ST GREGOIRE 2", ext: "GEVEZE", salle: "SALLE DU COSEC", j: 2 }])]},
      { nom: "D1F", poule: "D1", lu: LU_19, prochain: null, resultats: [], poules: [poule("ST GREGOIRE 2", [
        { date: "2026-11-21", heure: "18:00", dom: "ST GREGOIRE 2", ext: "UGS CCV 3", salle: "SALLE DU COSEC", j: 9 },
        { date: "2026-11-28", dom: "ST GREGOIRE 2", exempt: true, j: 10 }])]},
      { nom: "Loisir Compet'Lib 2", poule: "Loisir", lu: LU_19, prochain: null, resultats: [], poules: [poule("ST GREGOIRE 2", [
        { date: "2026-11-09", dom: "GEVEZE 2", ext: "ST GREGOIRE 2", j: 3, sd: 3, se: 2, sets: "24-26 25-22 25-23 23-25 15-11" },
        { date: "2026-11-23", dom: "ST GREGOIRE 2", ext: "QUEDILLAC", j: 4, sd: 3, se: 1, sets: "25-19 21-25 25-22 25-23" }])]},
    ],
    coupes: [
      { nom: "Coupe CD35 masculine", equipe: "PRM", lu: LU_19, prochain: null, resultats: [], poules: [poule("ST GREGOIRE 2", [
        { date: "2026-11-21", heure: "10:00", dom: "ROMILLE", ext: "ST GREGOIRE 2", salle: "SALLE ANITA CONTI" }])]},
    ],
    nonsuivies: [],
  };
}

const boutons = p => {
  const bs = p.cartes()[0].trouver(e => e.tag === "button");
  return { prec: bs.find(b => b.getAttribute("aria-label") === "Semaine précédente"), suiv: bs.find(b => b.getAttribute("aria-label") === "Semaine suivante"),
           auj: bs.find(b => b.className === "aujourdhui"), dom: bs.find(b => b.className === "bascule") };
};
const cliquer = async b => { b.listeners.click.forEach(f => f()); await tick(); };
const periode = p => p.cartes()[0].trouver(e => e.className === "poule")[0].textContent;
const texteJours = p => jours(p).flatMap(j => j.lignes).join("|");
async function programme19(extra = {}) { return charger({ donnees: donneesPoules(), aujourdhui: JEUDI_19, ...extra }); }

test("programme : semaine du lundi au dimanche, groupée par jour, avec le jour courant ; l'adresse reste #programme", async () => {
  const p = await programme19();
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(periode(p), "Du 16/11 au 22/11");
  assert.deepEqual(titresJours(p), ["samedi 21/11", "dimanche 22/11"]);
  assert.deepEqual(jours(p).map(j => j.aujourdhui), [false, false]);
  assert.equal(jours(p)[1].lignes.length, 1, "dimanche : un seul match du club");
  assert.doesNotMatch(texteJours(p), /AUTRE/, "le match de deux autres équipes de la poule n'est jamais affiché");
  assert.equal(p.location.hash, "#programme");
  const ancienne = await charger({ donnees: donneesPoules(), aujourdhui: JEUDI_19, hash: "#semaine" });
  assert.deepEqual(ancienne.titres(), ["Programme"]); // l'ancienne adresse #semaine ouvre le Programme
  assert.equal(ancienne.location.hash, "#programme");
  assert.deepEqual((await charger({ donnees: donneesPoules(), aujourdhui: JEUDI_19, memo: "semaine" })).titres(), ["Programme"]);
});

test("programme : ‹ et › parcourent toute la saison, bornés au premier et au dernier match ; Aujourd'hui revient", async () => {
  const p = await programme19();
  const b = boutons(p);
  assert.equal(b.auj.disabled, true); // déjà la semaine d'aujourd'hui
  assert.equal(b.prec.disabled, false);
  await cliquer(b.prec);
  assert.match(periode(p), /^Du 0?9\/11 au 15\/11$/);
  assert.match(texteJours(p), /Loisir Compet'Lib 2.*GEVEZE 2/);
  await cliquer(b.prec);
  assert.match(periode(p), /^Du 0?2\/11 au 0?8\/11$/);
  assert.match(texteJours(p), /M13M/);
  assert.equal(b.prec.disabled, true, "première semaine : le 7/11 est le premier match de la saison");
  assert.equal(b.auj.disabled, false);
  await cliquer(b.auj);
  assert.equal(periode(p), "Du 16/11 au 22/11");
  assert.equal(b.auj.disabled, true);
  await cliquer(b.suiv); await cliquer(b.suiv);
  assert.match(periode(p), /^Du 30\/11 au 06\/12$|^Du 30\/11 au 6\/12$/);
  assert.equal(b.suiv.disabled, true, "dernière semaine : le 5/12 est le dernier match de la saison");
  assert.equal(p.location.hash, "#programme"); // la navigation ne change pas l'adresse
});

test("programme : la semaine d'aujourd'hui reste accessible même hors des dates de la saison", async () => {
  const p = await charger({ donnees: donneesPoules(), aujourdhui: "2027-02-10T11:00:00Z" });
  assert.match(periode(p), /^Du 0?8\/02 au 14\/02$|^Du 8\/02 au 14\/02$/);
  assert.match(p.cartes()[0].textContent, /Aucun match du club cette semaine\./);
  const b = boutons(p);
  assert.equal(b.suiv.disabled, true);
  assert.equal(b.prec.disabled, false);
});

test("programme : « Heure à confirmer » quand FFvolley ne donne pas d'heure ; heure sinon", async () => {
  const p = await programme19();
  const samedi = jours(p)[0].lignes;
  assert.match(samedi.find(l => l.includes("M18F 2")), /^Heure à confirmerM18F 2DomicileGEVEZESALLE DU COSEC$/);
  assert.match(samedi.find(l => l.includes("D1F")), /^18 h 00D1FDomicileUGS CCV 3SALLE DU COSEC$/);
  assert.doesNotMatch(p.cartes()[0].textContent, /undefined|null|NaN/);
});

test("programme : plateau — une seule mention « Plateau » avec « VBG » si la salle est la nôtre, pas de domicile/extérieur par match", async () => {
  const p = await programme19();
  const plateau = jours(p)[0].lignes.find(l => l.includes("M13M"));
  assert.match(plateau, /^M13MPlateauVBG11 h 00VIC COMBOURG \(mixte\)11 h 00VE GUIPEL LANGAN 3 \(mixte\)$/);
  assert.doesNotMatch(plateau, /Domicile|Extérieur|ST GREGOIRE COSEC/);
  assert.equal(jours(p)[0].lignes.filter(l => l.includes("M13M")).length, 1, "une seule ligne pour tout le plateau");
});

test("programme : plateau avec exempt — nom de la salle si ce n'est pas la nôtre, mention « exempte d'un tour », pas de ligne « Exempt »", async () => {
  const p = await programme19();
  const m13f = jours(p)[0].lignes.filter(l => l.includes("M13F"));
  assert.equal(m13f.length, 1);
  assert.match(m13f[0], /^M13FPlateauLIFFREHeure à confirmerCHATEAUBOURG MARPIRE 35 V 2exempte d'un tour$/);
  assert.doesNotMatch(m13f[0], /Exempt[^e]|Exempt$/);
});

test("programme : plateau déjà joué — « Plateau » sans préciser qui reçoit, scores du point de vue du club", async () => {
  const p = await programme19();
  await cliquer(boutons(p).prec); await cliquer(boutons(p).prec);
  const l = jours(p)[0].lignes[0];
  assert.match(l, /^M13MPlateauVANTRAIN US \(mixte\)2–1 · 25-15 17-25 15-10exempte d'un tour$/);
  assert.doesNotMatch(l, /VBG|COSEC/);
});

test("programme : « Exempt » quand l'équipe n'a aucun autre match ce jour-là, jamais « xxxxx »", async () => {
  const p = await programme19();
  await cliquer(boutons(p).suiv); // semaine du 23/11
  const t = jours(p);
  assert.deepEqual(t.map(j => j.titre), ["lundi 23/11", "samedi 28/11"]);
  assert.match(t[1].lignes[0], /^D1FExempt$/);
  assert.doesNotMatch(p.cartes()[0].textContent, /xxxxx/i);
});

test("programme : nos noms d'équipe, jamais ceux que FFvolley utilise dans la poule ; sets retournés à l'extérieur", async () => {
  const p = await programme19();
  const tout = [];
  for (let i = 0; i < 3; i++) { tout.push(p.cartes()[0].textContent); await cliquer(boutons(p).prec); }
  await cliquer(boutons(p).auj); await cliquer(boutons(p).suiv); tout.push(p.cartes()[0].textContent);
  assert.doesNotMatch(tout.join("|"), /VOLLEY BALL GREGORIEN|VB GREGORIEN|ST GREGOIRE 2/);
  await cliquer(boutons(p).auj); await cliquer(boutons(p).prec);
  assert.match(jours(p)[0].lignes[0], /^DLoisir Compet'Lib 2ExtérieurGEVEZE 22–3 · 26-24 22-25 23-25 25-23 11-15$/);
});

test("programme : un match daté d'un jour futur mais déjà marqué joué affiche son score, il n'est pas « à venir »", async () => {
  const p = await programme19();
  await cliquer(boutons(p).suiv); // 23/11, alors qu'on est le 19
  const l = jours(p)[0].lignes[0];
  assert.match(l, /^VLoisir Compet'Lib 2DomicileQUEDILLAC3–1 · 25-19 21-25 25-22 25-23$/);
  assert.doesNotMatch(l, /Résultat pas encore publié|Heure/);
});

test("programme : un match passé sans score est signalé, un match illisible renvoie à FFvolley", async () => {
  const d = donneesPoules();
  d.equipes[0].poules[0].matchs.push({ date: "2026-11-17", heure: "20:00", dom: "VOLLEY BALL GREGORIEN", ext: "ADV PASSE", j: 4 },
                                     { date: "2026-11-18", dom: "ADV FORFAIT", ext: "VOLLEY BALL GREGORIEN", j: 4, illisible: true },
                                     { date: "2026-11-19", dom: "VOLLEY BALL GREGORIEN", ext: "ADV CASSE", sd: "3", se: null });
  const p = await programme19({ donnees: d });
  const t = jours(p).flatMap(j => j.lignes);
  assert.match(t.find(l => l.includes("ADV PASSE")), /20 h 00N3MDomicileADV PASSERésultat pas encore publié sur FFvolley/);
  assert.match(t.find(l => l.includes("ADV FORFAIT")), /Résultat à lire sur FFvolley/);
  assert.match(t.find(l => l.includes("ADV CASSE")), /Résultat à lire sur FFvolley/);
});

test("programme : filtre « À domicile » — FFvolley hors plateau, la salle seulement sur un plateau", async () => {
  const p = await programme19();
  const b = boutons(p);
  assert.equal(b.dom.getAttribute("aria-pressed"), "false");
  await cliquer(b.dom);
  assert.equal(b.dom.getAttribute("aria-pressed"), "true");
  const l = jours(p)[0].lignes.join("|");
  assert.match(l, /D1F/); assert.match(l, /M18F 2/);
  assert.match(l, /M13M.*Plateau.*VBG/);            // BMDA011 : « à l'extérieur » pour FFvolley, mais dans notre salle
  assert.doesNotMatch(l, /M13F|PRM/);               // plateau à Liffré, coupe à l'extérieur
  assert.equal(jours(p).length, 1, "dimanche : N3M à l'extérieur, masqué");
  await cliquer(b.suiv); await cliquer(b.suiv);     // 30/11 : plateau nominalement « à domicile » mais à Rennes TA
  assert.match(p.cartes()[0].textContent, /Aucun match à domicile cette semaine\./);
  await cliquer(b.dom);                              // filtre retiré : le plateau réapparaît, sans « VBG »
  assert.match(texteJours(p), /M13MPlateauRENNES TA/);
  assert.doesNotMatch(texteJours(p), /VBG/);
});

test("programme : filtre « À domicile » — un plateau déjà joué (salle effacée) est masqué, et le dit", async () => {
  const p = await programme19();
  await cliquer(boutons(p).prec); await cliquer(boutons(p).prec);
  await cliquer(boutons(p).dom);
  assert.equal(jours(p).length, 1, "seul reste le match à domicile du dimanche (N3M)");
  assert.match(texteJours(p), /^VN3MDomicileCESSON3–0/);
  assert.doesNotMatch(texteJours(p), /M13M/);
  assert.match(p.cartes()[0].textContent, /1 plateau\(x\) déjà joué\(s\) masqué\(s\) : leur salle n'est plus publiée\./);
});

test("programme : le filtre domicile ne compte pas un match isolé joué dans notre salle mais « à l'extérieur » (la salle ne décide que sur un plateau)", async () => {
  const d = donneesPoules();
  d.equipes[3].poules[0].matchs = [{ date: "2026-11-21", dom: "GEVEZE", ext: "ST GREGOIRE 2", salle: "SALLE DU COSEC", j: 2 }];
  const p = await programme19({ donnees: d });
  await cliquer(boutons(p).dom);
  assert.doesNotMatch(texteJours(p), /M18F 2/);
});

test("programme : le choix de semaine et le filtre survivent à « Actualiser » ; « Aujourd'hui » reprend la date de Paris", async () => {
  const p = await programme19();
  await cliquer(boutons(p).prec);
  await cliquer(boutons(p).dom);
  await p.clic("btn");
  assert.match(periode(p), /^Du 0?9\/11 au 15\/11$/);
  assert.equal(boutons(p).dom.getAttribute("aria-pressed"), "true");
  await p.choisir("n3m"); await p.choisir("programme"); // changer de vue puis revenir
  assert.match(periode(p), /^Du 0?9\/11 au 15\/11$/);
  await cliquer(boutons(p).auj);
  assert.equal(periode(p), "Du 16/11 au 22/11");
});

test("programme : au changement de date à Paris, la semaine suivie (celle d'aujourd'hui) est recalculée", async () => {
  const p = await charger({ donnees: donneesPoules(), aujourdhui: "2026-11-22T22:30:00Z" }); // dimanche 23 h 30 Paris
  assert.equal(periode(p), "Du 16/11 au 22/11");
  p.horloge("2026-11-22T23:30:00Z"); // lundi 0 h 30 Paris
  await p.revenir();
  assert.equal(periode(p), "Du 23/11 au 29/11");
});

test("programme : carte non lue — ses lignes, plateaux compris, portent « non lu depuis le … »", async () => {
  const d = donneesPoules();
  Object.assign(d.equipes[1], { nonlu: true, raison: "x", lu: "2026-11-15T21:16:37+01:00" });
  const p = await programme19({ donnees: d });
  const t = jours(p)[0].lignes;
  assert.match(t.find(l => l.includes("M13M")), /non lu depuis le 15 nov\./);
  assert.ok(t.filter(l => !l.includes("M13M")).every(l => !/non lu/.test(l)));
});

test("programme : « Données anciennes » reste affichée sur la vue Programme", async () => {
  const d = donneesPoules(); d.maj = "2026-11-10T07:00:00+01:00";
  const p = await programme19({ donnees: d });
  assert.equal(p.el("ancien").hidden, false);
  assert.match(p.el("ancien").textContent, /Données anciennes : dernière collecte il y a 9 jours/);
});

test("programme : une poule illisible n'abîme que sa carte ; deux phases d'une même équipe restent deux poules (pas un plateau)", async () => {
  const d = donneesPoules();
  d.equipes[2].poules = [{ nous: 5 }];                                  // carte M13F illisible
  d.equipes.push({ nom: "M18M région", poule: "M18M", lu: LU_19, prochain: null, resultats: [], poules: [
    { titre: "Phase 1", nous: "VOLLEY BALL GREGORIEN", active: false, classement: [], matchs: [{ date: "2026-11-21", heure: "13:30", dom: "BREST", ext: "VOLLEY BALL GREGORIEN", salle: "PEN AR C'HLEUZ" }] },
    { titre: "Phase 2", nous: "VOLLEY BALL GREGORIEN", active: true, classement: [], matchs: [{ date: "2026-11-21", heure: "15:00", dom: "VOLLEY BALL GREGORIEN", ext: "RENNES", salle: "COSEC" }] }] });
  const p = await programme19({ donnees: d });
  const t = p.cartes()[0].textContent;
  assert.match(t, /Données illisibles pour 1 carte\(s\)\./);
  assert.doesNotMatch(t, /M13F/);
  const m18 = jours(p)[0].lignes.filter(l => l.includes("M18M région"));
  assert.equal(m18.length, 2);
  assert.ok(m18.every(l => !/Plateau/.test(l)));
  assert.match(m18.join("|"), /ExtérieurBREST.*DomicileRENNES/);
  assert.match(t, /N3M/); // les autres cartes sont intactes
});

test("programme : le libellé d'une coupe est « équipe · nom de la coupe »", async () => {
  const p = await programme19();
  assert.match(jours(p)[0].lignes[0], /^10 h 00PRM · Coupe CD35 masculineExtérieurROMILLESALLE ANITA CONTI$/);
});

test("programme : ancien data.json sans « poules » ni « salles_club » : le Programme reste affiché (repli sur resultats, avenir, attente)", async () => {
  const d = JSON.parse(JSON.stringify(DATA));
  for (const e of [...d.equipes, ...d.coupes]) delete e.poules;
  delete d.salles_club;
  const p = await charger({ donnees: d, aujourdhui: "2026-11-16T10:00:00Z" });
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.ok(jours(p).length > 0);
  assert.doesNotMatch(p.cartes()[0].textContent, /undefined|null|NaN/);
  await cliquer(boutons(p).dom);                      // le filtre fonctionne sans salles_club
  assert.deepEqual(p.titres(), ["Programme"]);
});

test("programme : charte — boutons de 48 px, orange seulement sur le bouton actif, rien d'orange dans les lignes de plateau", () => {
  const { regles } = reglesCss();
  const r = s => regles.find(x => x.sel === s);
  assert.match(r(".nav button").corps, /min-width:\s*48px/);
  assert.match(r("button").corps, /min-height:\s*48px/);
  assert.match(r(".bascule").corps, /width:\s*100%/);
  for (const sel of [".bascule", ".pl", ".pl .h", ".pl .h.sans", ".pl-txt", ".pl-txt small", ".nav"]) {
    assert.ok(r(sel), "règle absente : " + sel);
    assert.doesNotMatch(r(sel).corps, /#F26910/i, sel);
  }
  assert.match(r('.bascule[aria-pressed="true"]').corps, /#F26910/i); // état actif : accent autorisé sur un bouton
  assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test("programme : l'ancienne adresse #semaine, saisie à la main depuis une autre vue, ouvre le Programme", async () => {
  const p = await programme19({ hash: "#n3m" });
  assert.deepEqual(p.titres(), ["N3M"]);
  await p.hashchange("#semaine");
  assert.deepEqual(p.titres(), ["Programme"]);
  assert.equal(p.location.hash, "#programme");
});

test("programme : une salle au nom voisin de la nôtre (« GYMNASE DU COSEC ») ne fait pas passer un plateau pour le nôtre", async () => {
  const d = donneesPoules();
  for (const m of d.equipes[1].poules[0].matchs) if (m.salle === "ST GREGOIRE COSEC") m.salle = "GYMNASE DU COSEC";
  const p = await programme19({ donnees: d });
  assert.match(jours(p)[0].lignes.find(l => l.includes("M13M")), /^M13MPlateauGYMNASE DU COSEC/);
  await cliquer(boutons(p).dom);
  assert.doesNotMatch(texteJours(p), /M13M/);
  const e = donneesPoules();
  for (const m of e.equipes[1].poules[0].matchs) if (m.salle === "ST GREGOIRE COSEC") m.salle = "st gregoire cosec"; // casse différente : c'est bien notre salle
  assert.match(jours(await programme19({ donnees: e }))[0].lignes.find(l => l.includes("M13M")), /PlateauVBG/);
});

// ---- Vue « Poule » : classement complet, nos matchs restants, « Toute la poule », adresse #poule-<équipe> ----
function donneesPoulesClassees() {
  const d = donneesPoules();
  const n3m = d.equipes[0].poules[0];
  n3m.titre = "Nationale 3 masculine poule F";
  n3m.classement = [
    { rang: 1, club: "C.P.B. RENNES 35", pts: 18, j: 6, g: 6, p: 0 },
    { rang: 2, club: "HEOL SANTEC", pts: 12, j: 6, g: 4, p: 2 },
    { rang: 8, club: "VOLLEY BALL GREGORIEN", pts: 6, j: 6, g: 2, p: 4 }];
  n3m.matchs.push({ date: "2026-12-06", heure: "15:00", dom: "VOLLEY BALL GREGORIEN", ext: "HEOL SANTEC", j: 7 });
  const m13 = d.equipes[1].poules[0];
  m13.classement = [{ rang: 1, club: "VIC COMBOURG (mixte)", pts: 4, j: 2, g: 2, p: 0 }, { rang: 4, club: "VB GREGORIEN (masc)", pts: 2, j: 1, g: 1, p: 0 }];
  return d;
}
const poulePage = async (hash = "#poule-n3m", extra = {}) => charger({ donnees: donneesPoulesClassees(), aujourdhui: JEUDI_19, hash, ...extra });
const carteP = p => p.cartes()[0];
const lignesDe = (c, classe) => c.trouver(e => e.tag === "li" && e.className === classe);

test("poule : chaque fiche d'équipe porte un lien « Poule et classement » vers #poule-<équipe> ; plus de bloc « Calendrier »", async () => {
  const p = await charger({ donnees: donneesPoulesClassees(), aujourdhui: JEUDI_19, hash: "#n3m" });
  const liens = carteP(p).trouver(e => e.tag === "a");
  assert.equal(liens.length, 1);
  assert.equal(liens[0].textContent, "Poule et classement");
  assert.equal(liens[0].href, "#poule-n3m");
  assert.doesNotMatch(p.el("grille").textContent, /Calendrier/);
  assert.doesNotMatch(HTML, /blocCalendrier|Matchs à venir/);
  const toutes = await charger({ donnees: donneesPoulesClassees(), aujourdhui: JEUDI_19, hash: "#toutes" });
  const hrefs = toutes.cartes().flatMap(c => c.trouver(e => e.tag === "a")).map(a => a.href);
  assert.deepEqual(hrefs, donneesPoulesClassees().equipes.map(q => "#poule-" + vm.runInContext("slug", toutes.sandbox)(q.nom)));
  const coupes = await charger({ donnees: donneesPoulesClassees(), aujourdhui: JEUDI_19, hash: "#coupes" });
  assert.equal(carteP(coupes).trouver(e => e.tag === "a").length, 0, "pas de vue Poule pour les coupes");
});

test("poule : l'adresse #poule-<équipe> ouvre la vue, quelle que soit la casse ou l'encodage ; une adresse inconnue retombe sur le Programme", async () => {
  const p = await poulePage();
  assert.deepEqual(p.titres(), ["N3M"]);
  assert.equal(p.location.hash, "#poule-n3m");
  assert.equal(p.el("vue").value, "n3m", "le menu garde l'équipe");
  assert.equal(p.options().length, donneesPoulesClassees().equipes.length + 3, "aucune entrée de menu en plus");
  for (const h of ["#POULE-N3M", "#poule-n3m", "#Poule-N3M"]) assert.deepEqual((await poulePage(h)).titres(), ["N3M"], h);
  const m18 = donneesPoulesClassees();
  m18.equipes.push({ nom: "M18M région", poule: "M18M", lu: LU_19, prochain: null, resultats: [], poules: [{ titre: "M18M performance poule C", nous: "X", active: true, classement: [], matchs: [] }] });
  for (const h of ["#poule-m18m-region", "#poule-m18m-r%C3%A9gion", "#POULE-M18M-R%C3%89GION"]) {
    const q = await charger({ donnees: m18, aujourdhui: JEUDI_19, hash: h });
    assert.deepEqual(q.titres(), ["M18M région"], h);
    assert.equal(q.location.hash, "#poule-m18m-region", h);
  }
  assert.deepEqual((await poulePage("#poule-inconnue")).titres(), ["Programme"]);
  assert.deepEqual((await poulePage("#poule-coupe-cd35-masculine")).titres(), ["Programme"]);
  assert.deepEqual((await poulePage("#poule-programme")).titres(), ["Programme"]);
  const depuisEquipe = await poulePage("#pnf");
  await depuisEquipe.hashchange("#poule-n3m");
  assert.deepEqual(depuisEquipe.titres(), ["N3M"]);
  assert.equal(depuisEquipe.stock["vbg-vue"], "poule-n3m");
});

test("poule : classement complet, notre ligne surlignée sous notre nom (pas celui de FFvolley)", async () => {
  const c = carteP(await poulePage());
  const t = c.textContent;
  assert.match(t, /Nationale 3 masculine poule F/);
  const lignes = c.trouver(e => e.tag === "ul" && e.className === "cl")[0].children;
  assert.equal(lignes.length, 1 + 3, "en-tête + 3 équipes");
  assert.equal(lignes[0].textContent, "ÉquipePtsJGP");
  assert.equal(lignes[1].textContent, "1C.P.B. RENNES 3518660");
  assert.equal(lignes[3].textContent, "8N3M6624");
  assert.equal(lignes[3].className, "moi");
  assert.equal(lignes.filter(l => l.className === "moi").length, 1);
  assert.doesNotMatch(t, /VOLLEY BALL GREGORIEN/);
  assert.match(t, /Pts points · J joués · G gagnés · P perdus/);
});

test("poule : nos matchs restants — ni joués ni commencés, avec date, heure ou « Heure à confirmer », adversaire et salle", async () => {
  const c = carteP(await poulePage());
  const restants = c.trouver(e => e.tag === "section")[1].textContent;
  assert.match(restants, /^Nos matchs restants/);
  assert.match(restants, /dimanche 22\/11.*16 h 00ExtérieurC\.P\.B\. RENNES 35GYMNASE CDT BOUGOUIN/);
  assert.match(restants, /dimanche 06\/12.*15 h 00DomicileHEOL SANTEC/);
  assert.doesNotMatch(restants, /CESSON/, "le match du 8/11 est joué");
  const futur = donneesPoulesClassees();
  futur.equipes[0].poules[0].matchs.push({ date: "2026-11-29", dom: "VOLLEY BALL GREGORIEN", ext: "ADV DEJA JOUE", j: 8, sd: 3, se: 0, sets: "25-10 25-10 25-10" });
  assert.doesNotMatch(carteP(await poulePage("#poule-n3m", { donnees: futur })).trouver(e => e.tag === "section")[1].textContent, /ADV DEJA JOUE/, "daté du futur mais déjà noté : ce n'est pas un match restant");
  assert.doesNotMatch(restants, /N3M/, "pas de nom d'équipe répété dans les lignes");
  const apres = await poulePage("#poule-n3m", { aujourdhui: "2026-11-22T16:30:00Z" }); // dimanche 17 h 30 Paris : 16 h passée
  assert.doesNotMatch(carteP(apres).trouver(e => e.tag === "section")[1].textContent, /CPB|C\.P\.B/);
});

test("poule : matchs restants d'un plateau (« Plateau » et « VBG ») et exempt à venir, sans doublon avec les matchs joués", async () => {
  const m13 = carteP(await poulePage("#poule-m13m")).trouver(e => e.tag === "section")[1].textContent;
  assert.match(m13, /samedi 21\/11Plateau.*VBG11 h 00VIC COMBOURG \(mixte\)11 h 00VE GUIPEL LANGAN 3 \(mixte\)/);
  assert.match(m13, /samedi 05\/12.*PlateauRENNES TA/);
  assert.doesNotMatch(m13, /ANTRAIN|07\/11/, "plateau du 7/11 déjà joué, exempt compris");
  const d1f = carteP(await poulePage("#poule-d1f")).trouver(e => e.tag === "section")[1].textContent;
  assert.match(d1f, /samedi 28\/11Exempt/);
  const vide = donneesPoulesClassees(); vide.equipes[0].poules[0].matchs = vide.equipes[0].poules[0].matchs.filter(m => m.sd !== undefined);
  assert.match(carteP(await poulePage("#poule-n3m", { donnees: vide })).textContent, /Aucun match restant\./);
});

test("poule : « Toute la poule » — toutes les journées et tous les matchs, nos lignes marquées sous notre nom, repliable", async () => {
  const d10 = donneesPoulesClassees();
  d10.equipes[0].poules[0].matchs.push({ date: "2027-01-10", dom: "AUTRE A", ext: "AUTRE B", j: 10 });
  const p = await poulePage("#poule-n3m", { donnees: d10 });
  const c = carteP(p);
  const bouton = c.trouver(e => e.tag === "button")[0];
  assert.equal(bouton.textContent, "Toute la poule");
  assert.equal(bouton.getAttribute("aria-pressed"), "false");
  assert.doesNotMatch(c.textContent, /AUTRE A/);
  await cliquer(bouton);
  assert.equal(bouton.getAttribute("aria-pressed"), "true");
  const zone = c.trouver(e => e.className === "journees")[0];
  assert.deepEqual(zone.children.filter(e => e.tag === "h3").map(e => e.textContent), ["Journée 5", "Journée 6", "Journée 7", "Journée 10"], "ordre numérique, pas alphabétique");
  const lignes = zone.trouver(e => e.tag === "li").map(e => e.textContent);
  assert.equal(lignes.length, 5, "les 5 matchs de la poule, y compris ceux de deux autres équipes");
  assert.match(lignes[0], /^08\/11|^8\/11/);
  assert.ok(lignes.some(l => /AUTRE A – AUTRE B/.test(l)));
  assert.ok(lignes.some(l => /N3M – CESSON3–0 · 25-18 28-26 25-15/.test(l)));
  assert.ok(lignes.some(l => /C\.P\.B\. RENNES 35 – N3M16 h 00 · GYMNASE CDT BOUGOUIN/.test(l)));
  assert.equal(zone.trouver(e => e.tag === "li" && /\bmoi\b/.test(e.className)).length, 3, "nos trois matchs sont marqués");
  assert.doesNotMatch(zone.textContent, /VOLLEY BALL GREGORIEN/);
  await cliquer(bouton);
  assert.equal(zone.children.length, 0);
  assert.equal(bouton.getAttribute("aria-pressed"), "false");
});

test("poule : « Toute la poule » — scores du point de vue de celui qui reçoit, exempt, heure à confirmer, forfait", async () => {
  const d = donneesPoulesClassees();
  d.equipes[1].poules[0].matchs.push({ date: "2026-12-19", dom: "RENNES TA 1 (masc)", ext: "ANTRAIN US (mixte)", j: 4, illisible: true });
  const p = await poulePage("#poule-m13m", { donnees: d });
  const c = carteP(p);
  await cliquer(c.trouver(e => e.tag === "button")[0]);
  const t = c.trouver(e => e.className === "journees")[0].textContent;
  assert.match(t, /M13M – ANTRAIN US \(mixte\)2–1 · 25-15 17-25 15-10/);
  assert.match(t, /M13M : exempt/);
  assert.doesNotMatch(t, /xxxxx/i);
  assert.match(t, /RENNES TA 1 \(masc\) – ANTRAIN US \(mixte\)Résultat à lire sur FFvolley/);
  assert.match(t, /M13M – RENNES TA 2 \(mixte\)Heure à confirmer · RENNES TA/);
  assert.doesNotMatch(t, /undefined|null|NaN/);
});

test("poule : M18M région — la phase en cours est nommée, son classement seul est affiché", async () => {
  const d = donneesPoulesClassees();
  d.equipes.push({ nom: "M18M région", poule: "M18M", lu: LU_19, prochain: null, resultats: [], poules: [
    { titre: "M18M performance poule C", nous: "VOLLEY BALL GREGORIEN", active: false, classement: [{ rang: 3, club: "ANCIENNE PHASE", pts: 1, j: 1, g: 0, p: 1 }], matchs: [] },
    { titre: "M18M performance poule E", nous: "VOLLEY BALL GREGORIEN", active: true, classement: [{ rang: 4, club: "VOLLEY BALL GREGORIEN", pts: 3, j: 2, g: 1, p: 1 }], matchs: [] }] });
  const c = carteP(await poulePage("#poule-m18m-region", { donnees: d }));
  assert.match(c.textContent, /M18M performance poule E/);
  assert.match(c.textContent, /Phase en cours/);
  assert.doesNotMatch(c.textContent, /ANCIENNE PHASE|poule C/);
  assert.equal(lignesDe(c, "moi")[0].textContent, "4M18M région3211");
});

test("poule : classement pas encore publié (début de phase) ; ancien data.json sans « poules » : message, repli sur le rang, aucun bouton « Toute la poule »", async () => {
  const d = donneesPoulesClassees(); d.equipes[0].poules[0].classement = [];
  assert.match(carteP(await poulePage("#poule-n3m", { donnees: d })).textContent, /Classement de la poule pas encore publié\./);
  const vieux = donneesPoulesClassees();
  Object.assign(vieux.equipes[0], { rang: 8, sur: 12, pts: 6, g: 2, p: 4, avenir: [{ date: "2026-11-22", lieu: "E", adv: "CPB RENNES", heure: "16:00", salle: "GYMNASE BOUGOUIN" }] });
  delete vieux.equipes[0].poules; delete vieux.salles_club;
  const c = carteP(await poulePage("#poule-n3m", { donnees: vieux }));
  assert.match(c.textContent, /Classement complet disponible après la prochaine collecte\./);
  assert.match(c.textContent, /8e sur 12 · 6 pts · 2 V · 4 D/);
  assert.match(c.textContent, /dimanche 22\/11.*16 h 00ExtérieurCPB RENNESGYMNASE BOUGOUIN/);
  assert.equal(c.trouver(e => e.tag === "button").length, 0);
  const secours = await charger({ reseau: false, hash: "#poule-n3m", aujourdhui: "2026-11-16T10:00:00Z" }); // copie intégrée
  assert.deepEqual(secours.titres(), ["N3M"]);
  assert.match(carteP(secours).textContent, /Classement complet disponible après la prochaine collecte\./);
});

test("poule : carte non lue signalée ; donnée illisible n'abîme que cette vue ; la date de Paris recalcule les matchs restants", async () => {
  const d = donneesPoulesClassees(); Object.assign(d.equipes[0], { nonlu: true, raison: "x", lu: "2026-11-15T21:16:37+01:00" });
  const c = carteP(await poulePage("#poule-n3m", { donnees: d }));
  assert.match(c.textContent, /Non lu/);
  assert.match(c.textContent, /Dernières données connues du 15 nov\./);
  const casse = donneesPoulesClassees(); casse.equipes[0].poules = [{ nous: 3, matchs: "oups" }];
  const p = await poulePage("#poule-n3m", { donnees: casse });
  assert.match(carteP(p).textContent, /illisibles/);
  await p.choisir("m13f");
  assert.deepEqual(p.titres(), ["M13F"]);
  const r = await poulePage("#poule-n3m");
  assert.match(carteP(r).textContent, /dimanche 22\/11/);
  r.horloge("2026-11-22T17:00:00Z"); await r.revenir();
  assert.doesNotMatch(carteP(r).trouver(e => e.tag === "section")[1].textContent, /dimanche 22\/11/);
});

test("poule : le lien « Match de coupe cette semaine » n'apparaît pas dans la vue Poule", async () => {
  const d = donneesPoulesClassees();
  d.coupes[0].prochain = { date: "2026-11-21", lieu: "E", adv: "ROMILLE", heure: "10:00", salle: null };
  assert.equal((await poulePage("#n3m", { donnees: d })).el("lien-coupe").hidden, false, "sur une fiche d'équipe, la ligne apparaît (match dans 7 jours)");
  const p = await poulePage("#poule-n3m", { donnees: d });
  assert.equal(p.el("lien-coupe").hidden, true);
});

test("poule : charte — lien de 48 px, ligne surlignée en #111111 avec filet orange, aucun texte orange, textContent seulement", () => {
  const { regles } = reglesCss();
  const r = s => regles.find(x => x.sel === s);
  assert.match(r(".lien-poule").corps, /min-height:\s*48px/);
  assert.match(r(".cl li.moi").corps, /background:#111111/i);
  assert.doesNotMatch(r(".cl li.moi").corps, /(^|;)color:\s*#F26910/i);
  for (const sel of [".cl", ".cl li", ".cl li.tete", ".cl .num", ".bloc", ".journees", ".mt.moi .qui"]) {
    assert.ok(r(sel), "règle absente : " + sel);
    assert.doesNotMatch(r(sel).corps, /#F26910/i, sel);
  }
  assert.doesNotMatch(SCRIPT, /innerHTML|insertAdjacentHTML|outerHTML/);
});

// ---- Relecture indépendante : défauts trouvés puis corrigés ----
test("programme et poule : « SALLE DU COSEC » ne suffit pas — un plateau où nous ne recevons dans aucune ligne affiche la salle, pas « VBG »", async () => {
  const d = donneesPoules();
  d.equipes[3].poules[0].matchs = [
    { date: "2026-11-21", heure: "10:00", dom: "GUICHEN 2", ext: "ST GREGOIRE 2", salle: "SALLE DU COSEC", j: 2 },
    { date: "2026-11-21", heure: "11:00", dom: "GUICHEN 2", ext: "AUTRE", salle: "SALLE DU COSEC", j: 2 },
    { date: "2026-11-21", heure: "12:00", dom: "AUTRE", ext: "ST GREGOIRE 2", salle: "SALLE DU COSEC", j: 2 }];
  const p = await programme19({ donnees: d });
  const ligne = jours(p)[0].lignes.find(l => l.includes("M18F 2"));
  assert.match(ligne, /^M18F 2PlateauSALLE DU COSEC/);
  assert.doesNotMatch(ligne, /VBG/);
  await cliquer(boutons(p).dom);
  assert.doesNotMatch(texteJours(p), /M18F 2/, "ce plateau n'est pas à domicile");
  const q = await poulePage("#poule-m18f-2", { donnees: d });
  assert.match(carteP(q).trouver(e => e.tag === "section")[1].textContent, /PlateauSALLE DU COSEC/);
  d.equipes[3].poules[0].matchs[0].dom = "ST GREGOIRE 2"; d.equipes[3].poules[0].matchs[0].ext = "GUICHEN 2"; // une ligne nous met à domicile
  assert.match(jours(await programme19({ donnees: d }))[0].lignes.find(l => l.includes("M18F 2")), /PlateauVBG/);
});

test("poule : un plateau déjà entamé reste un plateau (le match joué compte) ; un exempt n'est pas « Exempt » le jour d'un match joué", async () => {
  const d = donneesPoulesClassees();
  d.equipes[3].poules[0].matchs = [
    { date: "2026-11-21", heure: "10:00", dom: "ST GREGOIRE 2", ext: "ADV JOUE", salle: "SALLE DU COSEC", j: 2, sd: 3, se: 0, sets: "25-10 25-10 25-10" },
    { date: "2026-11-21", heure: "14:00", dom: "ADV RESTANT", ext: "ST GREGOIRE 2", salle: "SALLE DU COSEC", j: 2 }];
  const treize = { donnees: d, aujourdhui: "2026-11-21T12:00:00Z" }; // samedi 13 h à Paris
  const r = carteP(await poulePage("#poule-m18f-2", treize)).trouver(e => e.tag === "section")[1].textContent;
  assert.match(r, /samedi 21\/11PlateauVBG14 h 00ADV RESTANT/);
  assert.doesNotMatch(r, /Extérieur|ADV JOUE/, "pas de ligne simple « Extérieur » : c'est un plateau");
  d.equipes[3].poules[0].matchs = [
    { date: "2026-11-21", heure: "10:00", dom: "ST GREGOIRE 2", ext: "ADV JOUE", salle: "SALLE DU COSEC", j: 2, sd: 3, se: 0, sets: "25-10 25-10 25-10" },
    { date: "2026-11-21", dom: "ST GREGOIRE 2", exempt: true, j: 2 }];
  const e = carteP(await poulePage("#poule-m18f-2", treize)).trouver(e2 => e2.tag === "section")[1].textContent;
  assert.match(e, /Aucun match restant\./);
  assert.doesNotMatch(e, /Exempt/);
});

test("poule : un chiffre de classement absent ou illisible s'écrit « – », jamais « undefined »", async () => {
  const d = donneesPoulesClassees();
  d.equipes[0].poules[0].classement = [{ club: "VOLLEY BALL GREGORIEN" }, { rang: "2", club: null, pts: null, j: 1, g: 1, p: 0 }];
  const c = carteP(await poulePage("#poule-n3m", { donnees: d }));
  const lignes = c.trouver(e => e.tag === "ul" && e.className === "cl")[0].children.map(l => l.textContent);
  assert.equal(lignes[1], "–N3M––––");
  assert.equal(lignes[2], "–––110");
  assert.doesNotMatch(c.textContent, /undefined|null|NaN/);
});

test("programme : revenir par ‹ ou › à la semaine d'aujourd'hui la fait suivre au changement de date de Paris", async () => {
  const p = await charger({ donnees: donneesPoules(), aujourdhui: "2026-11-22T22:30:00Z" }); // dimanche 23 h 30 Paris
  await cliquer(boutons(p).suiv); await cliquer(boutons(p).prec);
  assert.equal(periode(p), "Du 16/11 au 22/11");
  assert.equal(boutons(p).auj.disabled, true);
  p.horloge("2026-11-22T23:30:00Z"); await p.revenir(); // lundi 0 h 30
  assert.equal(periode(p), "Du 23/11 au 29/11");
});

test("programme : repli sans « poules », des sets qui ne sont pas du texte ne s'affichent pas", async () => {
  const d = donneesSemaine();
  d.equipes[0].resultats[0].sets = { a: 1 };
  const p = await charger({ donnees: d, aujourdhui: SAMEDI_MIDI });
  assert.doesNotMatch(p.cartes()[0].textContent, /\[object|undefined|null/);
  assert.match(jours(p)[1].lignes[0], /^VN3MDomicileADV MERCREDI3–0$/);
});

test("programme : quand le bouton cliqué devient inactif (borne), le focus passe à un bouton actif", async () => {
  const p = await programme19();
  const b = boutons(p);
  await cliquer(b.prec); await cliquer(b.prec); // première semaine : ‹ inactif
  assert.equal(b.prec.disabled, true);
  assert.ok(p.actif() && p.actif() !== b.prec && !p.actif().disabled, "le focus ne reste pas sur un bouton inactif");
  await cliquer(b.auj);
  assert.equal(b.auj.disabled, true);
  assert.ok(p.actif() !== b.auj && !p.actif().disabled);
});

// ---- heures saisies par le club (« heure_saisie » dans data.json) : affichage seulement ----
function avecSaisies() {
  const d = donneesPoules();
  const eq = nom => d.equipes.find(e => e.nom === nom);
  const match = (nom, pred) => eq(nom).poules[0].matchs.find(pred);
  match("M18F 2", m => m.date === "2026-11-21").heure_saisie = "18:30";
  match("M13F", m => m.ext === "VB GREGORIEN").heure_saisie = "17:15";
  match("D1F", m => m.date === "2026-11-21").heure_saisie = "17:00";                 // FFvolley donne 18:00 : elle gagne
  match("M13M", m => m.ext === "RENNES TA 2 (mixte)").heure_saisie = "14:00";
  return d;
}

test("saisie : heure du club affichée avec « saisie VBG » quand FFvolley n'en donne pas (ligne simple, plateau)", async () => {
  const p = await programme19({ donnees: avecSaisies() });
  const samedi = jours(p)[0].lignes;
  assert.match(samedi.find(l => l.includes("M18F 2")), /^18 h 30M18F 2DomicileGEVEZESALLE DU COSECsaisie VBG$/);
  assert.match(samedi.find(l => l.includes("M13F")), /^M13FPlateauLIFFRE17 h 15CHATEAUBOURG MARPIRE 35 V 2saisie VBGexempte d'un tour$/);
  assert.doesNotMatch(programme(p), /Heure à confirmerM18F 2|Heure à confirmerM13F/);
});

test("saisie : l'heure de FFvolley l'emporte, sans mention « saisie VBG »", async () => {
  const p = await programme19({ donnees: avecSaisies() });
  const d1f = jours(p)[0].lignes.find(l => l.includes("D1F"));
  assert.match(d1f, /^18 h 00D1FDomicileUGS CCV 3SALLE DU COSEC$/);
  assert.doesNotMatch(d1f, /saisie|17 h/);
});

test("saisie : l'heure du club sert aussi à l'ordre du jour (avant un match sans heure, selon l'heure)", async () => {
  const d = donneesPoules();
  d.equipes.find(e => e.nom === "M18F 2").poules[0].matchs[0].heure_saisie = "09:00";
  const lignes = jours(await programme19({ donnees: d }))[0].lignes;
  assert.ok(lignes.findIndex(l => l.includes("M18F 2")) < lignes.findIndex(l => l.includes("M13M")), "09 h 00 passe avant 11 h 00");
});

test("saisie : une valeur illisible n'est jamais affichée (« Heure à confirmer » reste)", async () => {
  const d = donneesPoules();
  const m = d.equipes.find(e => e.nom === "M18F 2").poules[0].matchs[0];
  for (const mauvais of ["25:99", "18:30; rm", "18h30", 1830, null, "<b>18:30</b>", "18:30\n"]) {
    m.heure_saisie = mauvais;
    const l = jours(await programme19({ donnees: d }))[0].lignes.find(x => x.includes("M18F 2"));
    assert.match(l, /^Heure à confirmerM18F 2DomicileGEVEZESALLE DU COSEC$/, String(mauvais));
  }
});

test("saisie : vue Poule (« Toute la poule ») et fiche d'équipe (prochain match)", async () => {
  const d = avecSaisies();
  d.equipes.find(e => e.nom === "M18F 2").prochain = { date: "2026-11-21", lieu: "D", adv: "GEVEZE", heure: null, salle: "SALLE DU COSEC", heure_saisie: "18:30" };
  d.equipes.find(e => e.nom === "M18F 2").classement = undefined;
  const fiche = await charger({ donnees: d, aujourdhui: JEUDI_19, hash: "#m18f-2" });
  assert.match(fiche.cartes()[0].textContent, /Prochain matchsam. 21 nov. · 18 h 30saisie VBGDOMICILEGEVEZE/);
  assert.match(fiche.cartes()[0].textContent, /saisie VBG/);
  const poule = await charger({ donnees: d, aujourdhui: JEUDI_19, hash: "#poule-m13m" });
  const c = poule.cartes()[0];
  await cliquer(c.trouver(e => e.tag === "button").find(b => b.className === "bascule"));
  assert.match(c.trouver(e => e.className === "journees")[0].textContent, /M13M – RENNES TA 2 \(mixte\)14 h 00 · saisie VBG · RENNES TA/);
});

test("saisie : ordre — l'heure de FFvolley prime sur la saisie pour trier ; sur un plateau, les lignes suivent l'heure saisie", async () => {
  const d = donneesPoules();
  const eq = nom => d.equipes.find(e => e.nom === nom);
  eq("D1F").poules[0].matchs[0].heure_saisie = "08:00";                  // FFvolley : 18:00, donc après M13M (11:00)
  const l = jours(await programme19({ donnees: d }))[0].lignes;
  assert.ok(l.findIndex(x => x.includes("D1F")) > l.findIndex(x => x.includes("M13M")), "D1F reste à 18 h 00");
  const ms = eq("M13M").poules[0].matchs;
  ms.find(m => m.ext === "RENNES TA 1 (masc)").heure_saisie = "15:00";
  ms.find(m => m.ext === "RENNES TA 2 (mixte)").heure_saisie = "14:00";
  const p = await programme19({ donnees: d, aujourdhui: "2026-12-03T12:00:00Z" });
  const plateau = jours(p).flatMap(j => j.lignes).find(x => x.includes("M13M"));
  assert.match(plateau, /14 h 00RENNES TA 2 \(mixte\)saisie VBG15 h 00RENNES TA 1 \(masc\)saisie VBG/);
});
