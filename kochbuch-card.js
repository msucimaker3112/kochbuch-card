/* kochbuch-card v0.6.0 – eigenes Kochbuch für Home Assistant: Rezepte schreiben und bebildern, Kochmodus mit Timern, Zutaten auf die Einkaufsliste,
   Rezepte aus dem Internet einlesen (schema.org-Rezeptdaten der Seite).
   Rezepte liegen in einem eigenen Dashboard (store), Bilder im Bilderspeicher von Home Assistant (image_upload).
   Seitenabruf über rest_command.kochbuch_abruf, sonst über einen öffentlichen Abrufdienst. */
(() => {
  const VERSION = '0.6.0';
  // Öffentliche Abrufdienste, nur als Notlösung ohne rest_command (oft überlastet)
  const PROXIES = ['https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest='];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* gesperrt */ } };

  const CATS = ['Hauptgericht', 'Vorspeise', 'Suppe', 'Salat', 'Beilage', 'Dessert', 'Kuchen & Gebäck', 'Brot', 'Frühstück', 'Snack', 'Soße & Dip', 'Getränk'];
  const DIFF = ['', 'einfach', 'mittel', 'anspruchsvoll'];
  // Schnellwahl für freie Timer (Minuten)
  const QUICK = [['Eier weich', 5], ['Eier wachsweich', 7], ['Eier hart', 10], ['Nudeln', 9], ['Reis', 15], ['Kartoffeln', 20]];
  const MINUTES = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60];
  // Einheiten, die beim Einfügen als Text erkannt werden (längere zuerst)
  const UNITS = ['Päckchen', 'Handvoll', 'Scheiben', 'Spritzer', 'Stangen', 'Tropfen', 'Scheibe', 'Blätter', 'Gläser', 'Tassen', 'Zweige', 'Becher', 'Beutel', 'Prisen', 'Stange', 'Würfel', 'Liter', 'Gramm', 'Dosen', 'Zehen', 'Stück', 'Tasse', 'Prise', 'Zweig', 'Blatt', 'Schuss', 'Kilo', 'Bund', 'Dose', 'Glas', 'Kopf', 'Msp.', 'Pck.', 'Stk.', 'Tüte', 'Zehe', 'EL', 'TL', 'kg', 'mg', 'ml', 'cl', 'dl', 'g', 'l'];
  const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

  // "1,5" "1/2" "1 ½" "½" -> Zahl
  const num = (s) => {
    s = String(s || '').trim().replace(',', '.');
    if (!s) return null;
    let v = 0, any = false;
    s.split(/\s+/).forEach((p) => {
      if (FRAC[p] !== undefined) { v += FRAC[p]; any = true; return; }
      const last = p.slice(-1);
      if (FRAC[last] !== undefined && /^\d+$/.test(p.slice(0, -1))) { v += +p.slice(0, -1) + FRAC[last]; any = true; return; }
      const f = p.match(/^(\d+)\/(\d+)$/);
      if (f) { v += +f[1] / +f[2]; any = true; return; }
      if (/^\d*\.?\d+$/.test(p)) { v += +p; any = true; }
    });
    return any ? v : null;
  };
  // "250" "1-2" -> {a, a2}
  const parseAmt = (s) => {
    const p = String(s || '').split(/\s*[-–]\s*/);
    const a = num(p[0]);
    if (a === null) return { a: null, a2: null };
    const a2 = p.length > 1 ? num(p[1]) : null;
    return { a, a2 };
  };
  const fmtNum = (v) => {
    if (v >= 100) return String(Math.round(v / 5) * 5);
    if (v >= 10) return String(Math.round(v));
    const w = Math.floor(v), r = v - w;
    if (r < 0.04) return String(w);
    if (r > 0.96) return String(w + 1);
    for (const [ch, k] of Object.entries(FRAC)) if (Math.abs(r - k) < 0.04) return (w ? w : '') + ch;
    return (Math.round(v * 10) / 10).toString().replace('.', ',');
  };
  // Menge für die Anzeige, umgerechnet auf die gewählte Portionszahl
  const fmtAmt = (it, f) => {
    if (it.amount === null || it.amount === undefined || it.amount === '') return '';
    let v = it.amount * f, v2 = it.amount2 ? it.amount2 * f : null, u = it.unit || '';
    if ((u === 'g' || u === 'ml') && v >= 1000) { v /= 1000; if (v2) v2 /= 1000; u = u === 'g' ? 'kg' : 'l'; }
    return fmtNum(v) + (v2 ? '–' + fmtNum(v2) : '') + (u ? ' ' + u : '');
  };
  const SAY_UNIT = { g: 'Gramm', kg: 'Kilogramm', mg: 'Milligramm', ml: 'Milliliter', l: 'Liter', cl: 'Zentiliter', dl: 'Deziliter', EL: 'Esslöffel', TL: 'Teelöffel', 'Msp.': 'Messerspitze', 'Pck.': 'Päckchen', 'Stk.': 'Stück' };
  const SAY_FRAC = { '½': ['5', 'ein halb'], '¼': ['25', 'ein viertel'], '¾': ['75', 'drei viertel'], '⅓': ['33', 'ein drittel'], '⅔': ['66', 'zwei drittel'], '⅛': ['125', 'ein achtel'] };
  const sayAmt = (it, f) => fmtAmt(it, f)
    .replace(/(\d)([½¼¾⅓⅔⅛])/g, (m, d, c) => d + ',' + SAY_FRAC[c][0])
    .replace(/[½¼¾⅓⅔⅛]/g, (c) => SAY_FRAC[c][1])
    .replace('–', ' bis ')
    .replace(/ (\S+)$/, (m, u) => ' ' + (SAY_UNIT[u] || u));
  const amtInput = (it) => (it.amount === null || it.amount === undefined ? '' : String(it.amount).replace('.', ',') + (it.amount2 ? '-' + String(it.amount2).replace('.', ',') : ''));
  const fmtMin = (m) => { m = Math.round(+m || 0); if (!m) return ''; const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ' ' + r + ' min' : ''}` : `${r} min`; };
  const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const total = (r) => (+r.prep || 0) + (+r.cook || 0) + (+r.rest || 0);

  // Eine Zeile wie "250 g Mehl, gesiebt" zerlegen; "Für den Teig:" wird zum Abschnitt
  const parseLine = (line) => {
    let s = String(line || '').trim().replace(/^[-•*·]\s*/, '');
    if (!s) return null;
    if (/:$/.test(s)) return { group: s.slice(0, -1).trim() };
    let amount = null, amount2 = null, rest = s;
    const m = s.match(/^((?:\d+(?:[.,/]\d+)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])(?:\s*[-–]\s*\d+(?:[.,/]\d+)?)?)\s*(.*)$/);
    if (m) { const p = parseAmt(m[1]); if (p.a !== null) { amount = p.a; amount2 = p.a2; rest = m[2]; } }
    let unit = '';
    const low = rest.toLowerCase();
    const u = UNITS.find((x) => low.startsWith(x.toLowerCase() + ' ') || low === x.toLowerCase());
    if (u) { unit = u; rest = rest.slice(u.length).trim(); }
    // "Zwiebel(n)", "Ei(er)" -> "Zwiebel", "Ei"
    rest = rest.replace(/([a-zäöüß])\((?:e?n|er|e|s|nen)\)/gi, '$1');
    let name = rest, note = '';
    const pm = rest.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (pm) { name = pm[1]; note = pm[2]; } else { const c = rest.indexOf(','); if (c > 0) { name = rest.slice(0, c).trim(); note = rest.slice(c + 1).trim(); } }
    return { amount, amount2, unit, name: name.trim(), note: note.trim() };
  };
  // Schritt aus Text: Zeiten wie "20 Minuten" werden Timer, "180 °C" Temperatur
  const stepFrom = (t) => {
    const s = { text: t };
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|bis)?\s*(?:\d+\s*)?(min\b|minuten|std\.?|stunden?)/i);
    if (m) s.timer = num(m[1]) * (/^s/i.test(m[2]) ? 60 : 1);
    const tc = t.match(/(\d{2,3})\s*(?:°\s*c?|grad)/i);
    if (tc) s.temp = tc[1];
    return s;
  };

  // ---------- Rezept von einer Internetseite (schema.org Recipe) ----------
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const first = (v) => list(v)[0];
  const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'Quelle'; } };
  const cssUrl = (u) => String(u).replace(/['"()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  // HTML-Schnipsel -> Text; Absätze bleiben als Leerzeile erhalten
  const htmlText = (s) => {
    if (s == null) return '';
    const d = new DOMParser().parseFromString('<body>' + String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n\n'), 'text/html');
    return d.body.textContent.replace(/\u00ad/g, '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  // "PT1H30M" -> 90
  const isoMin = (s) => {
    const m = String(s || '').trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
    if (!m) return null;
    const v = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
    return v ? Math.round(v) : null;
  };
  const ldRecipe = (doc) => {
    const isR = (n) => list(n['@type']).some((t) => /recipe$/i.test(String(t)));
    const walk = (n, d) => {
      if (!n || typeof n !== 'object' || d > 6) return null;
      if (Array.isArray(n)) { for (const x of n) { const r = walk(x, d + 1); if (r) return r; } return null; }
      if (isR(n)) return n;
      for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const r = walk(n[k], d + 1); if (r) return r; }
      return null;
    };
    for (const s of doc.querySelectorAll('script[type*="ld+json"]')) {
      let j;
      try { j = JSON.parse(s.textContent.replace(/^\s*<!--|-->\s*$/g, '').replace(/[\u0000-\u001f]+/g, ' ')); } catch (e) { continue; }
      const r = walk(j, 0);
      if (r) return r;
    }
    return null;
  };
  // Ältere Seiten: Mikrodaten (itemprop) statt JSON-LD
  const mdRecipe = (doc) => {
    const root = doc.querySelector('[itemtype*="schema.org/Recipe" i]');
    if (!root) return null;
    const val = (el) => el.getAttribute('content') || el.getAttribute('datetime') || el.getAttribute('src') || el.getAttribute('href') || el.innerHTML;
    const all = (p) => [...root.querySelectorAll(`[itemprop~="${p}"]`)].map(val);
    const one = (p) => all(p)[0];
    return { name: one('name'), description: one('description'), image: one('image'), recipeYield: one('recipeYield'), prepTime: one('prepTime'), cookTime: one('cookTime'),
      totalTime: one('totalTime'), recipeCategory: one('recipeCategory'), keywords: one('keywords'), recipeIngredient: all('recipeIngredient').concat(all('ingredients')), recipeInstructions: all('recipeInstructions') };
  };
  // recipeInstructions: Text, Liste, HowToStep oder HowToSection (Abschnittsname wird erste Zeile)
  const ldSteps = (ins) => {
    const out = [];
    const add = (t, head) => { if (t) out.push(stepFrom(head ? head + '\n' + t : t)); };
    const walk = (n, head) => {
      if (n == null) return;
      if (typeof n === 'string') {
        const t = htmlText(n);
        const parts = (/\n\n/.test(t) ? t.split(/\n\n/) : t.split(/\n/)).map((x) => x.replace(/\n/g, ' ').replace(/^\s*(\d+[.)]|schritt\s*\d+:?)\s*/i, '').trim()).filter(Boolean);
        parts.forEach((p, i) => add(p, i ? '' : head));
        return;
      }
      if (Array.isArray(n)) { n.forEach((x, i) => walk(x, i ? '' : head)); return; }
      if (typeof n !== 'object') return;
      if (list(n['@type']).some((t) => /HowToSection/i.test(String(t)))) { walk(n.itemListElement || n.steps, htmlText(n.name).replace(/^(zubereitung|anleitung|instructions?)$/i, '')); return; }
      if (n.itemListElement) { walk(n.itemListElement, head); return; }
      add(htmlText(n.text || n.description || n.name).replace(/\n+/g, ' '), head);
    };
    walk(ins, '');
    return out;
  };
  const parsePage = (html, url, base) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const n = ldRecipe(doc) || mdRecipe(doc);
    const meta = (p) => { const el = doc.querySelector(`meta[property="${p}"],meta[name="${p}"]`); return el ? el.getAttribute('content') || '' : ''; };
    const abs = (u) => { try { return new URL(u, url).href; } catch (e) { return ''; } };
    const r = base;
    const s = n || {};
    r.title = htmlText(first(s.name) || meta('og:title') || (doc.querySelector('title') || {}).textContent).replace(/\s+/g, ' ').replace(/\s*[-–|:]?\s*rezept$/i, '').slice(0, 140);
    r.desc = htmlText(first(s.description) || meta('og:description') || meta('description')).replace(/\s+/g, ' ').slice(0, 400);
    const y = list(s.recipeYield).map(String).join(' ').match(/\d+/);
    if (y) r.portions = Math.min(99, Math.max(1, +y[0]));
    r.prep = isoMin(first(s.prepTime));
    r.cook = isoMin(first(s.cookTime));
    const tot = isoMin(first(s.totalTime)), sum = (r.prep || 0) + (r.cook || 0);
    if (tot && tot > sum) { if (sum) r.rest = tot - sum; else r.cook = tot; }
    const cats = list(s.recipeCategory).map((c) => htmlText(c)).filter(Boolean);
    const known = (c) => CATS.find((k) => k.toLowerCase() === c.toLowerCase() || k.toLowerCase().split(/\s*&\s*/).includes(c.toLowerCase()));
    r.cat = cats.map(known).find(Boolean) || cats[0] || '';
    r.tags = [...new Set(list(s.keywords).flatMap((k) => String(k).split(',')).map((k) => htmlText(k).toLowerCase()).filter((k) => k && k.length < 30 && k !== r.cat.toLowerCase()))].slice(0, 8);
    const ings = list(s.recipeIngredient).length ? list(s.recipeIngredient) : list(s.ingredients);
    const rows = ings.flatMap((x) => htmlText(x).split('\n')).map(parseLine).filter(Boolean);
    if (rows.length) r.ingredients = rows;
    const steps = ldSteps(s.recipeInstructions);
    if (steps.length) r.steps = steps;
    r.source = url;
    // Verweise wie "…#primaryimage" sind keine Bildadressen: dann das Vorschaubild der Seite
    const img = list(s.image).map((x) => (typeof x === 'string' ? x : x && (x.url || x.contentUrl || x['@id']))).find((u) => u && !/#/.test(u)) || meta('og:image');
    return { r, img: img ? abs(img) : '', found: !!n };
  };

  // ---------- Einkaufen: Vorrat und Packungsgrößen ----------
  // Grundliste für "hab ich meistens im Haus"; im Kochbuch per Stern änderbar (kb.pantry)
  const PANTRY = ['Salz', 'Pfeffer', 'Zucker', 'Öl', 'Olivenöl', 'Mehl', 'Essig'];
  const NEVER = ['wasser', 'leitungswasser', 'eiswasser'];
  // Kleinstmengen kommen fast immer aus dem Vorrat
  const TINY = ['prise', 'prisen', 'msp.', 'spritzer', 'schuss', 'tropfen', 'el', 'tl'];
  const words = (s) => String(s || '').toLowerCase().split(/[\s,/()-]+/).filter(Boolean);
  const matchName = (name, q) => { q = String(q || '').toLowerCase().trim(); const n = String(name || '').toLowerCase().trim(); return !!q && (n === q || words(n).includes(q)); };
  const inList = (name, list) => list.some((p) => matchName(name, p));
  // Übliche Packungen: Stichwort, Größe in g bzw. ml, Bezeichnung
  const PACKS = [['butter', 250, 'Stück'], ['schlagsahne', 200, 'Becher'], ['saure sahne', 200, 'Becher'], ['sahne', 200, 'Becher'], ['schmand', 200, 'Becher'], ['crème fraîche', 200, 'Becher'],
    ['creme fraiche', 200, 'Becher'], ['joghurt', 500, 'Becher'], ['quark', 500, 'Packung'], ['mascarpone', 250, 'Packung'], ['frischkäse', 200, 'Packung'], ['mozzarella', 125, 'Packung'],
    ['feta', 200, 'Packung'], ['milch', 1000, 'Liter'], ['kokosmilch', 400, 'Dose'], ['hackfleisch', 500, 'Packung'], ['hack', 500, 'Packung'], ['speckwürfel', 125, 'Packung'],
    ['spaghetti', 500, 'Packung'], ['nudeln', 500, 'Packung'], ['penne', 500, 'Packung'], ['lasagneplatten', 250, 'Packung'], ['reis', 1000, 'Packung'], ['mehl', 1000, 'Packung'],
    ['zucker', 1000, 'Packung'], ['passierte tomaten', 500, 'Packung'], ['stückige tomaten', 400, 'Dose'], ['gehackte tomaten', 400, 'Dose']].sort((a, b) => b[0].length - a[0].length);
  const BASE = { g: 1, kg: 1000, ml: 1, l: 1000, cl: 10, dl: 100 };
  const COUNT = { Dose: 'Dose', Dosen: 'Dose', Becher: 'Becher', 'Pck.': 'Packung', 'Päckchen': 'Packung', Glas: 'Glas', 'Gläser': 'Glas', Bund: 'Bund', Beutel: 'Beutel', 'Tüte': 'Tüte', Stange: 'Stange', Stangen: 'Stange', Kopf: 'Kopf', 'Stück': 'Stück', 'Stk.': 'Stück' };
  const PLURAL = { Packung: 'Packungen', Dose: 'Dosen', Glas: 'Gläser', 'Tüte': 'Tüten', Stange: 'Stangen', Kopf: 'Köpfe' };
  const pl = (k, w) => `${k} ${k === 1 ? w : PLURAL[w] || w}`;
  const hasWord = (n, kw) => new RegExp('(^|[^a-zäöüß])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-zäöüß])').test(n);
  // Was man im Laden kauft: "150 ml Sahne" -> "1 Becher", "4 Eier" -> "6er-Packung", sonst Rezeptmenge oder nur der Name
  const buyText = (it, f) => {
    const a = it.amount == null || it.amount === '' ? null : (+(it.amount2 || it.amount)) * f;
    const n = String(it.name || '').toLowerCase(), u = it.unit || '', w = words(n);
    if (a && (!u || COUNT[u] === 'Stück') && w.some((x) => ['ei', 'eier', 'eigelb', 'eiweiß'].includes(x))) { const k = Math.ceil(a); return k <= 6 ? '6er-Packung' : k <= 10 ? '10er-Packung' : `${Math.ceil(k / 10)} × 10er-Packung`; }
    if (/^zehe/i.test(u)) return '1 Knolle';
    if (/^(zweig|blatt|blätter)/i.test(u)) return '1 Bund';
    if (!a) return '';
    if (BASE[u]) {
      const p = PACKS.find(([kw]) => hasWord(n, kw));
      return p ? pl(Math.ceil((a * BASE[u]) / p[1]), p[2]) : fmtAmt(it, f);
    }
    if (COUNT[u]) return pl(Math.ceil(a), COUNT[u]);
    if (!u) return `${Math.ceil(a)} Stück`;
    return '';
  };

  // Für den Einkauf zusammenfassen: gleiche Zutat mit gleicher Einheit addieren,
  // Eier + Eigelb/Eiweiß zu einer Zeile (getrennte Eier nicht doppelt zählen)
  const shopItems = (ings) => {
    const out = [];
    ings.filter((it) => !it.group && it.name && !inList(it.name, NEVER)).forEach((it) => {
      const m = out.find((y) => y.name.toLowerCase().trim() === it.name.toLowerCase().trim() && (y.unit || '') === (it.unit || ''));
      if (!m) out.push(Object.assign({}, it));
      else if (m.amount != null && it.amount != null) { m.amount = +m.amount + +it.amount; m.amount2 = null; }
    });
    const egg = (it, kinds) => (!it.unit || COUNT[it.unit] === 'Stück') && it.amount != null && words(it.name).some((x) => kinds.includes(x));
    const whole = out.filter((it) => egg(it, ['ei', 'eier'])), part = out.filter((it) => egg(it, ['eigelb', 'eiweiß']));
    if (whole.length + part.length > 1) {
      const n = whole.reduce((s, it) => s + +it.amount, 0) + Math.max(0, ...part.map((it) => +it.amount));
      const at = out.indexOf(whole[0] || part[0]);
      const keep = out.filter((it) => !whole.includes(it) && !part.includes(it));
      keep.splice(Math.min(at, keep.length), 0, { amount: n, amount2: null, unit: '', name: 'Eier', note: '' });
      return keep;
    }
    return out;
  };

  // Zutaten eines Schritts: festgelegt (step.ing) oder automatisch über den Namen im Text
  const stepIngs = (r, st) => {
    if (Array.isArray(st.ing)) return st.ing.filter((i) => r.ingredients[i] && !r.ingredients[i].group);
    const t = ' ' + String(st.text || '').toLowerCase() + ' ';
    const out = [];
    r.ingredients.forEach((it, i) => {
      if (it.group || !it.name) return;
      const words = it.name.toLowerCase().split(/[\s,/-]+/).filter((w) => w.length >= 4);
      const stem = (w) => w.replace(/(en|n|e|s)$/, '');
      if (words.some((w) => t.includes(stem(w)))) out.push(i);
    });
    return out;
  };

  const norm = (kb) => {
    const d = kb && typeof kb === 'object' ? kb : {};
    const out = { v: 1, recipes: Array.isArray(d.recipes) ? d.recipes : [] };
    if (Array.isArray(d.pantry)) out.pantry = d.pantry;
    return out;
  };
  const blank = () => ({ id: uid(), title: '', desc: '', cat: '', tags: [], portions: 4, prep: null, cook: null, rest: null, diff: 1, fav: false, image: null,
    ingredients: [{ amount: null, amount2: null, unit: '', name: '', note: '' }], steps: [{ text: '' }], notes: '', created: Date.now(), cooked: 0, last: null });

  // Platzhalter ohne Foto: warmer Verlauf je Rezept
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const phStyle = (r) => { const h = (hue(r.title || r.id) % 30) + 205; return `background:linear-gradient(135deg,hsl(${h} 70% 52%),hsl(${h + 12} 65% 28%))`; };

  const fontLink = () => {
    if (document.getElementById('kochbuch-fonts')) return;
    const l = document.createElement('link');
    l.id = 'kochbuch-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  };

  const CSS = `
:host{display:block;--bg:#f3f6fb;--bg2:#eef3f9;--card:#ffffff;--card2:#eaf0f8;--line:#dbe4ef;--txt:#0f1e3d;--mut:#5a6a82;--acc:#1d4ed8;--acc2:#1e3a8a;--ok:#0e8a5f;--bad:#dc2626;--pri:linear-gradient(135deg,#2563eb,#1e3a8a);--sh:0 1px 2px rgba(15,30,61,.06),0 10px 28px -14px rgba(15,30,61,.22);--serif:'Playfair Display',Georgia,serif;--sans:Inter,var(--ha-font-family-body,system-ui),sans-serif}
*{box-sizing:border-box}
ha-card{background:var(--bg);border-radius:26px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--sh);color:var(--txt);font-family:var(--sans);-webkit-font-smoothing:antialiased}
.app{position:relative;height:720px;display:flex;flex-direction:column;background:radial-gradient(90% 60% at 10% 0%,rgba(37,99,235,.09),transparent 60%),radial-gradient(70% 60% at 100% 100%,rgba(30,58,138,.06),transparent 60%),var(--bg)}
.main{flex:1;min-height:0;display:flex;flex-direction:column}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:focus-visible,.in:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}
ha-icon{--mdc-icon-size:20px;display:inline-flex}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:999px;background:var(--card2);border:1px solid var(--line);font-weight:600;font-size:.92rem;white-space:nowrap;transition:transform .15s,background .2s}
.btn:active{transform:scale(.97)}
.btn.pri{background:var(--pri);color:#fff;border-color:transparent;box-shadow:0 8px 22px -10px rgba(37,99,235,.65)}
.btn.ghost{background:transparent}
.btn.danger{color:var(--bad)}
.btn.sm{padding:8px 13px;font-size:.82rem}
.ib{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--line);box-shadow:var(--sh);flex:none}
.hero .ib{background:rgba(10,22,48,.42);border-color:rgba(255,255,255,.22);color:#fff;box-shadow:none;backdrop-filter:blur(8px)}
.scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.scroll::-webkit-scrollbar{width:8px}.scroll::-webkit-scrollbar-thumb{background:rgba(15,30,61,.16);border-radius:8px}
h1,h2,h3,h4{margin:0;font-family:var(--serif);font-weight:650;letter-spacing:-.01em}
.mut{color:var(--mut)}

/* Start */
.top{display:flex;align-items:center;gap:18px;padding:24px 28px 14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:14px;margin-right:auto}
.logo{width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--pri);color:#fff;--mdc-icon-size:28px;box-shadow:0 8px 20px -10px rgba(37,99,235,.7)}
.brand h1{font-size:1.9rem;line-height:1}
.brand .sub{font-size:.82rem;color:var(--mut);margin-top:5px}
.search{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);box-shadow:var(--sh);border-radius:999px;padding:0 16px;height:46px;min-width:min(340px,100%);color:var(--mut)}
.search input{flex:1;background:none;border:0;outline:0;color:var(--txt);font:inherit;font-size:.95rem;min-width:0}
.chips{display:flex;gap:8px;padding:2px 28px 16px;overflow-x:auto;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{padding:8px 15px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:.85rem;font-weight:600;color:var(--mut);white-space:nowrap;display:inline-flex;align-items:center;gap:6px;--mdc-icon-size:16px}
.chip.on{background:var(--acc2);color:#fff;border-color:var(--acc2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px;padding:4px 28px 28px}
.rc{position:relative;border-radius:22px;overflow:hidden;background:var(--card);border:1px solid var(--line);box-shadow:var(--sh);cursor:pointer;transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column}
.rc:active{transform:scale(.985)}
.rc .ph{aspect-ratio:4/3;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:3.2rem;color:rgba(255,255,255,.92)}
.rc .info{padding:13px 16px 15px}
.rc h3{font-size:1.12rem;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cat{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);font-weight:700;margin-bottom:5px}
.meta{display:flex;gap:12px;margin-top:9px;font-size:.78rem;color:var(--mut);align-items:center;--mdc-icon-size:15px;flex-wrap:wrap}
.meta span{display:inline-flex;align-items:center;gap:4px}
.dots{letter-spacing:1px;color:var(--acc)}
.dots i{font-style:normal;color:rgba(15,30,61,.14)}
.fav{position:absolute;top:8px;right:8px;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(10,22,48,.42);backdrop-filter:blur(6px);color:#fff;--mdc-icon-size:19px}
.fav.on{color:#ff8a8a}
.empty{grid-column:1/-1;text-align:center;padding:70px 20px;color:var(--mut)}
.empty h3{color:var(--txt);font-size:1.5rem;margin-bottom:8px}
.empty .btn{margin-top:18px}
.tbar{display:flex;gap:8px;flex-wrap:wrap;padding:0 28px 12px}
.tchip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(37,99,235,.1);color:var(--acc);font-weight:700;font-size:.85rem;font-variant-numeric:tabular-nums;--mdc-icon-size:17px}
.tchip.done{background:var(--bad);color:#fff;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.55}}

/* Rezept */
.rv{display:grid;grid-template-columns:minmax(300px,40%) 1fr;height:100%;min-height:0}
.hero{position:relative;background-size:cover;background-position:center;min-height:0;display:flex;flex-direction:column;justify-content:space-between}
.hero:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,18,40,.35) 0%,transparent 30%,transparent 42%,rgba(8,18,40,.9) 100%);pointer-events:none}
.hero .bar{position:relative;z-index:1;display:flex;gap:10px;padding:18px}
.hero .bar .sp{flex:1}
.hero .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:7rem;color:rgba(255,255,255,.75)}
.hero .cat{color:#a9c8ff}
.htxt h2{color:#fff}
.htxt{position:relative;z-index:1;padding:24px 26px 28px}
.htxt h2{font-size:clamp(1.7rem,2.6vw,2.5rem);line-height:1.1}
.htxt p{margin:10px 0 0;color:rgba(255,255,255,.86);line-height:1.5;font-size:.95rem}
.panel{display:flex;flex-direction:column;min-height:0}
.pin{padding:24px 28px 30px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;box-shadow:var(--sh)}
.stat small{display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);font-weight:700}
.stat b{display:block;font-size:1.05rem;margin-top:4px}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
.acts .btn.pri{padding:14px 26px;font-size:1rem}
.cols{display:grid;grid-template-columns:minmax(260px,.9fr) 1.1fr;gap:26px;align-items:start}
.sh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.sh h4{font-size:1.3rem}
.por{display:inline-flex;align-items:center;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px;font-size:.85rem;font-weight:600}
.por button{width:32px;height:32px;border-radius:50%;background:var(--card2);font-size:1.1rem;line-height:1}
.por b{min-width:62px;text-align:center}
.ings{list-style:none;margin:0;padding:0}
.ings li{display:flex;align-items:baseline;gap:12px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.ings li.grp{cursor:default;border:0;padding:16px 0 4px;font-family:var(--serif);font-size:1.02rem;color:var(--acc)}
.box{width:22px;height:22px;border-radius:7px;border:2px solid #b6c4d8;flex:none;align-self:center;display:flex;align-items:center;justify-content:center;--mdc-icon-size:14px;color:#fff;background:var(--card)}
li.on .box{background:var(--ok);border-color:var(--ok)}
.ings li.on .nm,.ings li.on .amt,.mgrid li.on .nm,.mgrid li.on .amt{opacity:.45;text-decoration:line-through}
.amt{min-width:78px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.nm small{color:var(--mut);font-size:.82rem}
.steps{list-style:none;margin:0;padding:0;counter-reset:s}
.steps li{display:flex;gap:14px;padding:0 0 18px}
.no{flex:none;width:32px;height:32px;border-radius:50%;background:var(--card2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;color:var(--acc)}
.steps p{margin:4px 0 0;line-height:1.6}
.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.tag{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:.75rem;font-weight:600;color:var(--mut);--mdc-icon-size:14px}
.notes{margin-top:8px;padding:16px 18px;border-radius:16px;background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.18);line-height:1.6;white-space:pre-wrap}
.ttl{font-size:1.3rem;margin:26px 0 10px}

/* Editor */
.edtop{display:flex;align-items:center;gap:12px;padding:18px 24px;border-bottom:1px solid var(--line);background:var(--card)}
.edtop h2{font-size:1.4rem;margin-right:auto}
.ed{display:grid;grid-template-columns:minmax(300px,.8fr) 1.2fr;gap:22px;padding:22px 24px 40px;align-items:start}
.sec{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px;margin-bottom:18px;box-shadow:var(--sh)}
.sec h4{font-size:1.15rem;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.sec h4 .btn{margin-left:auto}
.fl{display:block;margin-bottom:12px}
.fl>span{display:block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:700;margin-bottom:6px}
.in{width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;color:var(--txt);font:inherit;font-size:.95rem;outline:0;transition:border-color .2s}
.in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(37,99,235,.14)}
textarea.in{resize:vertical;min-height:84px;line-height:1.5}
select.in{appearance:none}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.imgbox{aspect-ratio:4/3;border-radius:16px;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;border:2px dashed var(--line);color:var(--mut);margin-bottom:12px;position:relative;overflow:hidden}
.imgbox.has{border-style:solid}
.imgbox .busy{position:absolute;inset:0;background:rgba(255,255,255,.8);color:var(--txt);display:flex;align-items:center;justify-content:center;font-weight:600}
.irow{display:grid;grid-template-columns:80px 96px minmax(0,1fr) minmax(0,1fr) auto;gap:8px;margin-bottom:8px;align-items:center}
.irow.g{grid-template-columns:1fr auto}
.irow.g .in{font-family:var(--serif);color:var(--acc)}
.mv{display:flex;gap:2px}
.mv button{width:32px;height:38px;border-radius:9px;color:var(--mut);--mdc-icon-size:18px}
.mv button:active{background:var(--card2)}
.srow{border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:10px;background:var(--bg2)}
.srow .hd{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.srow .hd b{font-family:var(--serif);color:var(--acc)}
.srow .hd .mv{margin-left:auto}
.srow .in{background:var(--card)}
.irow .in,.srow textarea.in{min-height:44px}
.ichips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ic{padding:5px 10px;border-radius:999px;font-size:.75rem;font-weight:600;border:1px solid var(--line);color:var(--mut)}
.ic.on{background:rgba(14,138,95,.1);border-color:rgba(14,138,95,.45);color:var(--ok)}
.ic.auto{border-style:dashed}
.hint{font-size:.78rem;color:var(--mut);margin:-4px 0 10px;line-height:1.45}

/* Kochmodus */
.cook{position:absolute;inset:0;z-index:5;background:radial-gradient(80% 70% at 15% 10%,rgba(37,99,235,.09),transparent 60%),var(--bg);display:flex;flex-direction:column}
.ctop{display:flex;align-items:center;gap:14px;padding:16px 22px}
.ct{margin-right:auto;min-width:0}
.ct small{display:block;color:var(--mut);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ct b{font-family:var(--serif);font-size:1.25rem}
.prog{display:flex;gap:5px;padding:0 22px}
.prog i{flex:1;height:6px;border-radius:6px;background:#dbe4ef}
.prog i.on{background:var(--pri)}
.cbody{flex:1;min-height:0;display:grid;grid-template-columns:1.5fr 1fr;gap:26px;padding:26px 30px 10px;touch-action:pan-y}
.cmain{display:flex;flex-direction:column;justify-content:center;min-height:0;overflow-y:auto}
.cnum{font-family:var(--serif);font-size:1rem;color:var(--acc);letter-spacing:.14em;text-transform:uppercase;font-weight:650;margin-bottom:14px}
.ctext{font-size:clamp(1.5rem,2.6vw,2.4rem);line-height:1.38;font-weight:500;margin:0;letter-spacing:-.01em}
.chint{margin-top:18px;color:var(--mut);font-size:1.05rem;line-height:1.5;display:flex;gap:10px;--mdc-icon-size:22px}
.cside{background:var(--card);border:1px solid var(--line);box-shadow:var(--sh);border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:16px;min-height:0;overflow-y:auto}
.cside h4{font-size:1.05rem;color:var(--mut);font-family:var(--sans);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.75rem}
.need{list-style:none;margin:0;padding:0}
.need li{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line);font-size:1.1rem}
.need li:last-child{border:0}
.need .amt{min-width:92px;color:var(--acc)}
.temp{display:inline-flex;align-items:center;gap:10px;padding:12px 16px;border-radius:16px;background:rgba(220,38,38,.08);color:#b91c1c;font-weight:700;font-size:1.25rem;--mdc-icon-size:24px}
.tring{display:flex;align-items:center;gap:18px;padding:14px;border-radius:20px;background:var(--bg2);border:1px solid var(--line);cursor:pointer}
.tring svg{flex:none}
.tring .tv{font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.tring small{display:block;color:var(--mut);font-size:.8rem;margin-top:5px}
.tring.done{border-color:var(--bad);animation:blink 1s infinite}
.cnav{display:flex;gap:14px;padding:14px 22px 22px}
.cnav .btn{flex:1;justify-content:center;padding:18px;font-size:1.1rem;border-radius:20px}
.cnav .btn.back{flex:.45}
.mise{grid-column:1/-1;display:flex;flex-direction:column;min-height:0}
.mise h2{font-size:clamp(1.8rem,3vw,2.6rem)}
.mise p{color:var(--mut);margin:8px 0 18px}
.mgrid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));column-gap:28px;align-content:start;overflow-y:auto}
.mgrid li{display:flex;gap:14px;align-items:center;padding:12px 6px;border-bottom:1px solid var(--line);font-size:1.15rem;cursor:pointer}
.mgrid li.grp{grid-column:1/-1;font-family:var(--serif);color:var(--acc);border:0;cursor:default;padding-top:14px}
.mgrid .box{width:26px;height:26px;border-radius:9px;--mdc-icon-size:18px}
.cdone{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px}
.cdone .big{width:110px;height:110px;border-radius:50%;background:var(--pri);display:flex;align-items:center;justify-content:center;color:#fff;--mdc-icon-size:56px;box-shadow:0 18px 40px -16px rgba(37,99,235,.7)}
.cdone h2{font-size:clamp(2rem,4vw,3rem)}

/* Fenster */
.modal{position:absolute;inset:0;z-index:20;background:rgba(15,23,42,.45);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:20px}
.modal.show{display:flex}
.dlg{background:var(--card);border:1px solid var(--line);border-radius:24px;width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(15,30,61,.35)}
.dlg h3{font-size:1.4rem;padding:22px 24px 6px}
.dlg .db{padding:8px 24px;overflow-y:auto;min-height:0}
.dlg .df{display:flex;gap:10px;justify-content:flex-end;padding:16px 24px 22px}
.blist{list-style:none;margin:0;padding:0}
.blist li{display:flex;gap:12px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--line);cursor:pointer}
.blist li.has{opacity:.5}
.blist .bnm{flex:1;min-width:0}
.blist .bnm small{display:block;color:var(--mut);font-size:.74rem;margin-top:1px}
.blist .buy{font-weight:700;font-size:.85rem;color:var(--acc);white-space:nowrap}
.blist em{font-style:normal;font-size:.72rem;color:var(--mut);white-space:nowrap}
.blist li.sep{cursor:default;border:0;padding:16px 2px 4px;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:700;gap:6px}
.pst{width:36px;height:36px;margin:-6px -4px -6px 0;border-radius:50%;color:#b6c4d8;--mdc-icon-size:20px;flex:none;display:inline-flex;align-items:center;justify-content:center}
.pst.on{color:#f5a524}
.toast{position:absolute;left:50%;bottom:26px;transform:translate(-50%,20px);opacity:0;z-index:30;background:var(--txt);color:var(--bg);padding:12px 20px;border-radius:999px;font-weight:600;font-size:.9rem;transition:all .3s;pointer-events:none;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast.err{background:var(--bad);color:#fff}
.load{flex:1;display:flex;align-items:center;justify-content:center;color:var(--mut)}
.ib.on{background:var(--pri);color:#fff;border-color:transparent}
.vhint{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;margin:-6px 0 16px;padding:8px 14px;border-radius:999px;background:rgba(37,99,235,.08);color:var(--acc);font-size:.85rem;font-weight:600;--mdc-icon-size:18px}
.qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.qb{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:14px 16px;border-radius:16px;background:var(--bg2);border:1px solid var(--line);text-align:left}
.qb b{font-size:1rem}
.qb small{color:var(--acc);font-weight:700;font-variant-numeric:tabular-nums}
.qb:active,.mb:active{transform:scale(.97)}
.mgr{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.mb{min-width:58px;padding:11px 14px;border-radius:14px;background:var(--bg2);border:1px solid var(--line);font-weight:700;font-variant-numeric:tabular-nums}
.tcust{display:grid;grid-template-columns:110px 1fr auto;gap:8px;align-items:center}
.lab{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:700;margin:4px 0 8px}
.tctl{text-align:center;padding:8px 0 4px}
.tctl .tv{font-size:3.4rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.tctl p{margin:8px 0 0;color:var(--mut)}
a.tag{text-decoration:none;color:var(--acc)}
.werr{margin:10px 0 0;color:var(--bad);font-weight:600;font-size:.88rem;line-height:1.45}
.dlg code{font-size:.8rem;background:var(--bg2);padding:1px 6px;border-radius:6px}
.spin ha-icon{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Handy und schmale Bildschirme */
.narrow .top{padding:18px 16px 10px;gap:12px}
.narrow .brand h1{font-size:1.5rem}
.narrow .logo{width:44px;height:44px}
.narrow .search{order:3;flex:1 1 100%}
.narrow .top .btn span{display:none}
.narrow .top{gap:8px}
.narrow .brand{flex:1 1 auto;min-width:0;gap:10px}
.narrow .brand>div:last-child{min-width:0}
.narrow .brand .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.narrow .top .btn{width:44px;height:44px;padding:0;justify-content:center;flex:none}
.narrow .chips{padding:2px 16px 12px}
.narrow .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:4px 16px 20px}
.narrow .rc h3{font-size:.98rem}
.narrow .tbar{padding:0 16px 10px}
.narrow .rv{display:block;overflow-y:auto;height:100%}
.narrow .hero{height:300px}
.narrow .panel{display:block}
.narrow .pin{padding:18px 16px 26px}
.narrow .stats{grid-template-columns:repeat(2,1fr)}
.narrow .cols{grid-template-columns:1fr}
.narrow .ed{grid-template-columns:1fr;padding:16px 14px 30px;gap:0}
.narrow .edtop{padding:14px 16px}
.narrow .irow{grid-template-columns:64px 80px minmax(0,1fr) auto}
.narrow .irow .note{grid-column:1/4}
.narrow .cbody{grid-template-columns:minmax(0,1fr);padding:18px 18px 8px;overflow-y:auto}
.narrow .cmain{justify-content:flex-start}
.narrow .cside{overflow:visible}
.narrow .ctop .tnew span{display:none}
.narrow .tcust{grid-template-columns:90px 1fr}
.narrow .tcust .btn{grid-column:1/-1;justify-content:center}
`;

  class KochbuchCard extends HTMLElement {
    setConfig(c) {
      this._c = Object.assign({ title: 'Kochbuch', store: 'kochbuch-daten', shopping_list: '', announce: '', speak: '' }, c || {});
      this._c.voice = Object.assign({ next: 'input_boolean.kochbuch_weiter', back: 'input_boolean.kochbuch_zuruck', read: 'input_boolean.kochbuch_vorlesen' }, (c && c.voice) || {});
    }
    getCardSize() { return 12; }
    getGridOptions() { return { columns: 'full' }; }

    set hass(h) {
      const first = !this._hass;
      this._hass = h;
      if (first) this._init();
      this._voice();
    }

    // ---------- Sprachsteuerung ----------
    // Alexa-Routinen schalten Schalter (input_boolean) ein oder drücken Knöpfe (input_button);
    // die Karte reagiert darauf und schaltet Schalter gleich wieder aus
    _voice() {
      const h = this._hass, v = this._c.voice || {};
      this._vs = this._vs || {};
      this._voff = this._voff || {};
      Object.keys(v).forEach((cmd) => {
        const st = v[cmd] && h.states[v[cmd]];
        if (!st) return;
        const prev = this._vs[cmd];
        this._vs[cmd] = st.state;
        if (v[cmd].startsWith('input_boolean.')) {
          if (st.state !== 'on') return;
          if (prev !== undefined && prev !== 'on' && this._loaded && this.isConnected) this._voiceCmd(cmd);
          if (Date.now() - (this._voff[cmd] || 0) > 2000) { this._voff[cmd] = Date.now(); h.callService('input_boolean', 'turn_off', { entity_id: v[cmd] }).catch(() => {}); }
          return;
        }
        if (prev === undefined || prev === st.state || !this._loaded || !this.isConnected) return;
        const t = Date.parse(st.state);
        if (!isNaN(t) && Math.abs(Date.now() - t) > 120000) return;
        this._voiceCmd(cmd);
      });
    }
    _hasVoice() { const v = this._c.voice || {}; return !!(this._hass && v.next && this._hass.states[v.next]); }
    _voiceCmd(cmd) {
      if (this._view === 'cook') {
        if (cmd === 'next') this._cookGo(1, true);
        else if (cmd === 'back') this._cookGo(-1, true);
        else this._speakStep();
      } else if (this._view === 'recipe') {
        if (cmd === 'next') { this._cookStart(); this._speakStep(); } else if (cmd === 'read') this._speakStep(true);
      }
    }
    _speak(text) {
      const svc = String(this._c.speak || this._c.announce || '');
      if (!svc.includes('.')) { this._toast('Kein Lautsprecher für das Vorlesen eingestellt', true); return; }
      const [dom, name] = svc.split('.');
      this._hass.callService(dom, name, { message: text, data: { type: 'tts' } }).catch((e) => this._toast('Vorlesen fehlgeschlagen: ' + (e.message || e), true));
    }
    // Text für den aktuellen Schritt (oder die Zutatenliste vor dem Start)
    _stepSpeech(all) {
      const r = this._rec();
      if (!r) return '';
      const steps = r.steps.filter((s) => s.text), n = steps.length, f = this._por / (+r.portions || 1);
      const list = (idx) => idx.map((i) => { const it = r.ingredients[i], a = sayAmt(it, f); return (a ? a + ' ' : '') + it.name; }).join(', ');
      const k = all || this._view !== 'cook' ? 0 : this._ck;
      if (k === 0) {
        const idx = r.ingredients.map((it, i) => i).filter((i) => !r.ingredients[i].group && r.ingredients[i].name);
        return `${r.title}, für ${this._por} ${this._por === 1 ? 'Portion' : 'Portionen'}. Du brauchst: ${list(idx)}.`;
      }
      if (k > n) return `Fertig. Guten Appetit!`;
      const s = steps[k - 1], need = stepIngs(r, s);
      let t = `Schritt ${k} von ${n}. ${s.text}`;
      if (!/[.!?]$/.test(t)) t += '.';
      if (need.length) t += ` Du brauchst ${list(need)}.`;
      if (s.temp) t += ` Temperatur ${s.temp}${/^\d+$/.test(String(s.temp)) ? ' Grad' : ''}.`;
      if (+s.timer) t += ` Timer: ${fmtMin(s.timer).replace('min', 'Minuten').replace(' h', ' Stunden')}.`;
      if (s.hint) t += ` Tipp: ${s.hint}`;
      return t;
    }
    _speakStep(all) { const t = this._stepSpeech(all); if (t) this._speak(t); }

    _init() {
      fontLink();
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card><div class="app"><div class="main"><div class="load">Lade Rezepte …</div></div><div class="modal"></div><div class="toast"></div></div></ha-card>`;
      this._data = { v: 1, recipes: [] };
      this._view = 'home';
      this._q = '';
      this._cat = lsGet('kochbuch:cat') || 'all';
      this._timers = [];
      this._checked = new Set();
      this._autoRead = !!lsGet('kochbuch:autoread');
      const root = this.shadowRoot;
      root.addEventListener('click', (e) => this._click(e));
      root.addEventListener('input', (e) => this._input(e));
      root.addEventListener('change', (e) => this._change(e));
      root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('weburl')) this._webImport(); });
      root.addEventListener('pointerdown', (e) => { const b = e.target.closest('.cbody'); if (b) this._sx = { x: e.clientX, y: e.clientY, t: Date.now() }; });
      root.addEventListener('pointerup', (e) => {
        const s = this._sx; this._sx = null;
        if (!s || this._view !== 'cook' || Date.now() - s.t > 700) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) this._cookGo(dx < 0 ? 1 : -1);
      });
      this._onKey = (e) => {
        if (this._view !== 'cook' || /input|textarea/i.test((e.composedPath()[0] || {}).tagName || '')) return;
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this._cookGo(1); }
        if (e.key === 'ArrowLeft') this._cookGo(-1);
      };
      this._onResize = () => this._fit();
      window.addEventListener('resize', this._onResize);
      window.addEventListener('keydown', this._onKey);
      this._load();
    }
    connectedCallback() {
      if (this._onResize) { window.addEventListener('resize', this._onResize); window.addEventListener('keydown', this._onKey); }
      setTimeout(() => this._fit(), 50);
    }
    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('keydown', this._onKey);
      this._wake(false);
    }
    _$(s) { return this.shadowRoot.querySelector(s); }

    // Karte auf die sichtbare Höhe bringen, Listen scrollen innen
    _fit() {
      const app = this._$('.app');
      if (!app) return;
      const top = Math.max(0, this.getBoundingClientRect().top);
      app.style.height = Math.max(520, window.innerHeight - top - 8) + 'px';
      app.classList.toggle('narrow', this.getBoundingClientRect().width < 760);
    }

    // ---------- Daten ----------
    async _fetchCfg() {
      try { return await this._hass.callWS({ type: 'lovelace/config', url_path: this._c.store, force: true }); } catch (e) {
        if (e && e.code === 'config_not_found') return null;
        throw e;
      }
    }
    async _load() {
      try {
        const cfg = await this._fetchCfg();
        this._data = norm(cfg && cfg.kochbuch);
        this._err = null;
      } catch (e) {
        this._err = (e && (e.message || e.code)) || String(e);
      }
      this._loaded = true;
      this._render();
    }
    // Lesen, ändern, speichern: immer auf dem neuesten Stand aufsetzen (mehrere Geräte)
    async _mutate(fn, okMsg) {
      try {
        let cfg = await this._fetchCfg();
        if (!cfg || !Array.isArray(cfg.views)) cfg = Object.assign({ views: [{ title: 'Daten', path: 'daten', cards: [{ type: 'markdown', content: '## Kochbuch\nHier speichert die Kochbuch-Karte die Rezepte. Bitte nicht bearbeiten.' }] }] }, cfg || {});
        const kb = norm(cfg.kochbuch);
        fn(kb);
        cfg.kochbuch = kb;
        await this._hass.callWS({ type: 'lovelace/config/save', url_path: this._c.store, config: cfg });
        this._data = kb;
        if (okMsg) this._toast(okMsg);
        return true;
      } catch (e) {
        const m = (e && (e.message || e.code)) || String(e);
        this._toast(/unauthori/i.test(m) ? 'Speichern geht nur mit einem Administrator-Konto' : 'Speichern fehlgeschlagen: ' + m, true);
        return false;
      }
    }
    _rec(id) { return this._data.recipes.find((r) => r.id === (id || this._cur)); }

    // Bild verkleinern (max. 1600 px) und in den Bilderspeicher von Home Assistant laden
    async _upload(file) {
      let blob = file;
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86)) || file;
      } catch (e) { /* Browser kann das Format nicht verkleinern: Original hochladen */ }
      const fd = new FormData();
      fd.append('file', blob, 'rezept.jpg');
      const r = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(r.status === 401 ? 'keine Berechtigung' : 'HTTP ' + r.status);
      const j = await r.json();
      return j.id;
    }
    // Bild aus dem Bilderspeicher oder (eingelesen, nicht ladbar) direkt von der Quellseite
    _img(r, big) {
      if (r && r.image && r.image.url) return isWeb(r.image.url) ? cssUrl(r.image.url) : '';
      return r && r.image && r.image.id ? `/api/image/serve/${encodeURIComponent(r.image.id)}/${big ? 'original' : '512x512'}` : '';
    }
    // Bild einer fremden Seite in den Bilderspeicher übernehmen (klappt nur, wenn die Seite es erlaubt)
    async _uploadUrl(src) {
      const r = await fetch(src, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob();
      if (!/^image\//.test(b.type)) throw new Error('kein Bild');
      return this._upload(b);
    }
    // Seite holen: über Home Assistant (rest_command.kochbuch_abruf), sonst über den öffentlichen Abrufdienst
    _viaHa() { const s = this._hass.services.rest_command; return !!(s && s.kochbuch_abruf); }
    async _fetchPage(url) {
      if (this._viaHa()) {
        const res = await this._hass.callWS({ type: 'call_service', domain: 'rest_command', service: 'kochbuch_abruf', service_data: { url }, return_response: true });
        const r = res && res.response;
        if (!r || r.status >= 400) throw new Error('Die Seite antwortet mit Fehler ' + (r ? r.status : '?'));
        return typeof r.content === 'string' ? r.content : '';
      }
      for (const p of PROXIES) {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 15000);
        try {
          const r = await fetch(p + encodeURIComponent(url), { credentials: 'omit', signal: ac.signal });
          if (r.ok) return await r.text();
        } catch (e) { /* nächster Dienst */ } finally { clearTimeout(to); }
      }
      throw new Error('Die Seite konnte nicht abgerufen werden: Die öffentlichen Abrufdienste sind gerade nicht erreichbar. Zuverlässig klappt es mit rest_command.kochbuch_abruf in Home Assistant.');
    }
    _delImg(id) { if (id) this._hass.callWS({ type: 'image/delete', image_id: id }).catch(() => {}); }

    // ---------- Darstellung ----------
    _render() {
      const main = this._$('.main');
      if (!main) return;
      if (!this._loaded) return;
      if ((this._view === 'recipe' || this._view === 'cook') && !this._rec()) this._view = 'home';
      main.innerHTML = this._view === 'recipe' || this._view === 'cook' ? this._vRecipe() : this._view === 'edit' ? this._vEdit() : this._vHome();
      const cook = this.shadowRoot.querySelector('.cook');
      if (cook) cook.remove();
      if (this._view === 'cook') this._$('.app').insertAdjacentHTML('beforeend', this._vCook());
      this._fit();
      this._tickUi();
    }

    _vHome() {
      const all = this._data.recipes;
      const cats = [...new Set(all.map((r) => r.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      if (this._cat !== 'all' && this._cat !== 'fav' && this._cat !== 'last' && !cats.includes(this._cat)) this._cat = 'all';
      const favs = all.filter((r) => r.fav).length;
      const chip = (k, t, ic) => `<button class="chip${this._cat === k ? ' on' : ''}" data-act="cat" data-k="${esc(k)}">${ic ? `<ha-icon icon="${ic}"></ha-icon>` : ''}${esc(t)}</button>`;
      const err = this._err ? `<div class="empty"><h3>Rezepte konnten nicht geladen werden</h3>${esc(this._err)}<br>Dashboard „${esc(this._c.store)}“ prüfen.</div>` : '';
      return `<header class="top">
          <div class="brand"><div class="logo"><ha-icon icon="mdi:chef-hat"></ha-icon></div><div><h1>${esc(this._c.title)}</h1><div class="sub">${all.length} ${all.length === 1 ? 'Rezept' : 'Rezepte'}${favs ? ` · ${favs} Favoriten` : ''}</div></div></div>
          <label class="search"><ha-icon icon="mdi:magnify"></ha-icon><input data-f="q" placeholder="Rezept oder Zutat suchen" value="${esc(this._q)}"></label>
          <button class="ib" data-act="tnew" aria-label="Timer stellen" style="background:var(--card)"><ha-icon icon="mdi:timer-plus-outline"></ha-icon></button>
          <button class="btn" data-act="web" aria-label="Rezept aus dem Internet"><ha-icon icon="mdi:web"></ha-icon><span>Aus dem Internet</span></button>
          <button class="btn pri" data-act="new"><ha-icon icon="mdi:plus"></ha-icon><span>Neues Rezept</span></button>
        </header>
        <div class="chips">${chip('all', 'Alle')}${chip('fav', 'Favoriten', 'mdi:heart')}${chip('last', 'Zuletzt gekocht', 'mdi:history')}${cats.map((c) => chip(c, c)).join('')}</div>
        ${this._timerBar()}
        <div class="scroll"><div class="grid">${err || this._gridHtml()}</div></div>`;
    }
    _filtered() {
      const q = this._q.trim().toLowerCase();
      let list = this._data.recipes.slice();
      if (this._cat === 'fav') list = list.filter((r) => r.fav);
      else if (this._cat === 'last') list = list.filter((r) => r.last).sort((a, b) => b.last - a.last);
      else if (this._cat !== 'all') list = list.filter((r) => r.cat === this._cat);
      if (q) list = list.filter((r) => [r.title, r.desc, r.cat, (r.tags || []).join(' '), r.ingredients.map((i) => i.name || i.group).join(' ')].join(' ').toLowerCase().includes(q));
      if (this._cat !== 'last') list.sort((a, b) => (!!b.fav - !!a.fav) || String(a.title).localeCompare(String(b.title), 'de'));
      return list;
    }
    _gridHtml() {
      const list = this._filtered();
      if (!this._data.recipes.length) return `<div class="empty"><h3>Dein Kochbuch ist noch leer</h3>Schreib dein erstes Rezept – mit Foto, Zutaten und Schritten für den Kochmodus.<br><button class="btn pri" data-act="new"><ha-icon icon="mdi:plus"></ha-icon>Erstes Rezept anlegen</button> <button class="btn" data-act="web"><ha-icon icon="mdi:web"></ha-icon>Aus dem Internet</button></div>`;
      if (!list.length) return `<div class="empty"><h3>Nichts gefunden</h3>Andere Suche oder Kategorie probieren.</div>`;
      return list.map((r) => {
        const img = this._img(r);
        const t = total(r);
        return `<article class="rc" data-act="open" data-id="${esc(r.id)}">
          <div class="ph" style="${img ? `background-image:url('${img}')` : phStyle(r)}">${img ? '' : esc((r.title || '?').trim().charAt(0).toUpperCase())}</div>
          <button class="fav${r.fav ? ' on' : ''}" data-act="fav" data-id="${esc(r.id)}" aria-label="Favorit"><ha-icon icon="mdi:heart${r.fav ? '' : '-outline'}"></ha-icon></button>
          <div class="info">${r.cat ? `<div class="cat">${esc(r.cat)}</div>` : ''}<h3>${esc(r.title || 'Ohne Titel')}</h3>
            <div class="meta">${t ? `<span><ha-icon icon="mdi:clock-outline"></ha-icon>${fmtMin(t)}</span>` : ''}<span><ha-icon icon="mdi:account-multiple-outline"></ha-icon>${esc(r.portions || '–')}</span>${this._dots(r.diff)}</div></div>
        </article>`;
      }).join('');
    }
    _dots(d) { d = +d || 0; if (!d) return ''; return `<span class="dots" title="${DIFF[d]}">${'●'.repeat(d)}<i>${'●'.repeat(3 - d)}</i></span>`; }

    _vRecipe() {
      const r = this._rec(), img = this._img(r, true), f = this._por / (+r.portions || 1);
      const ings = r.ingredients.map((it, i) => it.group
        ? `<li class="grp">${esc(it.group)}</li>`
        : `<li class="${this._checked.has(i) ? 'on' : ''}" data-act="ick" data-i="${i}"><span class="box"><ha-icon icon="mdi:check"></ha-icon></span><span class="amt">${esc(fmtAmt(it, f))}</span><span class="nm">${esc(it.name)}${it.note ? ` <small>${esc(it.note)}</small>` : ''}</span></li>`).join('');
      const steps = r.steps.filter((s) => s.text).map((s, i) => `<li><span class="no">${i + 1}</span><div><p>${esc(s.text)}</p>${this._stepTags(s)}</div></li>`).join('');
      const stat = (l, v) => `<div class="stat"><small>${l}</small><b>${v || '–'}</b></div>`;
      return `<div class="rv">
        <div class="hero" style="${img ? `background-image:url('${img}')` : phStyle(r)}">
          ${img ? '' : `<div class="ph">${esc((r.title || '?').charAt(0).toUpperCase())}</div>`}
          <div class="bar"><button class="ib" data-act="home" aria-label="Zurück"><ha-icon icon="mdi:arrow-left"></ha-icon></button><span class="sp"></span>
            <button class="ib" data-act="fav" data-id="${esc(r.id)}" style="${r.fav ? 'color:#ff8a8a' : ''}"><ha-icon icon="mdi:heart${r.fav ? '' : '-outline'}"></ha-icon></button>
            <button class="ib" data-act="edit" aria-label="Bearbeiten"><ha-icon icon="mdi:pencil-outline"></ha-icon></button></div>
          <div class="htxt">${r.cat ? `<div class="cat">${esc(r.cat)}</div>` : ''}<h2>${esc(r.title || 'Ohne Titel')}</h2>${r.desc ? `<p>${esc(r.desc)}</p>` : ''}</div>
        </div>
        <div class="panel"><div class="scroll"><div class="pin">
          ${this._timerBar(true)}
          <div class="stats">${stat('Vorbereitung', fmtMin(r.prep))}${stat('Kochen / Backen', fmtMin(r.cook))}${stat('Gesamt', fmtMin(total(r)))}${stat('Schwierigkeit', DIFF[+r.diff || 0])}</div>
          <div class="acts"><button class="btn pri" data-act="cook"><ha-icon icon="mdi:play"></ha-icon>Jetzt kochen</button>
            <button class="btn" data-act="tnew"><ha-icon icon="mdi:timer-plus-outline"></ha-icon>Timer</button>
            ${this._c.shopping_list ? '<button class="btn" data-act="bring"><ha-icon icon="mdi:cart-plus"></ha-icon>Auf die Einkaufsliste</button>' : ''}
            ${r.cooked ? `<span class="tag" style="align-self:center"><ha-icon icon="mdi:history"></ha-icon>${r.cooked}× gekocht</span>` : ''}</div>
          <div class="cols">
            <section><div class="sh"><h4>Zutaten</h4>${this._porHtml()}</div><ul class="ings">${ings || '<li class="mut">Noch keine Zutaten</li>'}</ul></section>
            <section><div class="sh"><h4>Zubereitung</h4></div><ol class="steps">${steps || '<li class="mut">Noch keine Schritte</li>'}</ol></section>
          </div>
          ${r.notes ? `<h4 class="ttl">Notizen</h4><div class="notes">${esc(r.notes)}</div>` : ''}
          ${(r.tags || []).length || isWeb(r.source) ? `<div class="tags" style="margin-top:18px">${(r.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}${isWeb(r.source) ? `<a class="tag" href="${esc(r.source)}" target="_blank" rel="noopener noreferrer"><ha-icon icon="mdi:open-in-new"></ha-icon>${esc(host(r.source))}</a>` : ''}</div>` : ''}
        </div></div></div>
      </div>`;
    }
    _porHtml() { return `<span class="por"><button data-act="pm" aria-label="Weniger">−</button><b>${this._por} ${this._por === 1 ? 'Portion' : 'Portionen'}</b><button data-act="pp" aria-label="Mehr">+</button></span>`; }
    _stepTags(s) {
      const t = [];
      if (+s.timer) t.push(`<span class="tag"><ha-icon icon="mdi:timer-outline"></ha-icon>${fmtMin(s.timer)}</span>`);
      if (s.temp) t.push(`<span class="tag"><ha-icon icon="mdi:thermometer"></ha-icon>${esc(s.temp)}${/^\d+$/.test(String(s.temp)) ? ' °C' : ''}</span>`);
      return t.length ? `<div class="tags">${t.join('')}</div>` : '';
    }

    // ---------- Editor ----------
    _vEdit() {
      const d = this._draft, isNew = !this._data.recipes.some((r) => r.id === d.id), img = this._img(d);
      const fld = (label, html, cls) => `<label class="fl${cls ? ' ' + cls : ''}"><span>${label}</span>${html}</label>`;
      const inp = (f, v, ph, mode) => `<input class="in" data-f="${f}" value="${esc(v == null ? '' : v)}" placeholder="${esc(ph || '')}"${mode ? ` inputmode="${mode}"` : ''}>`;
      return `<div class="edtop"><button class="ib" data-act="ecancel" aria-label="Abbrechen"><ha-icon icon="mdi:close"></ha-icon></button>
          <h2>${isNew ? 'Neues Rezept' : 'Rezept bearbeiten'}</h2>
          ${isNew ? '' : '<button class="btn ghost danger sm" data-act="edel"><ha-icon icon="mdi:delete-outline"></ha-icon>Löschen</button>'}
          <button class="btn pri" data-act="esave"><ha-icon icon="mdi:check"></ha-icon>Speichern</button></div>
        <div class="scroll"><div class="ed">
          <div>
            <div class="sec"><h4>Foto</h4>
              <div class="imgbox${img ? ' has' : ''}" style="${img ? `background-image:url('${img}')` : ''}">${img ? '' : '<ha-icon icon="mdi:camera-outline" style="--mdc-icon-size:36px"></ha-icon>Noch kein Foto'}${this._busy ? '<div class="busy">Lade hoch …</div>' : ''}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn sm"><ha-icon icon="mdi:image-plus"></ha-icon>${img ? 'Anderes Foto' : 'Foto wählen'}<input type="file" accept="image/*" data-f="img" hidden></label>
              ${img ? '<button class="btn sm ghost danger" data-act="imgdel"><ha-icon icon="mdi:close"></ha-icon>Entfernen</button>' : ''}</div>
            </div>
            <div class="sec"><h4>Grunddaten</h4>
              ${fld('Titel', inp('title', d.title, 'z. B. Omas Lasagne'))}
              ${fld('Kurzbeschreibung', `<textarea class="in" data-f="desc" rows="2" placeholder="Ein Satz, der Lust macht">${esc(d.desc)}</textarea>`)}
              <div class="row2">${fld('Kategorie', `<input class="in" data-f="cat" list="kb-cats" value="${esc(d.cat)}" placeholder="Hauptgericht"><datalist id="kb-cats">${[...new Set(CATS.concat(this._data.recipes.map((r) => r.cat).filter(Boolean)))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}
                ${fld('Schwierigkeit', `<select class="in" data-f="diff">${[1, 2, 3].map((i) => `<option value="${i}"${+d.diff === i ? ' selected' : ''}>${DIFF[i]}</option>`).join('')}</select>`)}</div>
              <div class="row2">${fld('Portionen', inp('portions', d.portions, '4', 'numeric'))}${fld('Stichwörter', inp('tags', (d.tags || []).join(', '), 'vegetarisch, schnell'))}</div>
              <div class="row3">${fld('Vorbereitung (min)', inp('prep', d.prep, '15', 'numeric'))}${fld('Kochen/Backen (min)', inp('cook', d.cook, '45', 'numeric'))}${fld('Ruhen (min)', inp('rest', d.rest, '0', 'numeric'))}</div>
              ${fld('Quelle (Internetadresse)', inp('source', d.source, 'https://…', 'url'))}
            </div>
            <div class="sec"><h4>Notizen</h4><textarea class="in" data-f="notes" rows="4" placeholder="Tipps, Varianten, Beilagen …">${esc(d.notes)}</textarea></div>
          </div>
          <div>
            <div class="sec ingsec">${this._edIngs()}</div>
            <div class="sec stsec">${this._edSteps()}</div>
          </div>
        </div></div>`;
    }
    _edIngs() {
      const d = this._draft;
      const mv = (i, kind) => `<span class="mv"><button data-act="up" data-k="${kind}" data-i="${i}" aria-label="Nach oben"><ha-icon icon="mdi:chevron-up"></ha-icon></button><button data-act="down" data-k="${kind}" data-i="${i}" aria-label="Nach unten"><ha-icon icon="mdi:chevron-down"></ha-icon></button><button data-act="rm" data-k="${kind}" data-i="${i}" aria-label="Entfernen"><ha-icon icon="mdi:close"></ha-icon></button></span>`;
      const rows = d.ingredients.map((it, i) => it.group !== undefined
        ? `<div class="irow g"><input class="in" data-ing="${i}" data-k="group" value="${esc(it.group)}" placeholder="Abschnitt, z. B. Für den Teig">${mv(i, 'ing')}</div>`
        : `<div class="irow"><input class="in" data-ing="${i}" data-k="amt" value="${esc(amtInput(it))}" placeholder="Menge" inputmode="decimal">
            <input class="in" data-ing="${i}" data-k="unit" value="${esc(it.unit)}" placeholder="Einheit" list="kb-units">
            <input class="in" data-ing="${i}" data-k="name" value="${esc(it.name)}" placeholder="Zutat">
            <input class="in note" data-ing="${i}" data-k="note" value="${esc(it.note)}" placeholder="Hinweis">${mv(i, 'ing')}</div>`).join('');
      return `<h4>Zutaten <button class="btn sm ghost" data-act="paste" data-k="ing"><ha-icon icon="mdi:text-box-plus-outline"></ha-icon>Als Text einfügen</button></h4>
        <div class="hint">Mengen beziehen sich auf ${esc(d.portions || 4)} Portionen. „1-2“ für Spannen, „½“ oder „0,5“ für Bruchteile.</div>
        <datalist id="kb-units">${UNITS.slice().reverse().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        ${rows}
        <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" data-act="addi"><ha-icon icon="mdi:plus"></ha-icon>Zutat</button><button class="btn sm ghost" data-act="addg"><ha-icon icon="mdi:format-header-pound"></ha-icon>Abschnitt</button></div>`;
    }
    _edSteps() {
      const d = this._draft;
      const rows = d.steps.map((s, i) => {
        const auto = !Array.isArray(s.ing), sel = stepIngs(d, s);
        const chips = d.ingredients.map((it, j) => it.group !== undefined || !it.name ? '' : `<button class="ic${sel.includes(j) ? ' on' : ''}${auto ? ' auto' : ''}" data-act="sting" data-st="${i}" data-i="${j}">${esc(it.name)}</button>`).join('');
        return `<div class="srow"><div class="hd"><b>Schritt ${i + 1}</b><span class="mv"><button data-act="up" data-k="st" data-i="${i}"><ha-icon icon="mdi:chevron-up"></ha-icon></button><button data-act="down" data-k="st" data-i="${i}"><ha-icon icon="mdi:chevron-down"></ha-icon></button><button data-act="rm" data-k="st" data-i="${i}"><ha-icon icon="mdi:close"></ha-icon></button></span></div>
          <textarea class="in" data-st="${i}" data-k="text" rows="3" placeholder="Was ist zu tun?">${esc(s.text)}</textarea>
          <div class="row3" style="margin-top:8px"><input class="in" data-st="${i}" data-k="timer" value="${esc(s.timer || '')}" placeholder="Timer (min)" inputmode="decimal">
            <input class="in" data-st="${i}" data-k="temp" value="${esc(s.temp || '')}" placeholder="Temperatur, z. B. 180">
            <input class="in" data-st="${i}" data-k="hint" value="${esc(s.hint || '')}" placeholder="Tipp (optional)"></div>
          ${chips ? `<div class="ichips">${chips}</div>` : ''}</div>`;
      }).join('');
      return `<h4>Zubereitung <button class="btn sm ghost" data-act="paste" data-k="st"><ha-icon icon="mdi:text-box-plus-outline"></ha-icon>Als Text einfügen</button></h4>
        <div class="hint">Die Zutaten unter jedem Schritt zeigt der Kochmodus an. Gestrichelt = automatisch aus dem Text erkannt, antippen legt sie fest.</div>
        ${rows}<button class="btn sm" data-act="adds"><ha-icon icon="mdi:plus"></ha-icon>Schritt</button>`;
    }
    _reEd(which) {
      const el = this._$(which === 'ing' ? '.ingsec' : '.stsec');
      if (el) el.innerHTML = which === 'ing' ? this._edIngs() : this._edSteps();
      if (which === 'ing') { const s = this._$('.stsec'); if (s) s.innerHTML = this._edSteps(); }
    }

    // ---------- Kochmodus ----------
    _vCook() {
      const r = this._rec(), k = this._ck, steps = r.steps.filter((s) => s.text), n = steps.length, f = this._por / (+r.portions || 1);
      const prog = Array.from({ length: n + 1 }, (x, i) => `<i class="${i <= k ? 'on' : ''}"></i>`).join('');
      let body, title;
      if (k === 0) {
        title = 'Bereitlegen';
        const li = r.ingredients.map((it, i) => it.group ? `<li class="grp">${esc(it.group)}</li>` : `<li class="${this._checked.has(i) ? 'on' : ''}" data-act="ick" data-i="${i}"><span class="box"><ha-icon icon="mdi:check"></ha-icon></span><span class="amt">${esc(fmtAmt(it, f))}</span><span class="nm">${esc(it.name)}${it.note ? ` <small>${esc(it.note)}</small>` : ''}</span></li>`).join('');
        body = `<div class="mise"><h2>Alles bereit?</h2><p>Für ${this._por} ${this._por === 1 ? 'Portion' : 'Portionen'} · tippe ab, was schon auf der Arbeitsfläche steht.</p>${this._hasVoice() ? '<div class="vhint"><ha-icon icon="mdi:microphone-outline"></ha-icon>Freihändig: „Alexa, nächster Schritt“ · „Alexa, Schritt zurück“ · „Alexa, lies vor“</div>' : ''}<ul class="mgrid">${li}</ul></div>`;
      } else if (k > n) {
        title = 'Fertig';
        body = `<div class="cdone"><div class="big"><ha-icon icon="mdi:silverware-fork-knife"></ha-icon></div><h2>Guten Appetit!</h2><p class="mut">${esc(r.title)} ist fertig.</p></div>`;
      } else {
        const s = steps[k - 1], si = r.steps.indexOf(s);
        title = `Schritt ${k} von ${n}`;
        const need = stepIngs(r, s).map((i) => `<li><span class="amt">${esc(fmtAmt(r.ingredients[i], f))}</span><span>${esc(r.ingredients[i].name)}${r.ingredients[i].note ? ` <small class="mut">${esc(r.ingredients[i].note)}</small>` : ''}</span></li>`).join('');
        const tm = +s.timer ? this._ringHtml(si, s) : '';
        const temp = s.temp ? `<div class="temp"><ha-icon icon="mdi:thermometer"></ha-icon>${esc(s.temp)}${/^\d+$/.test(String(s.temp)) ? ' °C' : ''}</div>` : '';
        body = `<div class="cmain"><div class="cnum">Schritt ${k}</div><p class="ctext">${esc(s.text)}</p>${s.hint ? `<div class="chint"><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon>${esc(s.hint)}</div>` : ''}</div>
          <aside class="cside">${temp}${tm}${need ? `<h4>Dafür brauchst du</h4><ul class="need">${need}</ul>` : (temp || tm ? '' : '<h4>Keine Zutaten für diesen Schritt</h4>')}</aside>`;
      }
      return `<div class="cook">
        <div class="ctop"><button class="ib" data-act="cexit" aria-label="Kochmodus beenden"><ha-icon icon="mdi:close"></ha-icon></button>
          <div class="ct"><small>${esc(r.title)}</small><b>${title}</b></div><div class="tbar" style="padding:0">${this._timerChips()}</div>
          <button class="ib${this._autoRead ? ' on' : ''}" data-act="aread" aria-label="Schritte vorlesen" title="Schritte automatisch vorlesen"><ha-icon icon="mdi:${this._autoRead ? 'account-voice' : 'volume-off'}"></ha-icon></button>
          <button class="btn tnew" data-act="tnew"><ha-icon icon="mdi:timer-plus-outline"></ha-icon><span>Timer</span></button></div>
        <div class="prog">${prog}</div>
        <div class="cbody">${body}</div>
        <div class="cnav">${k > 0 ? '<button class="btn back" data-act="cprev"><ha-icon icon="mdi:arrow-left"></ha-icon>Zurück</button>' : ''}
          ${k > n ? '<button class="btn pri" data-act="cfinish"><ha-icon icon="mdi:check"></ha-icon>Fertig gekocht</button>' : `<button class="btn pri" data-act="cnext">${k === 0 ? 'Los geht\'s' : k === n ? 'Fertig' : 'Weiter'}<ha-icon icon="mdi:arrow-right"></ha-icon></button>`}</div>
      </div>`;
    }
    _ringHtml(si, s) {
      const t = this._timers.find((x) => x.rid === this._cur && x.si === si);
      const R = 34, C = 2 * Math.PI * R;
      const left = t ? this._left(t) : s.timer * 60, tot = t ? t.total : s.timer * 60;
      const sub = !t ? 'Antippen zum Starten' : t.done ? 'Abgelaufen – antippen zum Beenden' : t.paused ? 'Pausiert – antippen zum Fortsetzen' : 'Läuft – antippen zum Pausieren';
      return `<div class="tring${t && t.done ? ' done' : ''}" data-act="timer" data-si="${si}">
        <svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="${R}" fill="none" stroke="#e2e9f3" stroke-width="7"/>
          <circle data-ring="${t ? t.id : ''}" cx="42" cy="42" r="${R}" fill="none" stroke="url(#kbg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - left / tot)}" transform="rotate(-90 42 42)"/>
          <defs><linearGradient id="kbg"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs></svg>
        <div><div class="tv" data-tv="${t ? t.id : ''}">${fmtClock(left)}</div><small>${sub}</small></div></div>`;
    }
    _cookStart() {
      this._ck = 0;
      this._view = 'cook';
      this._wake(true);
      this._render();
    }
    _cookGo(d, byVoice) {
      const r = this._rec(), n = r.steps.filter((s) => s.text).length;
      const k = Math.max(0, Math.min(n + 1, this._ck + d));
      if (k === this._ck) { if (byVoice) this._speak(k > n ? 'Das war der letzte Schritt.' : 'Du bist schon am Anfang.'); return; }
      this._ck = k;
      this._render();
      if (byVoice || this._autoRead) this._speakStep();
    }
    async _wake(on) {
      try {
        if (on && navigator.wakeLock && !this._lock) { this._lock = await navigator.wakeLock.request('screen'); this._lock.addEventListener('release', () => { this._lock = null; }); }
        if (!on && this._lock) { this._lock.release(); this._lock = null; }
      } catch (e) { /* nicht unterstützt */ }
    }

    // ---------- Timer ----------
    _left(t) { return t.done ? 0 : t.paused ? t.rem : (t.end - Date.now()) / 1000; }
    _timerToggle(si) {
      const r = this._rec(), s = r.steps[si];
      let t = this._timers.find((x) => x.rid === r.id && x.si === si);
      this._audio();
      if (!t) {
        const sec = Math.round(+s.timer * 60);
        t = { id: uid(), rid: r.id, si, title: r.title, label: `Schritt ${r.steps.filter((x) => x.text).indexOf(s) + 1}`, total: sec, end: Date.now() + sec * 1000 };
        this._timers.push(t);
      } else if (t.done) {
        this._timers = this._timers.filter((x) => x !== t);
        this._stopAlarm();
      } else if (t.paused) { t.end = Date.now() + t.rem * 1000; t.paused = false; } else { t.rem = (t.end - Date.now()) / 1000; t.paused = true; }
      this._ensureTick();
      this._render();
    }
    // Freier Timer, unabhängig von den Schritten (z. B. Eier)
    _startFree(min, label) {
      const sec = Math.round(min * 60);
      if (!(sec > 0)) { this._toast('Bitte eine Dauer eingeben', true); return; }
      this._audio();
      const name = String(label || '').trim() || `Timer ${fmtMin(min) || fmtClock(sec)}`;
      this._timers.push({ id: uid(), rid: null, si: null, free: true, title: name, label: name, total: sec, end: Date.now() + sec * 1000 });
      this._modal(null);
      this._ensureTick();
      this._render();
      this._toast(`⏱ ${name} läuft · ${fmtClock(sec)}`);
    }
    _timerDlg() {
      const q = QUICK.map(([l, m]) => `<button class="qb" data-act="tpre" data-m="${m}" data-l="${esc(l)}"><b>${esc(l)}</b><small>${m} min</small></button>`).join('');
      const mb = MINUTES.map((m) => `<button class="mb" data-act="tpre" data-m="${m}">${m}′</button>`).join('');
      this._modal(`<div class="dlg"><h3>Timer stellen</h3><div class="db">
        <div class="lab">Schnellwahl</div><div class="qgrid">${q}</div>
        <div class="lab">Minuten</div><div class="mgr">${mb}</div>
        <div class="lab">Eigener Timer</div>
        <div class="tcust"><input class="in tmin" inputmode="decimal" placeholder="Min."><input class="in tlab" placeholder="Name, z. B. Ofen"><button class="btn pri" data-act="tcustom"><ha-icon icon="mdi:play"></ha-icon>Start</button></div>
        </div><div class="df"><button class="btn ghost" data-act="mclose">Schließen</button></div></div>`);
    }
    // Steuerung eines laufenden freien Timers
    _timerCtl(t) {
      this._ctl = t.id;
      this._modal(`<div class="dlg"><h3>${esc(t.label)}</h3><div class="db tctl"><div class="tv" data-tv="${t.id}">${fmtClock(this._left(t))}</div><p>${t.paused ? 'pausiert' : 'läuft'} · von ${fmtClock(t.total)}</p></div>
        <div class="df"><button class="btn ghost danger" data-act="tstop"><ha-icon icon="mdi:stop"></ha-icon>Stoppen</button>
        <button class="btn" data-act="tplus"><ha-icon icon="mdi:plus"></ha-icon>1 min</button>
        <button class="btn pri" data-act="tpause"><ha-icon icon="mdi:${t.paused ? 'play' : 'pause'}"></ha-icon>${t.paused ? 'Weiter' : 'Pause'}</button></div></div>`);
    }
    _ensureTick() {
      if (this._tk || !this._timers.length) return;
      this._tk = setInterval(() => {
        if (!this._timers.length) { clearInterval(this._tk); this._tk = null; return; }
        let changed = false;
        this._timers.forEach((t) => { if (!t.done && !t.paused && t.end <= Date.now()) { t.done = true; changed = true; this._alarm(t); } });
        if (changed) this._render(); else this._tickUi();
      }, 250);
    }
    _tickUi() {
      this._timers.forEach((t) => {
        const left = this._left(t);
        this.shadowRoot.querySelectorAll(`[data-tv="${t.id}"]`).forEach((el) => { el.textContent = fmtClock(left); });
        this.shadowRoot.querySelectorAll(`[data-ring="${t.id}"]`).forEach((el) => { const C = 2 * Math.PI * 34; el.setAttribute('stroke-dashoffset', String(C * (1 - left / t.total))); });
      });
    }
    _timerChips() {
      return this._timers.map((t) => `<button class="tchip${t.done ? ' done' : ''}" data-act="tjump" data-tid="${t.id}"><ha-icon icon="mdi:timer${t.done ? '-alert' : t.paused ? '-pause' : ''}-outline"></ha-icon>${esc(t.label)} · <span data-tv="${t.id}">${fmtClock(this._left(t))}</span></button>`).join('');
    }
    _timerBar() { return this._timers.length ? `<div class="tbar">${this._timerChips()}</div>` : ''; }
    _audio() {
      try { if (!this._ac) this._ac = new (window.AudioContext || window.webkitAudioContext)(); if (this._ac.state === 'suspended') this._ac.resume(); } catch (e) { /* kein Ton */ }
    }
    _alarm(t) {
      this._toast(t.free ? `⏰ ${t.label} ist fertig` : `⏰ ${t.title}: ${t.label} ist fertig`);
      try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { /* */ }
      if (this._c.announce) {
        const [dom, svc] = String(this._c.announce).split('.');
        const msg = t.free ? `Der Timer ${t.label} ist abgelaufen.` : `Der Timer für ${t.title}, ${t.label}, ist abgelaufen.`;
        this._hass.callService(dom, svc, { message: msg, data: { type: 'announce' } }).catch(() => {});
      }
      const beep = () => {
        const ac = this._ac;
        if (!ac) return;
        [0, 0.25, 0.5].forEach((d) => {
          const o = ac.createOscillator(), g = ac.createGain();
          o.frequency.value = 880; o.type = 'sine';
          g.gain.setValueAtTime(0.0001, ac.currentTime + d);
          g.gain.exponentialRampToValueAtTime(0.4, ac.currentTime + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.2);
          o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.22);
        });
      };
      beep();
      clearInterval(this._al);
      let n = 0;
      this._al = setInterval(() => { if (++n > 15 || !this._timers.some((x) => x.done)) { this._stopAlarm(); return; } beep(); }, 2000);
    }
    _stopAlarm() { clearInterval(this._al); this._al = null; }

    // ---------- Einkaufsliste ----------
    async _bring() {
      const r = this._rec(), f = this._por / (+r.portions || 1), ent = this._c.shopping_list;
      let have = [];
      try {
        const res = await this._hass.callWS({ type: 'call_service', domain: 'todo', service: 'get_items', target: { entity_id: ent }, service_data: { status: 'needs_action' }, return_response: true });
        const items = (res && res.response && res.response[ent] && res.response[ent].items) || [];
        have = items.map((x) => String(x.summary || '').toLowerCase().trim());
      } catch (e) { /* Liste nicht lesbar: alles anbieten */ }
      const pantry = this._pantry();
      this._bl = shopItems(r.ingredients).map((it) => {
        const has = have.includes(it.name.toLowerCase().trim());
        const tiny = TINY.includes(String(it.unit || '').toLowerCase());
        const x = { name: it.name, buy: buyText(it, f), rec: fmtAmt(it, f), has, tiny, staple: inList(it.name, pantry) };
        x.on = !has && !x.staple && !tiny;
        return x;
      });
      this._bringDlg();
    }
    // Vorrat: im Kochbuch gespeichert (alle Geräte), sonst Kartenoption pantry, sonst Grundliste
    _pantry() { return Array.isArray(this._data.pantry) ? this._data.pantry : Array.isArray(this._c.pantry) ? this._c.pantry : PANTRY; }
    // Einkaufen oben, "hast du vermutlich da" unten; Stern = immer im Haus
    _bringDlg() {
      const ent = this._c.shopping_list, st = this._hass.states[ent];
      const row = (x, k) => `<li class="${x.on ? 'on' : ''}${x.has ? ' has' : ''}" data-act="bt" data-k="${k}"><span class="box"><ha-icon icon="mdi:check"></ha-icon></span>
        <span class="bnm">${esc(x.name)}${x.rec && x.buy && x.rec !== x.buy ? `<small>Rezept: ${esc(x.rec)}</small>` : ''}</span>
        ${x.has ? '<em>steht schon drauf</em>' : x.buy ? `<span class="buy">${esc(x.buy)}</span>` : ''}
        <button class="pst${x.staple ? ' on' : ''}" data-act="pstar" data-k="${k}" aria-label="Immer im Haus" title="${x.staple ? 'Nicht mehr als Vorrat merken' : 'Hab ich immer im Haus'}"><ha-icon icon="mdi:star${x.staple ? '' : '-outline'}"></ha-icon></button></li>`;
      const idx = this._bl.map((x, k) => k), main = idx.filter((k) => !this._bl[k].staple && !this._bl[k].tiny), rest = idx.filter((k) => this._bl[k].staple || this._bl[k].tiny);
      this._modal(`<div class="dlg"><h3>Auf die Einkaufsliste</h3>
        <div class="db"><p class="mut" style="margin:0 0 10px">${esc(st ? st.attributes.friendly_name || ent : ent)} · für ${this._por} ${this._por === 1 ? 'Portion' : 'Portionen'}</p>
        <ul class="blist">${main.map((k) => row(this._bl[k], k)).join('')}
        ${rest.length ? `<li class="sep">Hast du vermutlich da · <ha-icon icon="mdi:star" style="--mdc-icon-size:14px;color:#f5a524"></ha-icon> = immer im Haus</li>${rest.map((k) => row(this._bl[k], k)).join('')}` : ''}</ul></div>
        <div class="df"><button class="btn ghost" data-act="mclose">Abbrechen</button><button class="btn pri" data-act="bsend"><ha-icon icon="mdi:cart-plus"></ha-icon><span class="bn">${this._bl.filter((x) => x.on).length}</span>&nbsp;übernehmen</button></div></div>`);
    }
    // Stern: Zutat als Vorrat merken oder vergessen, gespeichert im Kochbuch
    _pantryToggle(k) {
      const x = this._bl[k];
      const cur = this._pantry().slice();
      const next = x.staple ? cur.filter((p) => !matchName(x.name, p)) : cur.concat(String(x.name).trim());
      this._bl.filter((y) => matchName(y.name, x.name) || inList(y.name, next) !== y.staple).forEach((y) => {
        y.staple = inList(y.name, next);
        y.on = !y.has && !y.staple && !y.tiny;
      });
      this._data.pantry = next;
      this._bringDlg();
      this._mutate((kb) => { kb.pantry = next; }, x.staple ? `${x.name} als Vorrat gemerkt` : `${x.name} kommt wieder auf die Liste`);
    }
    async _bringSend() {
      const sel = (this._bl || []).filter((x) => x.on);
      if (!sel.length) { this._modal(null); return; }
      let ok = 0;
      for (const x of sel) {
        const tgt = { entity_id: this._c.shopping_list };
        try {
          await this._hass.callService('todo', 'add_item', x.buy ? { item: x.name, description: x.buy } : { item: x.name }, tgt); ok++;
        } catch (e) {
          // Liste ohne Beschreibungsfeld: Menge in den Namen schreiben
          try { await this._hass.callService('todo', 'add_item', { item: x.buy ? `${x.name} (${x.buy})` : x.name }, tgt); ok++; } catch (e2) { /* weiter */ }
        }
      }
      this._modal(null);
      this._toast(ok === sel.length ? `${ok} ${ok === 1 ? 'Zutat' : 'Zutaten'} auf der Einkaufsliste` : `${ok} von ${sel.length} übernommen`, ok !== sel.length);
    }

    // ---------- Fenster, Meldungen ----------
    _modal(html) {
      const m = this._$('.modal');
      m.innerHTML = html || '';
      m.classList.toggle('show', !!html);
    }
    _toast(t, err) {
      const el = this._$('.toast');
      if (!el) return;
      el.textContent = t;
      el.classList.toggle('err', !!err);
      el.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => el.classList.remove('show'), 3200);
    }
    _confirm(text, okLabel, fn) {
      this._cfn = fn;
      this._modal(`<div class="dlg"><h3>${esc(text)}</h3><div class="df"><button class="btn ghost" data-act="mclose">Abbrechen</button><button class="btn pri" data-act="cfok">${esc(okLabel)}</button></div></div>`);
    }

    // ---------- Eingaben ----------
    _openRecipe(id) {
      const r = this._rec(id);
      if (!r) return;
      if (this._cur !== id) this._checked = new Set();
      this._cur = id;
      this._por = +r.portions || 4;
      this._view = 'recipe';
      this._render();
    }
    _edit(r) {
      this._draft = clone(r || blank());
      this._origImg = r && r.image ? r.image.id : null;
      this._newImgs = [];
      this._view = 'edit';
      this._render();
    }
    async _editSave() {
      const d = this._draft;
      d.title = String(d.title || '').trim();
      if (!d.title) { this._toast('Bitte einen Titel eingeben', true); const t = this._$('[data-f="title"]'); if (t) t.focus(); return; }
      d.portions = Math.max(1, Math.round(num(d.portions) || 4));
      ['prep', 'cook', 'rest'].forEach((k) => { const v = num(d[k]); d[k] = v ? Math.round(v) : null; });
      // Leere Zeilen entfernen und die Zutaten der Schritte auf die neuen Positionen umschreiben
      const keep = [];
      d.ingredients.forEach((it, i) => { if (it.group !== undefined ? String(it.group).trim() : String(it.name || '').trim()) keep.push(i); });
      const pos = new Map(keep.map((o, n) => [o, n]));
      d.ingredients = keep.map((i) => d.ingredients[i]);
      d.steps.forEach((s) => { if (Array.isArray(s.ing)) s.ing = s.ing.filter((i) => pos.has(i)).map((i) => pos.get(i)); });
      d.steps = d.steps.filter((s) => String(s.text || '').trim()).map((s) => { const o = Object.assign({}, s); o.timer = num(s.timer) || null; if (!o.timer) delete o.timer; if (!o.temp) delete o.temp; if (!o.hint) delete o.hint; return o; });
      d.source = String(d.source || '').trim();
      if (!d.source) delete d.source;
      d.updated = Date.now();
      const old = this._origImg, now = d.image && d.image.id;
      if (await this._mutate((kb) => { const i = kb.recipes.findIndex((x) => x.id === d.id); if (i >= 0) kb.recipes[i] = d; else kb.recipes.push(d); }, 'Rezept gespeichert')) {
        if (old && old !== now) this._delImg(old);
        (this._newImgs || []).filter((x) => x !== now).forEach((x) => this._delImg(x));
        this._newImgs = [];
        this._draft = null;
        this._openRecipe(d.id);
      }
    }
    _editCancel() {
      (this._newImgs || []).forEach((x) => this._delImg(x));
      this._newImgs = [];
      const had = this._draft && this._data.recipes.some((r) => r.id === this._draft.id);
      this._draft = null;
      if (had) this._view = 'recipe'; else this._view = 'home';
      this._render();
    }
    // ---------- Rezept aus dem Internet ----------
    _webDlg(url, err) {
      const busy = !!this._webBusy;
      this._modal(`<div class="dlg"><h3>Rezept aus dem Internet</h3><div class="db">
        <p class="hint" style="margin:0 0 10px">Adresse einer Rezeptseite einfügen, zum Beispiel von Chefkoch, Lecker oder einem Foodblog. Titel, Foto, Zutaten, Schritte und Zeiten werden übernommen. Vor dem Speichern kannst du alles prüfen.</p>
        <input class="in weburl" type="url" inputmode="url" placeholder="https://…" value="${esc(url || '')}"${busy ? ' disabled' : ''}>
        ${err ? `<p class="werr">${esc(err)}</p>` : ''}
        <p class="hint" style="margin:10px 0 0">Eingelesene Rezepte, vor allem Fotos und ausformulierte Texte, sind urheberrechtlich geschützt. Nur für dein privates Kochbuch, bitte nicht veröffentlichen oder weitergeben.</p>
        ${this._viaHa() ? '' : '<p class="hint" style="margin:10px 0 0">Noch nicht eingerichtet: Ohne <code>rest_command.kochbuch_abruf</code> in Home Assistant wird die Seite über öffentliche Dienste abgerufen, und die sind oft überlastet.</p>'}
        </div><div class="df"><button class="btn ghost" data-act="mclose">Abbrechen</button>
        <button class="btn pri${busy ? ' spin' : ''}" data-act="webok"${busy ? ' disabled' : ''}><ha-icon icon="mdi:${busy ? 'loading' : 'download'}"></ha-icon>${busy ? 'Lese ein …' : 'Einlesen'}</button></div></div>`);
      if (!busy) setTimeout(() => { const t = this._$('.weburl'); if (t) { t.focus(); t.select(); } }, 50);
    }
    async _webImport() {
      if (this._webBusy) return;
      let url = String((this._$('.weburl') || {}).value || '').trim();
      if (!url) return;
      if (!isWeb(url)) url = 'https://' + url.replace(/^\/+/, '');
      try { url = new URL(url).href; } catch (e) { this._webDlg(url, 'Das ist keine gültige Internetadresse.'); return; }
      this._webBusy = true;
      this._webDlg(url);
      let up = null;
      try {
        const html = await this._fetchPage(url);
        const { r, img, found } = parsePage(html, url, blank());
        // Ohne Rezeptdaten nur übernehmen, wenn die Seite wenigstens Titel und Vorschaubild hat (keine Fehlerseiten)
        if (!found && (!r.title || !img)) throw new Error('Auf dieser Seite wurde kein Rezept gefunden.');
        if (img) { try { up = await this._uploadUrl(img); r.image = { id: up }; } catch (e) { r.image = { url: img }; } }
        this._webBusy = false;
        // Fenster inzwischen geschlossen: abgebrochen
        if (!this._$('.modal').classList.contains('show')) { if (up) this._delImg(up); return; }
        this._modal(null);
        this._edit(r);
        this._origImg = null;
        this._newImgs = up ? [up] : [];
        const dup = this._data.recipes.some((x) => x.source === url);
        this._toast(!found ? 'Kein vollständiges Rezept erkannt: Titel und Foto übernommen, Rest bitte ergänzen' : dup ? 'Eingelesen. Hinweis: dieses Rezept steht schon im Kochbuch' : 'Rezept eingelesen. Bitte prüfen und speichern', !found);
      } catch (e) {
        this._webBusy = false;
        if (up) this._delImg(up);
        const m = (e && (e.message || e.code)) || String(e);
        if (this._$('.modal').classList.contains('show')) this._webDlg(url, /failed to fetch|networkerror|load failed/i.test(m) ? 'Die Seite konnte nicht abgerufen werden. Adresse prüfen oder später nochmal versuchen.' : m);
      }
    }

    _move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
    // Schritt-Zutaten zeigen auf Positionen: beim Verschieben/Löschen von Zutaten mitführen
    _remapIngs(map) { this._draft.steps.forEach((s) => { if (Array.isArray(s.ing)) s.ing = s.ing.map((i) => map(i)).filter((i) => i !== null && i >= 0); }); }

    _click(e) {
      const el = e.target.closest('[data-act]');
      if (!el) { if (e.target.classList && e.target.classList.contains('modal')) this._modal(null); return; }
      const a = el.dataset.act, d = this._draft;
      switch (a) {
        case 'new': this._edit(null); break;
        case 'web': this._webDlg(''); break;
        case 'webok': this._webImport(); break;
        case 'open': this._openRecipe(el.dataset.id); break;
        case 'home': this._view = 'home'; this._render(); break;
        case 'cat': this._cat = el.dataset.k; lsSet('kochbuch:cat', this._cat); this._render(); break;
        case 'fav': {
          e.stopPropagation();
          const id = el.dataset.id, r = this._rec(id);
          if (!r) break;
          r.fav = !r.fav; this._render();
          this._mutate((kb) => { const x = kb.recipes.find((y) => y.id === id); if (x) x.fav = r.fav; }).then((ok) => { if (!ok) { r.fav = !r.fav; this._render(); } });
          break;
        }
        case 'edit': this._edit(this._rec()); break;
        case 'pm': if (this._por > 1) { this._por--; this._render(); } break;
        case 'pp': if (this._por < 99) { this._por++; this._render(); } break;
        case 'ick': { const i = +el.dataset.i; if (this._checked.has(i)) this._checked.delete(i); else this._checked.add(i); el.classList.toggle('on'); break; }
        case 'cook': this._cookStart(); break;
        case 'cnext': this._cookGo(1); break;
        case 'cprev': this._cookGo(-1); break;
        case 'cexit': this._view = 'recipe'; this._wake(false); this._render(); break;
        case 'cfinish': {
          const id = this._cur;
          this._wake(false);
          this._view = 'recipe';
          this._checked = new Set();
          this._render();
          this._mutate((kb) => { const x = kb.recipes.find((y) => y.id === id); if (x) { x.cooked = (x.cooked || 0) + 1; x.last = Date.now(); } }).then((ok) => { if (ok) { this._toast('Guten Appetit!'); this._render(); } });
          break;
        }
        case 'timer': this._timerToggle(+el.dataset.si); break;
        case 'tjump': {
          const t = this._timers.find((x) => x.id === el.dataset.tid);
          if (!t) break;
          if (t.done) { this._timers = this._timers.filter((x) => x !== t); if (!this._timers.some((x) => x.done)) this._stopAlarm(); this._render(); break; }
          if (t.free) { this._timerCtl(t); break; }
          const r = this._rec(t.rid);
          if (!r) break;
          if (this._cur !== t.rid) { this._cur = t.rid; this._por = +r.portions || 4; }
          this._ck = r.steps.filter((s) => s.text).indexOf(r.steps[t.si]) + 1;
          this._view = 'cook'; this._wake(true); this._render();
          break;
        }
        case 'bring': this._bring(); break;
        case 'tnew': this._timerDlg(); break;
        case 'aread':
          this._autoRead = !this._autoRead;
          lsSet('kochbuch:autoread', this._autoRead);
          this._render();
          this._toast(this._autoRead ? 'Schritte werden vorgelesen' : 'Vorlesen aus');
          if (this._autoRead) this._speakStep();
          break;
        case 'tpre': this._startFree(+el.dataset.m, el.dataset.l); break;
        case 'tcustom': this._startFree(num((this._$('.tmin') || {}).value), (this._$('.tlab') || {}).value); break;
        case 'tpause': case 'tplus': case 'tstop': {
          const t = this._timers.find((x) => x.id === this._ctl);
          if (!t) { this._modal(null); break; }
          if (a === 'tstop') { this._timers = this._timers.filter((x) => x !== t); this._modal(null); this._render(); break; }
          if (a === 'tplus') { if (t.paused) t.rem += 60; else t.end += 60000; t.total += 60; }
          if (a === 'tpause') { if (t.paused) { t.end = Date.now() + t.rem * 1000; t.paused = false; } else { t.rem = (t.end - Date.now()) / 1000; t.paused = true; } }
          this._timerCtl(t);
          this._render();
          break;
        }
        case 'bt': { const x = this._bl[+el.dataset.k]; x.on = !x.on; el.classList.toggle('on', x.on); const bn = this._$('.bn'); if (bn) bn.textContent = this._bl.filter((y) => y.on).length; break; }
        case 'pstar': e.stopPropagation(); this._pantryToggle(+el.dataset.k); break;
        case 'bsend': this._bringSend(); break;
        case 'mclose': this._modal(null); break;
        case 'cfok': { const fn = this._cfn; this._cfn = null; this._modal(null); if (fn) fn(); break; }
        // Editor
        case 'esave': this._editSave(); break;
        case 'ecancel': this._editCancel(); break;
        case 'edel': this._confirm(`„${d.title || 'Rezept'}“ wirklich löschen?`, 'Löschen', async () => {
          const id = d.id, img = this._origImg;
          if (await this._mutate((kb) => { kb.recipes = kb.recipes.filter((x) => x.id !== id); }, 'Rezept gelöscht')) {
            this._delImg(img); (this._newImgs || []).forEach((x) => this._delImg(x));
            this._draft = null; this._view = 'home'; this._render();
          }
        }); break;
        case 'imgdel': d.image = null; this._render(); break;
        case 'addi': d.ingredients.push({ amount: null, amount2: null, unit: '', name: '', note: '' }); this._reEd('ing'); { const ins = this.shadowRoot.querySelectorAll('[data-k="amt"]'); if (ins.length) ins[ins.length - 1].focus(); } break;
        case 'addg': d.ingredients.push({ group: '' }); this._reEd('ing'); break;
        case 'adds': d.steps.push({ text: '' }); this._reEd('st'); { const ts = this.shadowRoot.querySelectorAll('textarea[data-st]'); if (ts.length) ts[ts.length - 1].focus(); } break;
        case 'up': case 'down': case 'rm': {
          const i = +el.dataset.i, kind = el.dataset.k, arr = kind === 'ing' ? d.ingredients : d.steps;
          if (a === 'rm') {
            arr.splice(i, 1);
            if (kind === 'ing') this._remapIngs((x) => (x === i ? null : x > i ? x - 1 : x));
            if (kind === 'st' && !arr.length) arr.push({ text: '' });
          } else {
            const j = i + (a === 'up' ? -1 : 1);
            if (j < 0 || j >= arr.length) break;
            this._move(arr, i, a === 'up' ? -1 : 1);
            if (kind === 'ing') this._remapIngs((x) => (x === i ? j : x === j ? i : x));
          }
          this._reEd(kind === 'ing' ? 'ing' : 'st');
          break;
        }
        case 'sting': {
          const s = d.steps[+el.dataset.st], j = +el.dataset.i;
          if (!Array.isArray(s.ing)) s.ing = stepIngs(d, s);
          if (s.ing.includes(j)) s.ing = s.ing.filter((x) => x !== j); else s.ing.push(j);
          s.ing.sort((x, y) => x - y);
          this._reEd('st');
          break;
        }
        case 'paste': {
          const ing = el.dataset.k === 'ing';
          this._pasteKind = el.dataset.k;
          this._modal(`<div class="dlg"><h3>${ing ? 'Zutaten' : 'Schritte'} als Text einfügen</h3><div class="db">
            <p class="hint" style="margin:0 0 10px">${ing ? 'Eine Zutat pro Zeile, zum Beispiel „250 g Mehl, gesiebt“. Eine Zeile mit Doppelpunkt am Ende („Für den Teig:“) wird zum Abschnitt.' : 'Ein Schritt pro Absatz (Leerzeile dazwischen) oder pro Zeile. Nummern wie „1.“ werden entfernt. Zeiten wie „20 Minuten“ werden als Timer erkannt.'}</p>
            <textarea class="in pastebox" rows="10" placeholder="${ing ? '500 g Spaghetti\n2 EL Olivenöl\n1 Zwiebel, fein gewürfelt' : 'Wasser in einem großen Topf zum Kochen bringen.\n\nSpaghetti 10 Minuten bissfest garen.'}"></textarea></div>
            <div class="df"><button class="btn ghost" data-act="mclose">Abbrechen</button><button class="btn pri" data-act="pasteok">Übernehmen</button></div></div>`);
          setTimeout(() => { const t = this._$('.pastebox'); if (t) t.focus(); }, 50);
          break;
        }
        case 'pasteok': {
          const txt = (this._$('.pastebox') || {}).value || '';
          if (this._pasteKind === 'ing') {
            const rows = txt.split(/\n/).map(parseLine).filter(Boolean);
            d.ingredients = d.ingredients.filter((it) => it.group !== undefined ? it.group : it.name).concat(rows);
          } else {
            const parts = (/\n\s*\n/.test(txt) ? txt.split(/\n\s*\n/) : txt.split(/\n/)).map((x) => x.replace(/\s*\n\s*/g, ' ').replace(/^\s*(\d+[.)]|schritt\s*\d+:?|[-•*])\s*/i, '').trim()).filter(Boolean);
            const steps = parts.map(stepFrom);
            d.steps = d.steps.filter((s) => s.text).concat(steps);
            if (!d.steps.length) d.steps.push({ text: '' });
          }
          this._modal(null);
          this._reEd(this._pasteKind === 'ing' ? 'ing' : 'st');
          break;
        }
        default: break;
      }
    }
    _input(e) {
      const t = e.target;
      if (t.dataset.f === 'q') {
        this._q = t.value;
        const g = this._$('.grid');
        if (g) g.innerHTML = this._gridHtml();
        return;
      }
      const d = this._draft;
      if (!d) return;
      if (t.dataset.f && t.dataset.f !== 'img') {
        const f = t.dataset.f;
        if (f === 'tags') d.tags = t.value.split(',').map((x) => x.trim()).filter(Boolean);
        else if (f === 'diff') d.diff = +t.value;
        else d[f] = t.value;
        return;
      }
      if (t.dataset.ing !== undefined) {
        const it = d.ingredients[+t.dataset.ing], k = t.dataset.k;
        if (k === 'amt') { const p = parseAmt(t.value); it.amount = p.a; it.amount2 = p.a2; } else it[k] = t.value;
        return;
      }
      if (t.dataset.st !== undefined) d.steps[+t.dataset.st][t.dataset.k] = t.value;
    }
    async _change(e) {
      const t = e.target;
      if (t.dataset.f === 'diff' && this._draft) { this._draft.diff = +t.value; return; }
      // Zutatenname geändert: Chips der Schritte auffrischen
      if (t.dataset.ing !== undefined && t.dataset.k === 'name') { const s = this._$('.stsec'); if (s) s.innerHTML = this._edSteps(); return; }
      if (t.dataset.f !== 'img' || !t.files || !t.files[0]) return;
      this._busy = true; this._render();
      try {
        const id = await this._upload(t.files[0]);
        this._newImgs.push(id);
        this._draft.image = { id };
      } catch (err) {
        this._toast('Foto konnte nicht hochgeladen werden: ' + (err.message || err), true);
      }
      this._busy = false;
      this._render();
    }
  }

  if (!customElements.get('kochbuch-card')) customElements.define('kochbuch-card', KochbuchCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'kochbuch-card')) window.customCards.push({ type: 'kochbuch-card', name: 'Kochbuch', description: 'Eigene Rezepte mit Fotos, Kochmodus und Einkaufsliste' });
  console.info(`%c kochbuch-card ${VERSION} `, 'background:#1d4ed8;color:#fff;border-radius:4px');
})();
