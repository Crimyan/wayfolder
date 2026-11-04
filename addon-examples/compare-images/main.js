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

// Porównanie dwóch obrazów: obok siebie, suwak, przenikanie i różnica (z procentem zmienionych pikseli).
// Działa na podglądach do 2048 px – dobre do sprawdzenia wersji, poprawek i eksportów.

let A = null, B = null; // { path, url, img }
let mode = "slider";
let split = 50, fade = 50, gain = 4;
let stats = "";

function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = url; });
}

async function prepare(path) {
  const url = await wayfolder.files.imageUrl(path, 2048);
  if (!url) throw new Error(T(`Brak podglądu: ${baseName(path)}`, `No preview: ${baseName(path)}`));
  return { path, url, img: await loadImg(url) };
}

function info(x) {
  return el("div", { class: "col", style: "gap:0;min-width:0" },
    el("b", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: x.path }, baseName(x.path)),
    el("span", { class: "muted small" }, `${x.img.naturalWidth} × ${x.img.naturalHeight}${T(" (podgląd)", " (preview)")}`));
}

const stage = () => el("div", { id: "stage", style: "position:relative;flex:1;min-height:0;border-radius:10px;overflow:hidden;background:repeating-conic-gradient(var(--tile) 0 25%, var(--bg) 0 50%) 0 0/16px 16px;user-select:none" });
const fit = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none";

function view() {
  const st = stage();
  if (mode === "side") {
    st.style.display = "flex";
    st.style.gap = "6px";
    st.style.background = "none";
    for (const x of [A, B]) st.append(el("div", { style: "position:relative;flex:1;border-radius:10px;overflow:hidden;background:repeating-conic-gradient(var(--tile) 0 25%, var(--bg) 0 50%) 0 0/16px 16px" }, el("img", { src: x.url, style: fit })));
  } else if (mode === "slider") {
    const top = el("img", { src: B.url, style: fit + `;clip-path:inset(0 0 0 ${split}%)` });
    const line = el("div", { style: `position:absolute;top:0;bottom:0;left:${split}%;width:2px;margin-left:-1px;background:var(--accent);box-shadow:0 0 0 1px rgba(0,0,0,.25)` });
    st.append(el("img", { src: A.url, style: fit }), top, line,
      el("span", { class: "small", style: "position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:6px;background:var(--bg)" }, "A"),
      el("span", { class: "small", style: "position:absolute;right:8px;top:8px;padding:2px 8px;border-radius:6px;background:var(--bg)" }, "B"));
    const move = (e) => {
      const r = st.getBoundingClientRect();
      split = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
      top.style.clipPath = `inset(0 0 0 ${split}%)`;
      line.style.left = `${split}%`;
    };
    st.addEventListener("pointerdown", (e) => { st.setPointerCapture(e.pointerId); move(e); });
    st.addEventListener("pointermove", (e) => { if (e.buttons & 1) move(e); });
    st.style.cursor = "ew-resize";
  } else if (mode === "fade") {
    st.append(el("img", { src: A.url, style: fit }), el("img", { id: "fadeB", src: B.url, style: fit + `;opacity:${fade / 100}` }));
  } else {
    st.style.background = "#000";
    st.append(diffCanvas());
  }
  return st;
}

function diffCanvas() {
  const w = A.img.naturalWidth, h = A.img.naturalHeight;
  const c = el("canvas", { width: w, height: h, style: "position:absolute;inset:0;width:100%;height:100%;object-fit:contain" });
  try {
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(A.img, 0, 0, w, h);
    const a = g.getImageData(0, 0, w, h);
    g.clearRect(0, 0, w, h);
    g.drawImage(B.img, 0, 0, w, h); // B dopasowany do rozmiaru A
    const b = g.getImageData(0, 0, w, h);
    const out = g.createImageData(w, h);
    let changed = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]), dg = Math.abs(a.data[i + 1] - b.data[i + 1]), db = Math.abs(a.data[i + 2] - b.data[i + 2]), da = Math.abs(a.data[i + 3] - b.data[i + 3]);
      const m = Math.max(dr, dg, db, da);
      if (m > 12) changed++;
      out.data[i] = Math.min(255, dr * gain);
      out.data[i + 1] = Math.min(255, dg * gain);
      out.data[i + 2] = Math.min(255, db * gain);
      out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    const pct = (changed / (w * h)) * 100;
    stats = changed === 0 ? T("Bez widocznych różnic", "No visible differences") : T(`Różni się ${pct < 0.1 ? "<0,1" : pct.toFixed(1).replace(".", ",")}% pikseli`, `${pct < 0.1 ? "<0.1" : pct.toFixed(1)}% of pixels differ`);
    if (A.img.naturalWidth !== B.img.naturalWidth || A.img.naturalHeight !== B.img.naturalHeight) stats += T(" · inne wymiary – B dopasowany do A", " · different sizes – B scaled to A");
  } catch {
    // awaryjnie: mieszanie „różnica” w przeglądarce, bez statystyk
    stats = "";
    const box = el("div", { style: "position:absolute;inset:0;isolation:isolate" }, el("img", { src: A.url, style: fit }), el("img", { src: B.url, style: fit + ";mix-blend-mode:difference" }));
    return box;
  }
  return c;
}

function controls() {
  if (mode === "fade")
    return el("label", {}, "A", el("input", { type: "range", min: "0", max: "100", value: String(fade), style: "width:220px", oninput: (e) => { fade = Number(e.target.value); const b = document.getElementById("fadeB"); if (b) b.style.opacity = String(fade / 100); } }), "B");
  if (mode === "diff")
    return el("div", { class: "row" },
      el("label", {}, T("Wzmocnienie", "Boost"), el("input", { type: "range", min: "1", max: "16", value: String(gain), style: "width:140px", onchange: (e) => { gain = Number(e.target.value); draw(); } })),
      el("span", { class: stats.startsWith(T("Bez", "No")) ? "ok" : "warn" }, stats));
  if (mode === "slider") return el("span", { class: "muted small" }, T("Przeciągnij po obrazie, żeby przesunąć linię", "Drag across the image to move the line"));
  return null;
}

function draw() {
  const v = view(); // najpierw widok – liczy statystyki różnicy
  render(
    el("div", { style: "display:flex;flex-direction:column;gap:10px;height:calc(100vh - 32px)" },
      el("div", { class: "row", style: "flex-wrap:nowrap" },
        el("span", { class: "muted" }, "A"), info(A), el("button", { class: "btn small", title: T("Zamień A i B", "Swap A and B"), onclick: () => { [A, B] = [B, A]; draw(); } }, "⇄"), el("span", { class: "muted" }, "B"), info(B),
        el("span", { class: "spacer" }),
        seg([["side", T("Obok siebie", "Side by side")], ["slider", T("Suwak", "Slider")], ["fade", T("Przenikanie", "Fade")], ["diff", T("Różnica", "Difference")]], mode, (m) => { mode = m; wayfolder.storage.set("mode", m).catch(() => {}); draw(); })),
      v,
      el("div", { class: "row", style: "min-height:30px" }, controls(), el("span", { class: "spacer" }), el("button", { class: "btn", onclick: () => wayfolder.ui.panel.close() }, T("Zamknij", "Close"))),
    ),
  );
}

async function open(paths) {
  const imgs = paths.filter((p) => IMAGE_EXT.includes(extOf(p)) || ["ai", "pdf", "eps"].includes(extOf(p)));
  if (imgs.length < 2) return wayfolder.toast(T("Zaznacz dwa obrazy do porównania", "Select two images to compare"));
  if (imgs.length > 2) wayfolder.toast(T("Porównuję dwa pierwsze zaznaczone obrazy", "Comparing the first two selected images"));
  try {
    [A, B] = await Promise.all([prepare(imgs[0]), prepare(imgs[1])]);
  } catch (e) {
    return wayfolder.toast(String(e.message || e));
  }
  mode = (await wayfolder.storage.get("mode").catch(() => null)) || "slider";
  draw();
  await wayfolder.ui.panel.open({ title: T("Porównanie obrazów", "Compare images"), width: 1180, height: 780 });
}

wayfolder.menu.add({ id: "compare", label: T("Porównaj obrazy", "Compare images"), when: { files: true, min: 2, ext: [...IMAGE_EXT, "ai", "pdf", "eps"] }, run: (ctx) => open(ctx.paths) });
wayfolder.ui.panel.onClose(() => { A = B = null; render(); });
