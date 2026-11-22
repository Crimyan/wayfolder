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

// Eksport obrazów: PSD, PSB, PNG, TGA, TIFF, EXR, DDS… → PNG / JPG / WebP, opcjonalnie zmniejszone.
// Nowe pliki trafiają do Dziennika – Ctrl+Z odkłada je do kosza. Oryginały zostają nietknięte.

const DEFAULTS = { format: "png", quality: 90, resize: "none", maxSize: 2048, where: "sub", sub: "export", suffix: "" };
let opt = { ...DEFAULTS };
let paths = [];
let busy = false;
let result = null; // { done, errors }

const ERR = {
  psd_no_composite: T("PSD bez spłaszczonego obrazu – zapisz go w Photoshopie z opcją „Maksymalizuj zgodność”", "PSD has no flattened image – save it in Photoshop with “Maximize Compatibility”"),
  cannot_read_image: T("nie da się odczytać obrazu", "cannot read the image"),
};
const errText = (e) => { const i = e.lastIndexOf(": "); const code = e.slice(i + 2); return ERR[code] ? e.slice(0, i) + ": " + ERR[code] : e; };

function save() { wayfolder.storage.set("opt", opt).catch(() => {}); }
function set(k, v) { opt[k] = v; save(); draw(); }

const thumbs = new Map();
function thumb(p) {
  const img = el("img", { alt: "", style: "width:72px;height:72px;object-fit:contain;border-radius:8px;background:var(--tile)" });
  if (thumbs.has(p)) img.src = thumbs.get(p);
  else
    wayfolder.files.imageUrl(p, 128).then((u) => { if (u) { thumbs.set(p, u); img.src = u; } }).catch(() => {});
  return el("div", { class: "col", style: "width:80px;align-items:center;gap:2px" }, img, el("span", { class: "small muted", style: "max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: baseName(p) }, baseName(p)));
}

function destFor(p) { return opt.where === "sub" ? join(dirOf(p), (opt.sub || "export").trim()) : dirOf(p); }
function exampleName() {
  if (!paths.length) return "";
  const n = baseName(paths[0]);
  const stem = n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n;
  return (opt.where === "sub" ? (opt.sub || "export") + "\\" : "") + stem + opt.suffix + "." + opt.format;
}

function draw() {
  const shown = paths.slice(0, 14);
  render(
    el("div", { style: "display:flex;flex-direction:column;gap:14px" },
      el("div", { class: "row", style: "gap:6px;align-items:flex-start" }, shown.map(thumb),
        paths.length > shown.length ? el("span", { class: "muted", style: "align-self:center" }, `+${paths.length - shown.length}`) : null),
      el("div", { class: "grid" },
        el("span", { class: "muted" }, T("Format", "Format")),
        el("div", { class: "row" }, seg([["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"]], opt.format, (v) => set("format", v)),
          el("span", { class: "muted small" }, opt.format === "png" ? T("bez strat, z przezroczystością", "lossless, keeps transparency") : opt.format === "webp" ? T("bez strat, z przezroczystością, mniejszy od PNG", "lossless, keeps transparency, smaller than PNG") : T("bez przezroczystości (tło białe)", "no transparency (white background)"))),
        opt.format === "jpg" ? el("span", { class: "muted" }, T("Jakość", "Quality")) : null,
        opt.format === "jpg" ? el("div", { class: "row" },
          el("input", { type: "range", min: "40", max: "100", value: String(opt.quality), style: "width:200px", oninput: (e) => { opt.quality = Number(e.target.value); qv.textContent = String(opt.quality); save(); } }),
          (qv = el("span", {}, String(opt.quality)))) : null,
        el("span", { class: "muted" }, T("Rozmiar", "Size")),
        el("div", { class: "row" },
          seg([["none", T("oryginalny", "original")], ["max", T("dłuższy bok najwyżej", "longest side up to")]], opt.resize, (v) => set("resize", v)),
          opt.resize === "max" ? [
            el("input", { type: "number", min: "16", max: "16384", value: String(opt.maxSize), style: "width:84px", oninput: (e) => { opt.maxSize = Number(e.target.value) || 2048; save(); } }),
            el("span", { class: "muted small" }, "px"),
            [512, 1024, 2048, 4096].map((n) => el("button", { class: "btn small" + (opt.maxSize === n ? " primary" : ""), onclick: () => set("maxSize", n) }, String(n))),
          ] : null),
        el("span", { class: "muted" }, T("Zapisz do", "Save to")),
        el("div", { class: "row" },
          seg([["sub", T("podfolderu", "subfolder")], ["same", T("tego samego folderu", "same folder")]], opt.where, (v) => set("where", v)),
          opt.where === "sub" ? el("input", { type: "text", value: opt.sub, style: "width:140px", oninput: (e) => { opt.sub = e.target.value.replace(/[\\/:*?"<>|]/g, ""); save(); ex.textContent = exampleName(); } }) : null),
        el("span", { class: "muted" }, T("Dopisek do nazwy", "Name suffix")),
        el("div", { class: "row" }, el("input", { type: "text", value: opt.suffix, placeholder: T("np. _web", "e.g. _web"), style: "width:140px", oninput: (e) => { opt.suffix = e.target.value.replace(/[\\/:*?"<>|]/g, ""); save(); ex.textContent = exampleName(); } }),
          (ex = el("span", { class: "muted small" }, exampleName()))),
      ),
      result ? el("div", { class: "card" },
        el("b", { class: result.errors.length ? "warn" : "ok" }, T(`Zapisano ${result.done} z ${paths.length}`, `Saved ${result.done} of ${paths.length}`)),
        result.errors.length ? el("div", { class: "small", style: "margin-top:6px" }, result.errors.slice(0, 12).map((e) => el("div", {}, errText(e)))) : null) : null,
      el("div", { class: "row" },
        el("span", { class: "muted small" }, T("Istniejące pliki nie są nadpisywane · „Cofnij” cofa eksport", "Existing files are never overwritten · Undo reverts the export")),
        el("span", { class: "spacer" }),
        el("button", { class: "btn", onclick: () => wayfolder.ui.panel.close() }, result ? T("Zamknij", "Close") : T("Anuluj", "Cancel")),
        el("button", { class: "btn primary", disabled: busy, onclick: run }, busy ? T("Eksportuję…", "Exporting…") : T(`Eksportuj (${paths.length})`, `Export (${paths.length})`))),
    ),
  );
}
let qv, ex;

async function run() {
  busy = true;
  result = null;
  draw();
  const groups = new Map();
  for (const p of paths) {
    const d = destFor(p);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(p);
  }
  const total = { done: 0, errors: [] };
  for (const [dest, list] of groups) {
    try {
      const r = await wayfolder.images.export(list, dest, { format: opt.format, quality: opt.quality, maxSize: opt.resize === "max" ? opt.maxSize : 0, suffix: opt.suffix });
      total.done += r.done;
      total.errors.push(...r.errors);
    } catch (e) {
      total.errors.push(String(e.message || e));
    }
  }
  busy = false;
  result = total;
  wayfolder.toast(T(`Wyeksportowano: ${total.done}`, `Exported: ${total.done}`) + (total.errors.length ? T(` · błędy: ${total.errors.length}`, ` · errors: ${total.errors.length}`) : ""));
  if (!total.errors.length) return wayfolder.ui.panel.close();
  draw();
}

async function open(list) {
  paths = list.filter((p) => IMAGE_EXT.includes(extOf(p)) || ["ai", "eps", "pdf", "blend"].includes(extOf(p)));
  if (!paths.length) return wayfolder.toast(T("Zaznacz obrazy do eksportu", "Select images to export"));
  result = null;
  const saved = await wayfolder.storage.get("opt").catch(() => null);
  if (saved && typeof saved === "object") opt = { ...DEFAULTS, ...saved };
  draw();
  await wayfolder.ui.panel.open({ title: T(`Eksport obrazów – ${paths.length}`, `Export images – ${paths.length}`), width: 720, height: 600 });
}

wayfolder.menu.add({ id: "export", label: T("Eksportuj jako PNG / JPG / WebP…", "Export as PNG / JPG / WebP…"), when: { files: true, ext: [...IMAGE_EXT, "ai", "eps", "pdf"] }, run: (ctx) => open(ctx.paths) });
wayfolder.commands.add({ id: "export-cmd", label: T("Eksportuj zaznaczone obrazy…", "Export selected images…"), run: (ctx) => open(ctx.paths || []) });
