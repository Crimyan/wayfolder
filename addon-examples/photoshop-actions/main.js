// ---- wspólne drobiazgi (wklejane na początek każdego dodatku przy budowaniu ZIP-a) ----
const PL = wayfolder.lang === "pl";
const T = (pl, en) => (PL ? pl : en);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const baseName = (p) => p.slice(p.lastIndexOf("\\") + 1);
const dirOf = (p) => { const d = p.slice(0, p.lastIndexOf("\\")); return /^[A-Za-z]:$/.test(d) ? d + "\\" : d; };
const join = (d, n) => (d.endsWith("\\") ? d + n : d + "\\" + n);
const extOf = (p) => { const n = baseName(p); const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
function seg(options, value, onChange) {
  const box = el("span", { class: "seg", role: "group" });
  const draw = (v) => {
    box.replaceChildren(...options.map(([val, label]) => el("button", { class: v === val ? "on" : "", "aria-pressed": String(v === val), onclick: () => { draw(val); onChange(val); } }, label)));
  };
  draw(value);
  return box;
}
function render(...kids) { document.body.replaceChildren(...kids.flat(Infinity).filter(Boolean)); }
const IMAGE_EXT = ["psd", "psb", "png", "jpg", "jpeg", "jpe", "jfif", "tga", "tif", "tiff", "bmp", "gif", "webp", "exr", "hdr", "dds", "qoi", "ico", "pnm", "ppm", "pgm", "avif"];
// ---- koniec wspólnych ----

// Akcje Photoshopa na wielu plikach: wybierasz zestaw i akcję (lista wczytana z Photoshopa),
// a dodatek otwiera każdy plik, odtwarza akcję i zapisuje wynik (kopia w podfolderze albo nadpisanie).
// Działa przez skrypt JSX uruchamiany w Photoshopie – Photoshop może za pierwszym razem zapytać, czy go uruchomić.

const DEFAULTS = { exe: "", set: "", action: "", mode: "copy", format: "png", sub: "photoshop", actions: [] };
let opt = { ...DEFAULTS };
let paths = [];
let state = ""; // "", "loading", "running"
let message = null; // { ok, text, list }
let stopPoll = null;

const PS_EXT = ["psd", "psb", "png", "jpg", "jpeg", "tif", "tiff", "tga", "bmp", "gif", "webp"];

function save() { wayfolder.storage.set("opt", opt).catch(() => {}); }
function set(k, v) { opt[k] = v; save(); draw(); }

/** Najnowszy Photoshop w Program Files. */
async function findPhotoshop() {
  for (const root of ["C:\\Program Files\\Adobe", "C:\\Program Files (x86)\\Adobe"]) {
    let list = [];
    try { list = await wayfolder.files.list(root); } catch { continue; }
    const dirs = list.filter((e) => e.isDir && /^Adobe Photoshop/i.test(e.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const d of dirs) {
      const exe = join(d.path, "Photoshop.exe");
      if (await wayfolder.files.info(exe).catch(() => null)) return exe;
    }
  }
  return "";
}

/** Tekst JS do wstawienia w JSX (ExtendScript rozumie zapis JSON dla napisów). */
const q = (s) => JSON.stringify(String(s));
const fwd = (p) => p.replace(/\\/g, "/");

const JSX_HEAD = `#target photoshop
function q(s){ return '"' + String(s).replace(/\\\\/g,'\\\\\\\\').replace(/"/g,'\\\\"').replace(/\\r/g,'').replace(/\\n/g,'\\\\n') + '"'; }
function writeOut(path, text){ var f = new File(path); f.encoding = "UTF-8"; f.open("w"); f.write(text); f.close(); }
`;

function listJsx(out) {
  return JSX_HEAD + `
(function(){
  var sets = [], i = 1;
  while (i < 500) {
    var ref = new ActionReference(); ref.putIndex(charIDToTypeID("ASet"), i);
    var d; try { d = executeActionGet(ref); } catch (e) { break; }
    var name = d.getString(charIDToTypeID("Nm  "));
    var n = d.hasKey(charIDToTypeID("NmbC")) ? d.getInteger(charIDToTypeID("NmbC")) : 0;
    var acts = [];
    for (var j = 1; j <= n; j++) {
      var r = new ActionReference(); r.putIndex(charIDToTypeID("Actn"), j); r.putIndex(charIDToTypeID("ASet"), i);
      try { acts.push(q(executeActionGet(r).getString(charIDToTypeID("Nm  ")))); } catch (e) {}
    }
    sets.push('{"set":' + q(name) + ',"actions":[' + acts.join(",") + ']}');
    i++;
  }
  writeOut(${q(fwd(out))}, '{"sets":[' + sets.join(",") + ']}');
})();
`;
}

function runJsx(out) {
  return JSX_HEAD + `
(function(){
  var files = ${JSON.stringify(paths.map(fwd))};
  var setName = ${q(opt.set)}, actName = ${q(opt.action)}, mode = ${q(opt.mode)}, fmt = ${q(opt.format)}, sub = ${q(opt.sub || "photoshop")};
  var ok = 0, errs = [];
  var old = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;
  for (var i = 0; i < files.length; i++) {
    try {
      var f = new File(files[i]);
      var doc = app.open(f);
      app.doAction(actName, setName);
      doc = app.activeDocument;
      if (mode === "overwrite") { doc.save(); doc.close(SaveOptions.DONOTSAVECHANGES); }
      else if (mode === "copy") {
        var folder = new Folder(f.parent.fsName + "/" + sub); if (!folder.exists) folder.create();
        var stem = decodeURI(f.name).replace(/\\.[^.]+$/, "");
        var target = new File(folder.fsName + "/" + stem + "." + fmt), k = 2;
        while (target.exists) { target = new File(folder.fsName + "/" + stem + " (" + k + ")." + fmt); k++; }
        var o;
        if (fmt === "png") { o = new PNGSaveOptions(); }
        else if (fmt === "jpg") { o = new JPEGSaveOptions(); o.quality = 11; }
        else { o = new PhotoshopSaveOptions(); o.layers = true; }
        doc.saveAs(target, o, true, Extension.LOWERCASE);
        doc.close(SaveOptions.DONOTSAVECHANGES);
      }
      ok++;
    } catch (e) { errs.push(q(decodeURI(new File(files[i]).name) + ": " + e.message)); }
  }
  app.displayDialogs = old;
  writeOut(${q(fwd(out))}, '{"done":' + ok + ',"errors":[' + errs.join(",") + ']}');
})();
`;
}

/** Uruchamia skrypt w Photoshopie i czeka na plik z wynikiem. */
async function runInPhotoshop(jsx, timeoutSec) {
  if (!opt.exe) throw new Error(T("Podaj ścieżkę do Photoshop.exe", "Enter the path to Photoshop.exe"));
  const dir = await wayfolder.files.tempDir();
  const stamp = Date.now();
  const script = join(dir, `wayfolder-${stamp}.jsx`);
  const out = join(dir, `wayfolder-${stamp}.json`);
  // ExtendScript może czytać plik w stronie kodowej systemu – znaki spoza ASCII (np. „ą” w ścieżkach) zapisujemy jako \uXXXX
  const ascii = jsx(out).replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  await wayfolder.files.writeText(script, ascii);
  await wayfolder.run(opt.exe, [script]);
  return new Promise((res, rej) => {
    const t0 = Date.now();
    let stopped = false;
    stopPoll = () => { stopped = true; rej(new Error(T("Przerwano czekanie (Photoshop może nadal pracować)", "Stopped waiting (Photoshop may still be working)"))); };
    const tick = async () => {
      if (stopped) return;
      try {
        const text = await wayfolder.files.readText(out);
        stopPoll = null;
        return res(JSON.parse(text));
      } catch { /* jeszcze nie ma */ }
      if (Date.now() - t0 > timeoutSec * 1000) { stopPoll = null; return rej(new Error(T("Photoshop nie odpowiedział – sprawdź, czy nie czeka na potwierdzenie uruchomienia skryptu", "Photoshop did not answer – check whether it asks to confirm running the script"))); }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1500);
  });
}

async function loadActions() {
  state = "loading";
  message = null;
  draw();
  try {
    const r = await runInPhotoshop(listJsx, 180);
    opt.actions = (r.sets || []).filter((s) => s.actions && s.actions.length);
    if (!opt.actions.some((s) => s.set === opt.set)) { opt.set = opt.actions[0]?.set || ""; opt.action = opt.actions[0]?.actions[0] || ""; }
    save();
    message = { ok: true, text: T(`Wczytano zestawy akcji: ${opt.actions.length}`, `Loaded action sets: ${opt.actions.length}`) };
  } catch (e) {
    message = { ok: false, text: String(e.message || e) };
  }
  state = "";
  draw();
}

async function start() {
  if (!opt.set || !opt.action) { message = { ok: false, text: T("Wybierz zestaw i akcję", "Choose a set and an action") }; return draw(); }
  if (opt.mode === "overwrite" && !(await wayfolder.ui.confirm(T(`Nadpisać ${paths.length} plików? Tego nie da się cofnąć w Wayfolderze.`, `Overwrite ${paths.length} files? This cannot be undone in Wayfolder.`)))) return;
  state = "running";
  message = null;
  draw();
  try {
    const r = await runInPhotoshop(runJsx, 60 + paths.length * 120);
    message = { ok: !r.errors.length, text: T(`Gotowe: ${r.done} z ${paths.length}`, `Done: ${r.done} of ${paths.length}`), list: r.errors };
    wayfolder.toast(message.text);
  } catch (e) {
    message = { ok: false, text: String(e.message || e) };
  }
  state = "";
  draw();
}

function draw() {
  const sets = opt.actions || [];
  const cur = sets.find((s) => s.set === opt.set);
  const textOr = (k, list, ph) => list && list.length
    ? el("select", { style: "min-width:220px", onchange: (e) => { opt[k] = e.target.value; if (k === "set") opt.action = (sets.find((s) => s.set === opt.set)?.actions || [])[0] || ""; save(); draw(); } },
        list.map((v) => el("option", { value: v, selected: v === opt[k] }, v)))
    : el("input", { type: "text", value: opt[k], placeholder: ph, style: "width:220px", oninput: (e) => { opt[k] = e.target.value; save(); } });
  render(
    el("div", { style: "display:flex;flex-direction:column;gap:14px" },
      el("p", { class: "muted" }, T(`Pliki: ${paths.length} – ${paths.slice(0, 4).map(baseName).join(", ")}${paths.length > 4 ? "…" : ""}`, `Files: ${paths.length} – ${paths.slice(0, 4).map(baseName).join(", ")}${paths.length > 4 ? "…" : ""}`)),
      el("div", { class: "grid" },
        el("span", { class: "muted" }, "Photoshop"),
        el("div", { class: "row" },
          el("input", { type: "text", value: opt.exe, placeholder: "C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe", style: "flex:1;min-width:260px", spellcheck: false, oninput: (e) => { opt.exe = e.target.value.trim().replace(/^"|"$/g, ""); save(); } }),
          el("button", { class: "btn small", onclick: async () => { const exe = await findPhotoshop(); if (exe) set("exe", exe); else { message = { ok: false, text: T("Nie znaleziono Photoshopa – wpisz ścieżkę ręcznie", "Photoshop not found – enter the path") }; draw(); } } }, T("Znajdź", "Find"))),
        el("span", { class: "muted" }, T("Zestaw", "Set")),
        el("div", { class: "row" }, textOr("set", sets.map((s) => s.set), T("np. Domyślne akcje", "e.g. Default Actions")),
          el("button", { class: "btn small", disabled: !!state, onclick: loadActions }, state === "loading" ? T("Wczytuję…", "Loading…") : T("Wczytaj akcje z Photoshopa", "Load actions from Photoshop"))),
        el("span", { class: "muted" }, T("Akcja", "Action")),
        textOr("action", cur ? cur.actions : [], T("nazwa akcji", "action name")),
        el("span", { class: "muted" }, T("Po akcji", "After the action")),
        el("div", { class: "row" },
          seg([["copy", T("zapisz kopię", "save a copy")], ["overwrite", T("nadpisz plik", "overwrite file")], ["open", T("zostaw otwarte", "leave open")]], opt.mode, (v) => set("mode", v))),
        opt.mode === "copy" ? el("span", { class: "muted" }, T("Kopia", "Copy")) : null,
        opt.mode === "copy" ? el("div", { class: "row" },
          seg([["png", "PNG"], ["jpg", "JPG"], ["psd", "PSD"]], opt.format, (v) => set("format", v)),
          el("span", { class: "muted small" }, T("do podfolderu", "into subfolder")),
          el("input", { type: "text", value: opt.sub, style: "width:140px", oninput: (e) => { opt.sub = e.target.value.replace(/[\\/:*?"<>|]/g, ""); save(); } })) : null,
      ),
      opt.mode === "overwrite" ? el("p", { class: "warn small" }, T("Nadpisanych plików nie cofniesz w Dzienniku Wayfoldera.", "Overwritten files cannot be undone in Wayfolder’s Journal.")) : null,
      message ? el("div", { class: "card" }, el("b", { class: message.ok ? "ok" : "warn" }, message.text),
        message.list && message.list.length ? el("div", { class: "small", style: "margin-top:6px" }, message.list.slice(0, 12).map((e) => el("div", {}, e))) : null) : null,
      el("div", { class: "row" },
        el("span", { class: "muted small" }, state ? T("Photoshop pracuje – możesz przełączyć się do niego i obserwować", "Photoshop is working – you can switch to it and watch") : T("Photoshop może zapytać, czy uruchomić skrypt – potwierdź", "Photoshop may ask to run the script – confirm it")),
        el("span", { class: "spacer" }),
        state ? el("button", { class: "btn", onclick: () => stopPoll && stopPoll() }, T("Przestań czekać", "Stop waiting")) : el("button", { class: "btn", onclick: () => wayfolder.ui.panel.close() }, T("Zamknij", "Close")),
        el("button", { class: "btn primary", disabled: !!state, onclick: start }, state === "running" ? T("Pracuję…", "Working…") : T(`Uruchom na ${paths.length}`, `Run on ${paths.length}`))),
    ),
  );
}

async function open(list) {
  paths = list.filter((p) => PS_EXT.includes(extOf(p)));
  if (!paths.length) return wayfolder.toast(T("Zaznacz pliki, które otworzy Photoshop (PSD, PNG, JPG, TIFF…)", "Select files Photoshop can open (PSD, PNG, JPG, TIFF…)"));
  const saved = await wayfolder.storage.get("opt").catch(() => null);
  if (saved && typeof saved === "object") opt = { ...DEFAULTS, ...saved };
  if (!opt.exe) { opt.exe = await findPhotoshop(); save(); }
  message = null;
  draw();
  await wayfolder.ui.panel.open({ title: T(`Akcja Photoshopa – ${paths.length} plików`, `Photoshop action – ${paths.length} files`), width: 760, height: 560 });
}

wayfolder.menu.add({ id: "action", label: T("Uruchom akcję Photoshopa…", "Run Photoshop action…"), when: { files: true, ext: PS_EXT }, run: (ctx) => open(ctx.paths) });
