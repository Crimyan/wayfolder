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

// Zmiana nazw wielu plików: szablon, znajdź i zamień, numeracja, wielkość liter, rozszerzenie.
// Podgląd na żywo, konflikty zaznaczone na czerwono. Całość to jedna pozycja w Dzienniku (Ctrl+Z cofa wszystko).

const DEFAULTS = { template: "{name}", find: "", replace: "", regex: false, matchCase: false, start: 1, step: 1, pad: 2, case: "keep", ext: "keep", extValue: "", order: "selection" };
let opt = { ...DEFAULTS };
let items = []; // { path, name, isDir, modified }
let taken = new Map(); // folder (lowercase) -> Set nazw (lowercase) już w folderze
let busy = false;
let lastErrors = [];

const BAD = /[\\/:*?"<>|]/;

function pad(n, w) { const s = String(Math.abs(n)); return (n < 0 ? "-" : "") + (s.length >= w ? s : "0".repeat(w - s.length) + s); }
function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s_\-.(\[])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }

function ordered() {
  const list = items.slice();
  if (opt.order === "name") list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  if (opt.order === "date") list.sort((a, b) => (a.modified || 0) - (b.modified || 0));
  return list;
}

/** Nowe nazwy + błędy. Zwraca [{ it, name, error }] albo { fatal } przy złym wyrażeniu regularnym. */
function compute() {
  let re = null;
  if (opt.find) {
    try {
      re = opt.regex ? new RegExp(opt.find, opt.matchCase ? "g" : "gi") : new RegExp(escapeRe(opt.find), opt.matchCase ? "g" : "gi");
    } catch (e) {
      return { fatal: T("Błędne wyrażenie regularne: ", "Invalid regular expression: ") + e.message };
    }
  }
  const rows = ordered().map((it, i) => {
    const k = it.isDir ? -1 : it.name.lastIndexOf(".");
    let stem = k > 0 ? it.name.slice(0, k) : it.name;
    let ext = k > 0 ? it.name.slice(k + 1) : "";
    if (re) stem = stem.replace(re, opt.replace);
    const num = pad(Number(opt.start) + i * Number(opt.step), Math.max(1, Math.min(10, Number(opt.pad) || 1)));
    let out = (opt.template || "{name}")
      .replace(/\{name\}/g, stem)
      .replace(/\{n\}/g, num)
      .replace(/\{ext\}/g, ext)
      .replace(/\{date\}/g, fmtDate(it.modified))
      .replace(/\{folder\}/g, baseName(dirOf(it.path)));
    if (opt.case === "lower") out = out.toLowerCase();
    if (opt.case === "upper") out = out.toUpperCase();
    if (opt.case === "title") out = titleCase(out);
    if (!it.isDir) {
      if (opt.ext === "lower") ext = ext.toLowerCase();
      if (opt.ext === "upper") ext = ext.toUpperCase();
      if (opt.ext === "set") ext = opt.extValue.replace(/^\./, "").trim();
      if (opt.ext === "remove") ext = "";
    }
    const name = (ext ? `${out}.${ext}` : out).trim();
    return { it, name, error: "" };
  });
  // konflikty
  const sources = new Set(items.map((x) => x.path.toLowerCase()));
  const seen = new Map();
  for (const r of rows) {
    const key = (dirOf(r.it.path) + "\\" + r.name).toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const r of rows) {
    const dir = dirOf(r.it.path);
    const key = join(dir, r.name).toLowerCase();
    if (!r.name || BAD.test(r.name) || /[. ]$/.test(r.name)) r.error = T("błędna nazwa", "invalid name");
    else if (r.name.length > 240) r.error = T("za długa", "too long");
    else if (seen.get((dir + "\\" + r.name).toLowerCase()) > 1) r.error = T("powtarza się", "duplicate");
    else if (r.name.toLowerCase() !== r.it.name.toLowerCase() && taken.get(dir.toLowerCase())?.has(r.name.toLowerCase()) && !sources.has(key)) r.error = T("nazwa zajęta", "name taken");
  }
  return { rows };
}

function save() { wayfolder.storage.set("opt", opt).catch(() => {}); }
function set(k, v) { opt[k] = v; save(); draw(); }

function field(label, input) { return [el("span", { class: "muted" }, label), input]; }
function text(k, attrs = {}) {
  return el("input", { type: "text", value: String(opt[k]), oninput: (e) => { opt[k] = e.target.value; save(); drawPreview(); }, ...attrs });
}
function num(k, min, max) {
  return el("input", { type: "number", value: String(opt[k]), min: String(min), max: String(max), style: "width:72px", oninput: (e) => { opt[k] = e.target.value === "" ? 0 : Number(e.target.value); save(); drawPreview(); } });
}
function check(k, label) {
  return el("label", {}, el("input", { type: "checkbox", checked: !!opt[k], onchange: (e) => { opt[k] = e.target.checked; save(); drawPreview(); } }), label);
}

let previewBox, countBox, goBtn, templateInput;

function insertToken(tok) {
  const i = templateInput.selectionStart ?? templateInput.value.length;
  const j = templateInput.selectionEnd ?? i;
  templateInput.value = templateInput.value.slice(0, i) + tok + templateInput.value.slice(j);
  opt.template = templateInput.value;
  save();
  drawPreview();
  templateInput.focus();
  templateInput.setSelectionRange(i + tok.length, i + tok.length);
}

function draw() {
  templateInput = text("template", { style: "flex:1;min-width:200px", spellcheck: false });
  const tokens = [["{name}", T("nazwa", "name")], ["{n}", T("numer", "number")], ["{date}", T("data zmiany", "date modified")], ["{folder}", T("folder", "folder")], ["{ext}", T("rozszerzenie", "extension")]];
  previewBox = el("div", { style: "flex:1;min-height:120px;overflow:auto;border:1px solid var(--border);border-radius:10px" });
  countBox = el("span", { class: "muted small" });
  goBtn = el("button", { class: "btn primary", onclick: apply });
  render(
    el("div", { style: "display:flex;flex-direction:column;gap:12px;height:calc(100vh - 32px)" },
      el("div", { class: "grid" },
        field(T("Nowa nazwa", "New name"), el("div", { class: "col" },
          el("div", { class: "row" }, templateInput),
          el("div", { class: "row" }, tokens.map(([t, l]) => el("button", { class: "btn small", title: t, onclick: () => insertToken(t) }, `+ ${l}`)), el("span", { class: "spacer" }),
            el("button", { class: "btn ghost small", onclick: () => { opt = { ...DEFAULTS }; save(); draw(); } }, T("Wyczyść", "Reset"))))),
        field(T("Znajdź", "Find"), el("div", { class: "row" }, text("find", { style: "width:180px", spellcheck: false }), el("span", { class: "muted" }, T("zamień na", "replace with")), text("replace", { style: "width:180px", spellcheck: false }), check("regex", T("wyrażenie regularne", "regex")), check("matchCase", T("wielkość liter", "match case")))),
        field(T("Numer {n}", "Number {n}"), el("div", { class: "row" }, el("span", { class: "muted small" }, T("od", "start")), num("start", -99999, 999999), el("span", { class: "muted small" }, T("co", "step")), num("step", -1000, 1000), el("span", { class: "muted small" }, T("cyfr", "digits")), num("pad", 1, 10),
          el("span", { class: "muted small", style: "margin-left:8px" }, T("kolejność", "order")),
          seg([["selection", T("jak zaznaczone", "as selected")], ["name", T("nazwa", "name")], ["date", T("data", "date")]], opt.order, (v) => set("order", v)))),
        field(T("Litery", "Case"), seg([["keep", T("bez zmian", "keep")], ["lower", T("małe", "lower")], ["upper", T("WIELKIE", "UPPER")], ["title", T("Pierwsze Wielkie", "Title Case")]], opt.case, (v) => set("case", v))),
        field(T("Rozszerzenie", "Extension"), el("div", { class: "row" },
          seg([["keep", T("bez zmian", "keep")], ["lower", T("małe", "lower")], ["upper", T("WIELKIE", "UPPER")], ["set", T("zmień na", "change to")], ["remove", T("usuń", "remove")]], opt.ext, (v) => set("ext", v)),
          opt.ext === "set" ? text("extValue", { style: "width:90px", placeholder: "png" }) : null)),
      ),
      previewBox,
      el("div", { class: "row" }, countBox, el("span", { class: "spacer" }), el("button", { class: "btn", onclick: () => wayfolder.ui.panel.close() }, T("Anuluj", "Cancel")), goBtn),
    ),
  );
  drawPreview();
}

function drawPreview() {
  const res = compute();
  if (res.fatal) {
    previewBox.replaceChildren(el("p", { class: "warn", style: "padding:12px" }, res.fatal));
    goBtn.disabled = true;
    goBtn.textContent = T("Zmień nazwy", "Rename");
    countBox.textContent = "";
    return;
  }
  const changed = res.rows.filter((r) => r.name !== r.it.name);
  const bad = res.rows.filter((r) => r.error);
  const shown = res.rows.slice(0, 1000);
  previewBox.replaceChildren(...[
    el("table", {},
      el("thead", {}, el("tr", {}, el("th", { style: "width:50%" }, T("Teraz", "Current")), el("th", { style: "width:50%" }, T("Po zmianie", "New")))),
      el("tbody", {}, shown.map((r) =>
        el("tr", { title: r.error || "" },
          el("td", { class: r.name === r.it.name ? "muted" : "" }, r.it.name),
          el("td", { class: r.error ? "warn" : r.name === r.it.name ? "muted" : "" }, r.name + (r.error ? `  — ${r.error}` : ""))))),
    ),
    res.rows.length > shown.length ? el("p", { class: "muted small", style: "padding:8px" }, T(`…i ${res.rows.length - shown.length} więcej`, `…and ${res.rows.length - shown.length} more`)) : null,
    lastErrors.length ? el("div", { class: "card", style: "margin:8px" }, el("b", { class: "warn" }, T("Nie udało się:", "Failed:")), el("div", { class: "small" }, lastErrors.slice(0, 20).map((e) => el("div", {}, e)))) : null,
  ].filter(Boolean));
  countBox.textContent = bad.length
    ? T(`${bad.length} z błędem – popraw, żeby kontynuować`, `${bad.length} with errors – fix them to continue`)
    : T(`${changed.length} z ${res.rows.length} zmieni nazwę · „Cofnij” cofa całość`, `${changed.length} of ${res.rows.length} will change · Undo reverts all`);
  goBtn.disabled = busy || !!bad.length || !changed.length;
  goBtn.textContent = busy ? T("Zmieniam…", "Renaming…") : T(`Zmień nazwy (${changed.length})`, `Rename (${changed.length})`);
}

async function apply() {
  const res = compute();
  if (res.fatal) return;
  const pairs = res.rows.filter((r) => !r.error && r.name !== r.it.name).map((r) => [r.it.path, r.name]);
  if (!pairs.length) return;
  busy = true;
  drawPreview();
  try {
    const r = await wayfolder.files.renameMany(pairs);
    lastErrors = r.errors.map((e) => e.replace(/: exists$/, T(": nazwa zajęta", ": name taken")).replace(/: name_cycle$/, T(": zamiana nazw w kółko – zrób to w dwóch krokach", ": names swap in a circle – do it in two steps")));
    wayfolder.toast(T(`Zmieniono nazwy: ${r.done}`, `Renamed: ${r.done}`) + (r.errors.length ? T(` · błędy: ${r.errors.length}`, ` · errors: ${r.errors.length}`) : ""));
    if (!r.errors.length) {
      busy = false;
      wayfolder.ui.panel.close();
      return;
    }
    // zostawiamy okno z błędami; pliki, które się udały, mają już nowe nazwy
    const renamed = new Map(pairs.map(([p, n]) => [p, n]));
    const failed = new Set(r.errors.map((e) => e.slice(0, e.lastIndexOf(":"))));
    items = items.map((it) => (renamed.has(it.path) && !failed.has(it.name) ? { ...it, name: renamed.get(it.path), path: join(dirOf(it.path), renamed.get(it.path)) } : it));
  } catch (e) {
    lastErrors = [String(e.message || e)];
  }
  busy = false;
  await loadTaken();
  draw();
}

async function loadTaken() {
  taken = new Map();
  const dirs = [...new Set(items.map((it) => dirOf(it.path)))];
  for (const d of dirs) {
    try {
      const list = await wayfolder.files.list(d);
      taken.set(d.toLowerCase(), new Set(list.map((e) => e.name.toLowerCase())));
      // data zmiany do {date}
      const byPath = new Map(list.map((e) => [e.path.toLowerCase(), e]));
      items = items.map((it) => { const e = byPath.get(it.path.toLowerCase()); return e ? { ...it, isDir: e.isDir, modified: e.modified } : it; });
    } catch {
      /* folder niedostępny – bez sprawdzania zajętych nazw */
    }
  }
}

async function open(paths) {
  items = paths.map((p) => ({ path: p, name: baseName(p), isDir: false, modified: null }));
  lastErrors = [];
  const saved = await wayfolder.storage.get("opt").catch(() => null);
  if (saved && typeof saved === "object") opt = { ...DEFAULTS, ...saved };
  await loadTaken();
  draw();
  await wayfolder.ui.panel.open({ title: T(`Zmiana nazw – ${items.length} ${items.length === 1 ? "element" : "elementów"}`, `Batch rename – ${items.length} item${items.length === 1 ? "" : "s"}`), width: 860, height: 640 });
  templateInput.focus();
}

async function openFolder(folder) {
  const list = await wayfolder.files.list(folder);
  const files = list.filter((e) => !e.isDir).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return wayfolder.toast(T("W tym folderze nie ma plików", "No files in this folder"));
  await open(files.map((f) => f.path));
}

wayfolder.menu.add({ id: "rename", label: T("Zmień nazwy wielu…", "Batch rename…"), when: { files: true, folders: true }, run: (ctx) => open(ctx.paths) });
wayfolder.menu.add({ id: "rename-folder", label: T("Zmień nazwy plików tutaj…", "Batch rename files here…"), when: { background: true }, run: (ctx) => openFolder(ctx.folder) });
wayfolder.commands.add({ id: "rename-cmd", label: T("Zmień nazwy plików w tym folderze…", "Batch rename files in this folder…"), run: (ctx) => (ctx.paths && ctx.paths.length ? open(ctx.paths) : openFolder(ctx.folder)) });
