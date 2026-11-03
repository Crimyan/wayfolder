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

// Game Assets: przygotowanie obrazów do silników gier (głównie 2D).
// Rozmiar i trim (potęga 2, wielokrotność 4, wspólny prostokąt dla sekwencji), atlas (MaxRects albo siatka),
// cięcie spritesheetu, pakowanie kanałów PBR (ORM, Mask Map), konwersja (PNG / TGA / DDS / EXR / WebP / JPG,
// odwrócenie G normal mapy, alpha bleeding) i raport „Sprawdź pliki”.
// Oryginały zostają nietknięte, a nowe pliki trafiają do Dziennika (Cofnij odkłada je do kosza).

// =====================================================================================================
// Piksele: obraz to { w, h, d } (d = Uint8ClampedArray RGBA)
// =====================================================================================================

const mk = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });
const isPot = (n) => n > 0 && (n & (n - 1)) === 0;
const nextPot = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const prevPot = (n) => { let p = 1; while (p * 2 <= n) p *= 2; return p; };
const nearPot = (n) => { const a = prevPot(n), b = nextPot(n); return n - a <= b - n ? a : b; };
const roundUp = (n, m) => Math.ceil(n / m) * m;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const stemOf = (p) => { const n = baseName(p); const i = n.lastIndexOf("."); return i > 0 ? n.slice(0, i) : n; };

/** Prostokąt nieprzezroczystych pikseli (alfa > próg) albo null, gdy obraz jest pusty. */
function bbox(im, thr) {
  const { w, h, d } = im;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const union = (a, b) => (!a ? b : !b ? a : (() => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; })());

/** Wycinek; poza obrazem przezroczystość. */
function crop(im, x, y, w, h) {
  const out = mk(w, h);
  blit(out, im, -x, -y);
  return out;
}

/** Kopiuje `src` do `dst` w (dx, dy), przycinając do granic. */
function blit(dst, src, dx, dy) {
  const sx0 = Math.max(0, -dx), sy0 = Math.max(0, -dy);
  const sx1 = Math.min(src.w, dst.w - dx), sy1 = Math.min(src.h, dst.h - dy);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  const len = (sx1 - sx0) * 4;
  for (let y = sy0; y < sy1; y++) {
    const s = (y * src.w + sx0) * 4;
    dst.d.set(src.d.subarray(s, s + len), ((y + dy) * dst.w + sx0 + dx) * 4);
  }
}

/** Skalowanie: najbliższy piksel albo dwuliniowe z mnożeniem przez alfę (bez obwódek); mocne
 *  zmniejszanie najpierw połówkami (uśrednianie 2×2). */
function resize(im, w, h, smooth = true) {
  if (im.w === w && im.h === h) return im;
  if (!smooth) {
    const out = mk(w, h), s = im.d, o = out.d;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(im.h - 1, Math.floor(((y + 0.5) * im.h) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(im.w - 1, Math.floor(((x + 0.5) * im.w) / w));
        const a = (sy * im.w + sx) * 4, b = (y * w + x) * 4;
        o[b] = s[a]; o[b + 1] = s[a + 1]; o[b + 2] = s[a + 2]; o[b + 3] = s[a + 3];
      }
    }
    return out;
  }
  while (im.w >= w * 2 && im.h >= h * 2) im = half(im);
  const out = mk(w, h), s = im.d, o = out.d, sw = im.w, sh = im.h;
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const yy = Math.max(0, Math.min(sh - 1, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(yy), y1 = Math.min(sh - 1, y0 + 1), ty = yy - y0;
    for (let x = 0; x < w; x++) {
      const xx = Math.max(0, Math.min(sw - 1, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(xx), x1 = Math.min(sw - 1, x0 + 1), tx = xx - x0;
      const idx = [(y0 * sw + x0) * 4, (y0 * sw + x1) * 4, (y1 * sw + x0) * 4, (y1 * sw + x1) * 4];
      const wt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const i = idx[k], al = s[i + 3] * wt[k];
        r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al;
      }
      const j = (y * w + x) * 4;
      if (a > 0) { o[j] = r / a; o[j + 1] = g / a; o[j + 2] = b / a; }
      o[j + 3] = a;
    }
  }
  return out;
}

function half(im) {
  const w = Math.max(1, im.w >> 1), h = Math.max(1, im.h >> 1), out = mk(w, h), s = im.d, o = out.d;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < 4; k++) {
      const i = ((Math.min(im.h - 1, y * 2 + (k >> 1))) * im.w + Math.min(im.w - 1, x * 2 + (k & 1))) * 4, al = s[i + 3];
      r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al;
    }
    const j = (y * w + x) * 4;
    if (a > 0) { o[j] = r / a; o[j + 1] = g / a; o[j + 2] = b / a; }
    o[j + 3] = a / 4;
  }
  return out;
}

/** Alpha bleeding: kolor przezroczystych pikseli z najbliższych widocznych (fala od krawędzi), alfa bez zmian.
 *  Dzięki temu filtrowanie i mipmapy w silniku nie dają ciemnych obwódek. */
function bleed(im, thr = 0) {
  const { w, h, d } = im, n = w * h;
  const known = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] > thr) { known[i] = 1; any = true; }
  if (!any) return im;
  const queued = new Uint8Array(n);
  let front = new Int32Array(n), fn = 0;
  const push = (arr, len, i) => { if (!known[i] && !queued[i]) { queued[i] = 1; arr[len] = i; return len + 1; } return len; };
  for (let i = 0; i < n; i++) {
    if (!known[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) fn = push(front, fn, yy * w + xx);
    }
  }
  let next = new Int32Array(n);
  while (fn > 0) {
    for (let k = 0; k < fn; k++) {
      const i = front[k], x = i % w, y = (i / w) | 0;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) {
          const j = yy * w + xx;
          if (known[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
        }
      }
      if (c) { d[i * 4] = r / c; d[i * 4 + 1] = g / c; d[i * 4 + 2] = b / c; }
    }
    for (let k = 0; k < fn; k++) known[front[k]] = 1;
    let nn = 0;
    for (let k = 0; k < fn; k++) {
      const i = front[k], x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) nn = push(next, nn, yy * w + xx);
      }
    }
    [front, next] = [next, front];
    fn = nn;
  }
  return im;
}

/** Powiela krawędzie prostokąta (x, y, w, h) w `dst` o `n` pikseli na zewnątrz (przeciw szwom w atlasie). */
function extrude(dst, x, y, w, h, n) {
  const d = dst.d, W = dst.w, H = dst.h;
  const cp = (sx, sy, tx, ty) => { if (tx < 0 || ty < 0 || tx >= W || ty >= H) return; const a = (sy * W + sx) * 4, b = (ty * W + tx) * 4; d[b] = d[a]; d[b + 1] = d[a + 1]; d[b + 2] = d[a + 2]; d[b + 3] = d[a + 3]; };
  for (let k = 1; k <= n; k++) for (let yy = y; yy < y + h; yy++) { cp(x, yy, x - k, yy); cp(x + w - 1, yy, x + w - 1 + k, yy); }
  for (let k = 1; k <= n; k++) for (let xx = x - n; xx < x + w + n; xx++) {
    const sx = Math.max(0, Math.min(W - 1, xx));
    cp(sx, y, xx, y - k); cp(sx, y + h - 1, xx, y + h - 1 + k);
  }
}

function flipGreen(im) { const d = im.d; for (let i = 1; i < d.length; i += 4) d[i] = 255 - d[i]; return im; }

function alphaRange(im) {
  let lo = 255, hi = 0;
  const d = im.d;
  for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a < lo) lo = a; if (a > hi) hi = a; if (lo === 0 && hi === 255) break; }
  return { lo, hi };
}

// ---------- MaxRects (najlepsze dopasowanie krótszego boku) ----------

/** Pakuje prostokąty { i, w, h } do strony W×H. Zwraca { placed: [{ i, x, y, w, h }], rest: [...] }. */
function maxRects(items, W, H) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const placed = [], rest = [];
  const sorted = [...items].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  for (const it of sorted) {
    let best = null, bs = Infinity, bl = Infinity;
    for (const f of free) {
      if (it.w <= f.w && it.h <= f.h) {
        const s = Math.min(f.w - it.w, f.h - it.h), l = Math.max(f.w - it.w, f.h - it.h);
        if (s < bs || (s === bs && l < bl)) { best = f; bs = s; bl = l; }
      }
    }
    if (!best) { rest.push(it); continue; }
    const r = { i: it.i, x: best.x, y: best.y, w: it.w, h: it.h };
    placed.push(r);
    const next = [];
    for (const f of free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
  }
  return { placed, rest };
}

/** Dzieli prostokąty na strony atlasu. `page`: "pot" | "mul4" | "any". Zwraca { pages: [{ w, h, rects }], tooBig: [i] }. */
function packPages(items, max, page) {
  const pages = [], tooBig = [];
  let left = items.filter((it) => (it.w <= max && it.h <= max) || (tooBig.push(it.i), false));
  const fitSize = (rects) => {
    let w = 1, h = 1;
    for (const r of rects) { w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h); }
    return page === "pot" ? [nextPot(w), nextPot(h)] : page === "mul4" ? [roundUp(w, 4), roundUp(h, 4)] : [w, h];
  };
  while (left.length) {
    let done = null;
    if (page === "pot") {
      // najmniejsza strona POT, na której mieści się wszystko, co zostało
      const area = left.reduce((s, it) => s + it.w * it.h, 0);
      const sizes = [];
      for (let w = 1; w <= max; w *= 2) for (let h = 1; h <= max; h *= 2) if (w * h >= area && Math.max(w, h) <= 2 * Math.min(w, h)) sizes.push([w, h]);
      sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));
      for (const [w, h] of sizes) {
        const r = maxRects(left, w, h);
        if (!r.rest.length) { done = { w, h, rects: r.placed }; left = []; break; }
      }
    }
    if (!done) {
      const r = maxRects(left, max, max);
      if (!r.placed.length) { tooBig.push(...left.map((it) => it.i)); break; }
      const [w, h] = fitSize(r.placed);
      done = { w: Math.min(w, max), h: Math.min(h, max), rects: r.placed };
      left = r.rest;
    }
    pages.push(done);
  }
  return { pages, tooBig };
}

/** Siatka równych komórek (spritesheet). Zwraca strony jak packPages. */
function gridPages(items, cw, ch, gap, cols, max, page) {
  const fitCols = Math.max(1, Math.floor((max + gap) / (cw + gap)));
  const fitRows = Math.max(1, Math.floor((max + gap) / (ch + gap)));
  const c = Math.max(1, Math.min(cols || Math.ceil(Math.sqrt(items.length)), fitCols));
  const perPage = c * fitRows;
  const pages = [];
  for (let p = 0; p * perPage < items.length; p++) {
    const part = items.slice(p * perPage, (p + 1) * perPage);
    const rows = Math.ceil(part.length / c);
    const rects = part.map((it, k) => ({ i: it.i, x: (k % c) * (cw + gap), y: Math.floor(k / c) * (ch + gap), w: cw, h: ch }));
    let w = Math.min(part.length, c) * (cw + gap) - gap, h = rows * (ch + gap) - gap;
    if (page === "pot") { w = nextPot(w); h = nextPot(h); } else if (page === "mul4") { w = roundUp(w, 4); h = roundUp(h, 4); }
    pages.push({ w, h, rects, cols: c });
  }
  return { pages, tooBig: cw > max || ch > max ? items.map((it) => it.i) : [] };
}

/** Wyspy nieprzezroczystych pikseli (8-sąsiedztwo) → prostokąty, w kolejności wierszami. */
function islands(im, thr, minSize) {
  const { w, h, d } = im, lab = new Uint8Array(w * h), out = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || d[s * 4 + 3] <= thr) continue;
    let sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = s; lab[s] = 1;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!lab[j] && d[j * 4 + 3] > thr) { lab[j] = 1; stack[sp++] = j; }
      }
    }
    if (x1 - x0 + 1 >= minSize || y1 - y0 + 1 >= minSize) out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // wierszami: prostokąty, których środki leżą w pasie wysokości poprzedniego, są w tym samym wierszu
  out.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const r of out) {
    const row = rows.find((rw) => r.y + r.h / 2 >= rw.y && r.y + r.h / 2 <= rw.y + rw.h);
    if (row) { row.items.push(r); row.h = Math.max(row.h, r.y + r.h - row.y); } else rows.push({ y: r.y, h: r.h, items: [r] });
  }
  return rows.flatMap((rw) => rw.items.sort((a, b) => a.x - b.x));
}

/** Nazwa klatki z szablonu: {name}, {nr}, {nr:00}. */
function frameName(tpl, name, nr) {
  return tpl.replace(/\{name\}/g, name).replace(/\{nr(?::(0+))?\}/g, (_, z) => String(nr).padStart(z ? z.length : 0, "0"));
}

// ---------- kanały PBR ----------

const ROLE_RX = {
  ao: /(?:^|[_\-. ])(ao|occlusion|ambientocclusion|ambient[_ -]?occlusion|occ)$/i,
  rough: /(?:^|[_\-. ])(rough|roughness|rgh)$/i,
  metal: /(?:^|[_\-. ])(metal|metallic|metalness|mtl)$/i,
  smooth: /(?:^|[_\-. ])(smooth|smoothness|gloss|glossiness)$/i,
  mask: /(?:^|[_\-. ])(mask|detailmask|detail)$/i,
  height: /(?:^|[_\-. ])(height|disp|displacement|bump)$/i,
};
const DEFAULT_VALUE = { ao: 255, rough: 255, metal: 0, smooth: 0, mask: 0, height: 128, white: 255, black: 0, none: 0 };

/** Rola mapy po końcówce nazwy: { role, base } albo null. */
function roleOf(stem) {
  for (const [role, rx] of Object.entries(ROLE_RX)) {
    const m = stem.match(rx);
    if (m) return { role, base: stem.slice(0, m.index).replace(/[_\-. ]+$/, "") || stem };
  }
  return null;
}

/** Grupuje pliki w zestawy po wspólnym rdzeniu nazwy: [{ base, dir, maps: { role: path } }]. */
function groupSets(paths) {
  const sets = new Map();
  for (const p of paths) {
    const r = roleOf(stemOf(p));
    if (!r) continue;
    const key = dirOf(p).toLowerCase() + "|" + r.base.toLowerCase();
    if (!sets.has(key)) sets.set(key, { base: r.base, dir: dirOf(p), maps: {} });
    sets.get(key).maps[r.role] = sets.get(key).maps[r.role] || p;
  }
  return [...sets.values()].sort((a, b) => natural(a.base, b.base));
}

/** Skąd brać kanał: { map: rola pliku, inv } albo { value }. Smoothness bez własnej mapy = odwrócony Roughness. */
function resolveRole(maps, role) {
  if (role === "smooth") return maps.smooth ? { map: "smooth", inv: false } : maps.rough ? { map: "rough", inv: true } : { value: 0 };
  if (role === "rough") return maps.rough ? { map: "rough", inv: false } : maps.smooth ? { map: "smooth", inv: true } : { value: 255 };
  if (maps[role]) return { map: role, inv: false };
  return { value: DEFAULT_VALUE[role] ?? 0 };
}

const PACKS = {
  orm: { suffix: "_ORM", slots: ["ao", "rough", "metal", "none"] },
  hdrp: { suffix: "_MaskMap", slots: ["metal", "ao", "mask", "smooth"] },
  urp: { suffix: "_MetallicSmoothness", slots: ["metal", "metal", "metal", "smooth"] },
};

/** Składa kanały: `chans` = 4 × { img?, inv, value }; obrazy już w tym samym rozmiarze w×h. A „none” = 255. */
function packChannels(w, h, chans) {
  const out = mk(w, h), o = out.d;
  chans.forEach((c, k) => {
    if (c.img) {
      const s = c.img.d;
      for (let i = 0; i < w * h; i++) o[i * 4 + k] = c.inv ? 255 - s[i * 4] : s[i * 4];
    } else {
      const v = c.inv ? 255 - c.value : c.value;
      for (let i = 0; i < w * h; i++) o[i * 4 + k] = v;
    }
  });
  return out;
}

// ---------- pamięć karty graficznej ----------

/** Bajty w VRAM: bc7 / bc1 / bc4 / rgba8 (z mipmapami +1/3). */
function vramBytes(w, h, fmt, mips = true) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const base = fmt === "bc1" || fmt === "bc4" ? bw * bh * 8 : fmt === "rgba8" ? w * h * 4 : bw * bh * 16;
  return mips ? Math.round((base * 4) / 3) : base;
}
const mb = (b) => (b / 1048576).toLocaleString(PL ? "pl-PL" : "en-US", { maximumFractionDigits: b < 1048576 * 10 ? 1 : 0 }) + " MB";

// ---------- dane atlasu ----------

/** JSON w formacie TexturePacker (Hash / Array): czytają go Phaser, PixiJS, Paper2D (Unreal), wtyczki Unity i Godota. */
function tpJson(page, sprites, image, hash) {
  const frames = page.rects.map((r) => {
    const s = sprites[r.i];
    return [s.name, {
      frame: { x: r.sx, y: r.sy, w: s.w, h: s.h },
      rotated: false,
      trimmed: s.w !== s.srcW || s.h !== s.srcH,
      spriteSourceSize: { x: s.ox, y: s.oy, w: s.w, h: s.h },
      sourceSize: { w: s.srcW, h: s.srcH },
      pivot: { x: 0.5, y: 0.5 },
    }];
  });
  const meta = { app: "Wayfolder Game Assets", version: "1.0", image, format: "RGBA8888", size: { w: page.w, h: page.h }, scale: "1" };
  return JSON.stringify(hash ? { frames: Object.fromEntries(frames), meta } : { frames: frames.map(([filename, f]) => ({ filename, ...f })), meta }, null, 2);
}

function csvData(pages, sprites, images) {
  const rows = [["name", "image", "x", "y", "w", "h", "offsetX", "offsetY", "sourceW", "sourceH"]];
  pages.forEach((pg, p) => pg.rects.forEach((r) => { const s = sprites[r.i]; rows.push([s.name, images[p], r.sx, r.sy, s.w, s.h, s.ox, s.oy, s.srcW, s.srcH]); }));
  return rows.map((r) => r.map((v) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";
}

/** Animacja z nazwy klatki: „hero_walk_03” → „hero_walk”. */
const animOf = (name) => name.replace(/[_\-. ]?\d+$/, "") || name;

/** Godot 4: SpriteFrames (.tres) z animacjami pogrupowanymi po nazwach klatek; przycięte klatki mają margin. */
function godotTres(pages, sprites, resPaths, fps) {
  const ext = resPaths.map((p, k) => `[ext_resource type="Texture2D" path="${p}" id="${k + 1}_atlas"]`);
  const subs = [], anims = new Map();
  let n = 0;
  const order = [];
  pages.forEach((pg, p) => pg.rects.forEach((r) => order.push({ r, p })));
  order.sort((a, b) => natural(sprites[a.r.i].name, sprites[b.r.i].name));
  for (const { r, p } of order) {
    const s = sprites[r.i];
    const id = `AtlasTexture_${++n}`;
    let t = `[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("${p + 1}_atlas")\nregion = Rect2(${r.sx}, ${r.sy}, ${s.w}, ${s.h})`;
    if (s.w !== s.srcW || s.h !== s.srcH || s.ox || s.oy) t += `\nmargin = Rect2(${s.ox}, ${s.oy}, ${s.srcW - s.w}, ${s.srcH - s.h})`;
    subs.push(t);
    const a = animOf(s.name);
    if (!anims.has(a)) anims.set(a, []);
    anims.get(a).push(id);
  }
  const animText = [...anims.entries()].map(([name, ids]) =>
    `{\n"frames": [${ids.map((id) => `{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`).join(", ")}],\n"loop": true,\n"name": &"${name.replace(/"/g, "")}",\n"speed": ${fps.toFixed(1)}\n}`).join(", ");
  return `[gd_resource type="SpriteFrames" load_steps=${ext.length + subs.length + 1} format=3]\n\n${ext.join("\n")}\n\n${subs.join("\n\n")}\n\n[resource]\nanimations = [${animText}]\n`;
}

/** Nazwa pliku bezpieczna dla silników i gita: bez spacji i znaków spoza ASCII. */
function safeName(name) {
  return name.replace(/ł/g, "l").replace(/Ł/g, "L").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.\-]/g, "");
}

// testy w Node (w Wayfolderze `module` nie istnieje)
if (typeof module !== "undefined") module.exports = { mk, bbox, union, crop, blit, resize, bleed, extrude, flipGreen, alphaRange, maxRects, packPages, gridPages, islands, frameName, roleOf, groupSets, resolveRole, packChannels, vramBytes, tpJson, csvData, godotTres, animOf, safeName, nextPot, nearPot, isPot };

// =====================================================================================================
// Okno dodatku
// =====================================================================================================

const PRESETS = {
  godot: { name: "Godot 4", pack: "orm", data: "godot" },
  unity: { name: "Unity URP / Built-in", pack: "urp", data: "tp-hash" },
  hdrp: { name: "Unity HDRP", pack: "hdrp", data: "tp-hash" },
  unreal: { name: "Unreal", pack: "orm", data: "tp-hash" },
  gltf: { name: "glTF", pack: "orm", data: "tp-hash" },
  web: { name: "Phaser / PixiJS", pack: "orm", data: "tp-hash" },
};

const DEF = {
  tab: "resize", preset: "godot", where: "sub", sub: "game", custom: "",
  // rozmiar i trim
  trim: true, thr: 2, margin: 1, shared: true, json: true, size: "pot", fit: "pad", scaleDir: "up", square: false, max: 4096, anchor: 7, rBleed: true, rFmt: "same", rSuffix: "",
  // atlas
  aMode: "packed", aMax: 2048, aPage: "pot", aPad: 2, aExt: 1, aTrim: true, aBleed: true, aCols: 0, aData: "godot", aName: "atlas", aFmt: "png", aFps: 8,
  // cięcie
  sMode: "grid", sBy: "size", sCols: 4, sRows: 4, sCw: 64, sCh: 64, sOx: 0, sOy: 0, sGap: 0, sSkip: true, sTrim: false, sThr: 2, sMin: 4, sNames: "{name}_{nr:00}", sFmt: "png",
  // kanały
  cMode: "pack", cPack: "orm", cSlots: ["ao", "rough", "metal", "none"], cInv: [false, false, false, false], cFmt: "png", cAlpha: false,
  // konwersja
  vFmt: "dds", vDds: "auto", vMips: true, vCh: "auto", vSpace: "auto", vFlip: false, vFlipAll: false, vBleed: false, vSuffix: "", vQuality: 90,
  // raport
  kMax: 4096, kPot: false, kAlpha: true, kVram: "bc7",
};

let opt = { ...DEF };
let paths = [];
let busy = null; // { done, total, label }
let result = null; // { tab, done, errors: [], notes: [] }
let focus = 0;
let report = null; // wiersze raportu
let gen = 0; // numer podglądu (stare obliczenia są porzucane)

const TABS = [
  ["resize", T("Rozmiar i trim", "Size & trim")],
  ["atlas", T("Atlas", "Atlas")],
  ["slice", T("Cięcie spritesheetu", "Slice spritesheet")],
  ["channels", T("Kanały (PBR)", "Channels (PBR)")],
  ["convert", T("Konwersja i normal", "Convert & normal")],
  ["check", T("Sprawdź pliki", "Check files")],
];

const ERR = {
  psd_no_composite: T("PSD bez spłaszczonego obrazu – zapisz go z opcją „Maksymalizuj zgodność”", "PSD has no flattened image – save it with “Maximize Compatibility”"),
  cannot_read_image: T("nie da się odczytać obrazu", "cannot read the image"),
  dds_not_multiple_of_4: T("wymiary nie są wielokrotnością 4 (wymóg kompresji BC) – użyj „Rozmiar i trim” › × 4", "size is not a multiple of 4 (needed for BC compression) – use “Size & trim” › × 4"),
  too_large: T("obraz za duży (najwyżej 16384 px)", "image too large (max 16384 px)"),
  empty: T("obraz jest całkowicie przezroczysty", "image is fully transparent"),
};
const errText = (e) => { const s = String((e && e.message) || e); return ERR[s] || s.replace(/[a-z_0-9]+$/, (c) => ERR[c] || c); };

function save() { const { tab, ...rest } = opt; wayfolder.storage.set("opt", { ...rest, tab }).catch(() => {}); }
function set(k, v) { opt[k] = v; save(); draw(); }

// ---------- odczyt z pamięcią podręczną ----------

const cache = new Map(); // ścieżka → Promise<obraz>
let cacheBytes = 0;
function load(p) {
  if (cache.has(p)) { const v = cache.get(p); cache.delete(p); cache.set(p, v); return v; }
  const pr = wayfolder.images.read(p).then((r) => {
    const im = { w: r.width, h: r.height, d: r.data.byteOffset ? new Uint8ClampedArray(r.data) : r.data };
    cacheBytes += im.d.length;
    while (cacheBytes > 700 * 1048576 && cache.size > 1) {
      const [k, v] = cache.entries().next().value;
      cache.delete(k);
      v.then((x) => { cacheBytes -= x.d.length; }).catch(() => {});
    }
    return im;
  });
  pr.catch(() => cache.delete(p));
  cache.set(p, pr);
  return pr;
}
/** Kopia (narzędzia zmieniają piksele w miejscu). */
const loadCopy = (p) => load(p).then((im) => ({ w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) }));

const thumbs = new Map();
function thumb(p, size = 64) {
  const img = el("img", { alt: "", style: `width:${size}px;height:${size}px` });
  if (thumbs.has(p)) img.src = thumbs.get(p);
  else wayfolder.files.imageUrl(p, 128).then((u) => { if (u) { thumbs.set(p, u); img.src = u; } }).catch(() => {});
  return img;
}

/** Podgląd obrazu na canvasie z opcjonalnymi prostokątami (w pikselach obrazu). */
function canvasOf(im, boxes = []) {
  // małe obrazy powiększone całkowitą wielokrotnością (ostre piksele, cienkie ramki)
  const k = Math.max(1, Math.min(8, Math.floor(640 / Math.max(im.w, im.h))));
  const src = el("canvas", { width: im.w, height: im.h });
  src.getContext("2d").putImageData(new ImageData(im.d, im.w, im.h), 0, 0);
  const c = k === 1 ? src : el("canvas", { width: im.w * k, height: im.h * k });
  const g = c.getContext("2d");
  if (k > 1) { g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, im.w * k, im.h * k); }
  const lw = Math.max(1, Math.round(Math.max(c.width, c.height) / 500));
  for (const b of boxes) {
    g.strokeStyle = b.color || accent();
    g.lineWidth = lw;
    g.setLineDash(b.dash ? [lw * 4, lw * 3] : []);
    g.strokeRect(b.x * k + lw / 2, b.y * k + lw / 2, Math.max(0, b.w * k - lw), Math.max(0, b.h * k - lw));
  }
  return c;
}
const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2f6bdb";
const warnColor = () => getComputedStyle(document.documentElement).getPropertyValue("--warn").trim() || "#c44";

// ---------- miejsce zapisu ----------

function destDir(p) {
  if (opt.where === "same") return dirOf(p);
  if (opt.where === "custom") return opt.custom.trim().replace(/[\\/]+$/, "") || dirOf(p);
  return join(dirOf(p), (opt.sub || "game").trim());
}

async function writeImage(dir, stem, im, o) {
  return wayfolder.images.write(join(dir, `${stem}.${o.format === "jpg" ? "jpg" : o.format}`), { width: im.w, height: im.h, data: im.d }, o);
}

/** Zapis tekstu (dane atlasu, trim.json) – pyta przed nadpisaniem. */
async function writeTextAsk(path, text) {
  const ex = await wayfolder.files.info(path).catch(() => null);
  if (ex && !(await wayfolder.ui.confirm(T(`Plik ${baseName(path)} już istnieje. Nadpisać?`, `${baseName(path)} already exists. Overwrite?`)))) return false;
  await wayfolder.files.writeText(path, text);
  return true;
}

/** „res://…” dla pliku w projekcie Godota (folder z project.godot wyżej w drzewie). */
async function godotRes(file) {
  let d = dirOf(file);
  for (let k = 0; k < 16 && d; k++) {
    if (await wayfolder.files.info(join(d, "project.godot")).catch(() => null)) return "res://" + file.slice(d.replace(/\\$/, "").length + 1).replace(/\\/g, "/");
    const up = dirOf(d);
    if (!up || up === d) break;
    d = up;
  }
  return null;
}

// =====================================================================================================
// Narzędzia: obliczenia
// =====================================================================================================

/** Plan „Rozmiar i trim” dla jednego obrazu (z prostokątem wspólnym albo własnym). */
function planResize(im, shared) {
  const m = opt.trim ? Number(opt.margin) || 0 : 0;
  let r = opt.trim ? (opt.shared && shared ? shared : bbox(im, Number(opt.thr) || 0)) : { x: 0, y: 0, w: im.w, h: im.h };
  if (!r) return null;
  r = { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
  let cw = r.w, ch = r.h;
  const max = Number(opt.max) || 4096;
  const f = opt.size === "pot" ? nextPot : opt.size === "mul4" ? (v) => roundUp(v, 4) : (v) => v;
  let W, H, sw = cw, sh = ch;
  if (opt.size !== "none" && opt.fit === "scale") {
    const pick = opt.size === "mul4" ? (v) => roundUp(v, 4) : opt.scaleDir === "down" ? prevPot : opt.scaleDir === "near" ? nearPot : nextPot;
    W = Math.min(pick(cw), opt.size === "pot" ? prevPot(max) : max);
    H = Math.min(pick(ch), opt.size === "pot" ? prevPot(max) : max);
    if (opt.square) W = H = Math.max(W, H);
    sw = W; sh = H;
  } else {
    // dopełnienie: gdy przekracza limit – najpierw proporcjonalne zmniejszenie
    const lim = opt.size === "pot" ? prevPot(max) : max;
    const s = Math.min(1, lim / Math.max(cw, ch));
    if (s < 1) { sw = Math.max(1, Math.floor(cw * s)); sh = Math.max(1, Math.floor(ch * s)); }
    W = Math.min(f(sw), lim); H = Math.min(f(sh), lim);
    if (opt.square) W = H = Math.max(W, H);
  }
  const ax = [0, 0.5, 1][opt.anchor % 3], ay = [0, 0.5, 1][Math.floor(opt.anchor / 3)];
  const px = opt.fit === "scale" && opt.size !== "none" ? 0 : Math.round((W - sw) * ax);
  const py = opt.fit === "scale" && opt.size !== "none" ? 0 : Math.round((H - sh) * ay);
  return { rect: r, W, H, sw, sh, px, py };
}

function applyResize(im, plan) {
  let c = crop(im, plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h);
  if (c.w !== plan.sw || c.h !== plan.sh) c = resize(c, plan.sw, plan.sh, true);
  const out = mk(plan.W, plan.H);
  blit(out, c, plan.px, plan.py);
  if (opt.rBleed) bleed(out);
  return out;
}

/** Grupa klatek jednej animacji: rdzeń nazwy bez numeru + rozmiar (hero_walk_00…03 → „hero_walk 300×412”). */
const seqKey = (p, im) => `${dirOf(p)}|${animOf(stemOf(p)).toLowerCase()}|${im.w}x${im.h}`;

/** Wspólne prostokąty: klucz grupy → suma prostokątów jej klatek (grupy co najmniej 2-plikowe). */
async function sharedRects(list) {
  const groups = new Map();
  for (const p of list) {
    const im = await load(p);
    const k = seqKey(p, im);
    const g = groups.get(k) || { n: 0, r: null };
    g.n++;
    g.r = union(g.r, bbox(im, Number(opt.thr) || 0));
    groups.set(k, g);
  }
  return new Map([...groups].filter(([, g]) => g.n > 1).map(([k, g]) => [k, g.r]));
}

function resizeFmt(p) {
  if (opt.rFmt !== "same") return opt.rFmt;
  const e = extOf(p);
  return ["png", "tga", "webp"].includes(e) ? e : "png";
}

/** Sprite'y do atlasu: { name, path, im, ox, oy, w, h, srcW, srcH }. */
async function atlasSprites() {
  const list = [...paths].sort((a, b) => natural(baseName(a), baseName(b)));
  const out = [];
  for (const p of list) {
    const im = await load(p);
    const r = opt.aMode === "packed" && opt.aTrim ? bbox(im, Number(opt.thr) || 0) || { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: im.w, h: im.h };
    out.push({ name: stemOf(p), path: p, im, ox: r.x, oy: r.y, w: r.w, h: r.h, srcW: im.w, srcH: im.h });
  }
  return out;
}

function layoutAtlas(sprites) {
  const pad = Math.max(0, Number(opt.aPad) || 0), ext = Math.max(0, Number(opt.aExt) || 0), max = Number(opt.aMax) || 2048;
  if (opt.aMode === "grid") {
    const cw = Math.max(...sprites.map((s) => s.srcW)), ch = Math.max(...sprites.map((s) => s.srcH));
    const g = gridPages(sprites.map((s, i) => ({ i })), cw, ch, pad, Number(opt.aCols) || 0, max, opt.aPage);
    for (const pg of g.pages) for (const r of pg.rects) { const s = sprites[r.i]; r.sx = r.x + Math.floor((cw - s.w) / 2); r.sy = r.y + (ch - s.h); }
    return { ...g, cell: [cw, ch] };
  }
  const items = sprites.map((s, i) => ({ i, w: s.w + 2 * ext + pad, h: s.h + 2 * ext + pad }));
  const res = packPages(items, max, opt.aPage);
  for (const pg of res.pages) for (const r of pg.rects) { r.sx = r.x + ext; r.sy = r.y + ext; }
  return res;
}

function renderAtlasPage(pg, sprites) {
  const out = mk(pg.w, pg.h);
  const ext = opt.aMode === "packed" ? Math.max(0, Number(opt.aExt) || 0) : 0;
  for (const r of pg.rects) {
    const s = sprites[r.i];
    const part = crop(s.im, s.ox, s.oy, s.w, s.h);
    blit(out, part, r.sx, r.sy);
    if (ext) extrude(out, r.sx, r.sy, s.w, s.h, ext);
  }
  if (opt.aBleed) bleed(out);
  return out;
}

function sliceRects(im) {
  if (opt.sMode === "islands") return islands(im, Number(opt.sThr) || 0, Number(opt.sMin) || 1);
  const ox = Number(opt.sOx) || 0, oy = Number(opt.sOy) || 0, gap = Number(opt.sGap) || 0;
  let cols, rows, cw, ch;
  if (opt.sBy === "count") {
    cols = Math.max(1, Number(opt.sCols) || 1); rows = Math.max(1, Number(opt.sRows) || 1);
    cw = Math.floor((im.w - ox - gap * (cols - 1)) / cols); ch = Math.floor((im.h - oy - gap * (rows - 1)) / rows);
  } else {
    cw = Math.max(1, Number(opt.sCw) || 1); ch = Math.max(1, Number(opt.sCh) || 1);
    cols = Math.max(1, Math.floor((im.w - ox + gap) / (cw + gap))); rows = Math.max(1, Math.floor((im.h - oy + gap) / (ch + gap)));
  }
  const out = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out.push({ x: ox + x * (cw + gap), y: oy + y * (ch + gap), w: cw, h: ch });
  return out.filter((r) => r.w > 0 && r.h > 0);
}

function sliceFrames(im) {
  return sliceRects(im).map((r) => {
    let part = crop(im, r.x, r.y, r.w, r.h);
    const b = bbox(part, Number(opt.sThr) || 0);
    if (!b) return { r, part: null };
    if (opt.sTrim) part = crop(part, b.x, b.y, b.w, b.h);
    return { r, part };
  }).filter((f) => f.part || !opt.sSkip).map((f) => ({ r: f.r, part: f.part || mk(f.r.w, f.r.h) }));
}

const isNormalName = (p) => /(?:^|[_\-. ])(n|nrm|nor|normal|normals|normalmap)$/i.test(stemOf(p));
const isDataName = (p) => isNormalName(p) || !!roleOf(stemOf(p)) || /(?:^|[_\-. ])(orm|arm|rma|mra|maskmap|metallicsmoothness)$/i.test(stemOf(p));

function convertOpts(p) {
  const fmt = opt.vFmt;
  const linear = opt.vSpace === "auto" ? isDataName(p) : opt.vSpace === "linear";
  let dds = opt.vDds;
  if (dds === "auto") {
    const r = roleOf(stemOf(p));
    dds = isNormalName(p) ? "bc5" : r && ["ao", "rough", "metal", "smooth", "height", "mask"].includes(r.role) ? "bc4" : "bc7";
  }
  const ch = opt.vCh === "auto" ? 0 : Number(opt.vCh);
  return { format: fmt, dds, mipmaps: !!opt.vMips, srgb: fmt === "exr" ? !linear : !linear, channels: ch, quality: Number(opt.vQuality) || 90 };
}
const flipsHere = (p) => opt.vFlip && (opt.vFlipAll || isNormalName(p));
const ddsLabel = (o) => (o.format !== "dds" ? o.format.toUpperCase() : `DDS ${o.dds.toUpperCase()}${o.dds === "bc7" || o.dds === "bc1" || o.dds === "bc3" || o.dds === "rgba" ? (o.srgb ? " sRGB" : T(" liniowy", " linear")) : ""}${o.mipmaps ? " + mip" : ""}`);
const vramFmt = (o) => (o.format !== "dds" ? "rgba8" : o.dds === "rgba" ? "rgba8" : o.dds === "bc1" || o.dds === "bc4" ? "bc1" : "bc7");

// =====================================================================================================
// Rysowanie
// =====================================================================================================

const STYLE = `
body{padding:0;height:100vh;overflow:hidden}
.ga{display:flex;flex-direction:column;height:100vh}
.ga-top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex:none}
.ga-mid{flex:1;display:flex;min-height:0}
.ga-nav{width:184px;flex:none;background:var(--side);border-right:1px solid var(--border);padding:8px;display:flex;flex-direction:column;gap:2px;overflow:auto}
.ga-nav button{display:block;width:100%;text-align:left;height:32px;padding:0 10px;border:none;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}
.ga-nav button:hover{background:var(--hover)}
.ga-nav button.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.ga-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto}
.ga-side{width:296px;flex:none;border-left:1px solid var(--border);padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.ga-bottom{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--border);flex:none;flex-wrap:wrap}
.chk{background-color:var(--bg);background-image:conic-gradient(var(--tile) 25%,transparent 0 50%,var(--tile) 0 75%,transparent 0);background-size:16px 16px;border:1px solid var(--border);border-radius:10px}
.stage{flex:1;min-height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px}
.stage canvas{display:block;width:100%;height:100%;object-fit:contain}
.ga table{table-layout:fixed}
.ga th{max-width:none}
.pair{display:flex;gap:10px;flex:1;min-height:220px}
.pair>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;background:var(--hover);font-size:12px;white-space:nowrap}
.chip.warn{background:var(--warn-soft);color:var(--warn)}
.chip.ok{color:var(--ok)}
.sec{font-weight:600}
.field{display:flex;flex-direction:column;align-items:stretch;gap:4px;font-size:12px;color:var(--muted)}
.field input,.field select{color:var(--text);width:100%}
.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ga-side hr{border:none;border-top:1px solid var(--border);margin:2px 0;width:100%}
.ga-side label:not(.field){align-items:flex-start}
.ga-side .seg{flex-wrap:wrap}
.anchor{display:grid;grid-template-columns:repeat(3,24px);gap:3px}
.anchor button{width:24px;height:20px;border-radius:6px;border:1px solid var(--border);background:var(--bg);padding:0;cursor:pointer}
.anchor button.on{background:var(--accent);border-color:var(--accent)}
.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;flex:none}
.strip .it{width:76px;flex:none;text-align:center;font-size:11px;cursor:pointer;border-radius:10px;padding:4px 2px}
.strip .it.on{background:var(--accent-soft)}
.strip .it img{object-fit:contain;border-radius:8px;background:var(--tile);display:block;margin:0 auto 3px}
.strip .it span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog{height:6px;border-radius:3px;background:var(--hover);overflow:hidden;width:160px}
.prog i{display:block;height:100%;background:var(--accent)}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.tile{border-radius:12px;background:var(--side);border:1px solid var(--border);padding:10px 12px}
.tile b{display:block;font-size:20px;font-weight:600}
.slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) 150px;gap:8px}
.slot{border:1px solid var(--border);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0}
.badge{display:inline-flex;width:22px;height:22px;border-radius:7px;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff}
.mini{height:84px;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.mini canvas,.mini img{max-width:100%;max-height:100%}
td .btn{height:24px;padding:0 9px}
.empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:24px}
`;

function field(label, input) { return el("label", { class: "field" }, label, input); }
function num(k, attrs = {}) { return el("input", { type: "number", value: String(opt[k]), ...attrs, onchange: (e) => set(k, Number(e.target.value)) }); }
function txt(k, attrs = {}) { return el("input", { type: "text", value: String(opt[k] ?? ""), ...attrs, onchange: (e) => set(k, e.target.value) }); }
function sel(k, options) { return el("select", { onchange: (e) => set(k, isNaN(Number(e.target.value)) || e.target.value === "" ? e.target.value : Number(e.target.value)) }, options.map(([v, l]) => el("option", { value: String(v), selected: String(opt[k]) === String(v) }, l))); }
function check(k, label, hint) { return el("label", {}, el("input", { type: "checkbox", checked: !!opt[k], onchange: (e) => set(k, e.target.checked) }), el("span", {}, label, hint ? el("div", { class: "muted small" }, hint) : null)); }
function segOf(k, options) { return seg(options, opt[k], (v) => set(k, v)); }

function draw() {
  const g = ++gen;
  const t = opt.tab;
  const views = { resize: viewResize, atlas: viewAtlas, slice: viewSlice, channels: viewChannels, convert: viewConvert, check: viewCheck };
  const [main, side, action] = views[t](g);
  render(el("div", { class: "ga" },
    el("div", { class: "ga-top" },
      el("span", { class: "chip" }, T(`${paths.length} ${paths.length === 1 ? "plik" : paths.length % 10 >= 2 && paths.length % 10 <= 4 && (paths.length % 100 < 12 || paths.length % 100 > 14) ? "pliki" : "plików"}`, `${paths.length} file${paths.length === 1 ? "" : "s"}`)),
      el("span", { class: "spacer" }),
      el("label", { class: "muted small" }, T("Preset", "Preset"),
        el("select", { onchange: (e) => applyPreset(e.target.value) }, Object.entries(PRESETS).map(([k, p]) => el("option", { value: k, selected: opt.preset === k }, p.name))))),
    el("div", { class: "ga-mid" },
      el("nav", { class: "ga-nav", "aria-label": T("Narzędzia", "Tools") }, TABS.map(([k, l]) => el("button", { class: k === t ? "on" : "", "aria-current": k === t ? "page" : null, onclick: () => { result = null; set("tab", k); } }, l))),
      el("div", { class: "ga-main" }, main, resultCard()),
      el("div", { class: "ga-side" }, side)),
    el("div", { class: "ga-bottom" },
      t === "check" ? el("span", { class: "muted small" }, T("Sprawdzanie tylko czyta pliki. „Popraw” otwiera narzędzie z tymi plikami.", "Checking only reads files. “Fix” opens the tool with those files.")) : destControls(),
      el("span", { class: "spacer" }),
      busy ? el("span", { class: "row small muted" }, busy.label, el("span", { class: "prog" }, el("i", { style: `width:${Math.round((100 * busy.done) / Math.max(1, busy.total))}%` }))) :
        el("span", { class: "muted small" }, t === "check" ? "" : T("Oryginały zostają · nowe pliki w Dzienniku", "Originals stay · new files go to the Journal")),
      action ? el("button", { class: "btn primary", disabled: !!busy || action.disabled, onclick: action.run }, action.label) : null)));
}

function destControls() {
  return el("span", { class: "row" },
    el("span", { class: "muted small" }, T("Zapisz do", "Save to")),
    segOf("where", [["sub", T("podfolderu", "subfolder")], ["same", T("tego samego", "same folder")], ["custom", T("innego folderu", "other folder")]]),
    opt.where === "sub" ? el("input", { type: "text", value: opt.sub, style: "width:110px", "aria-label": T("Nazwa podfolderu", "Subfolder name"), onchange: (e) => set("sub", e.target.value.replace(/[\\/:*?"<>|]/g, "") || "game") }) : null,
    opt.where === "custom" ? el("input", { type: "text", value: opt.custom, placeholder: "D:\\Gra\\Assets\\Sprites", style: "width:260px", "aria-label": T("Folder docelowy", "Target folder"), onchange: (e) => set("custom", e.target.value.trim()) }) : null);
}

function resultCard() {
  if (!result || result.tab !== opt.tab) return null;
  return el("div", { class: "card" },
    el("b", { class: result.errors.length ? "warn" : "ok" }, T(`Zapisano plików: ${result.done}`, `Files saved: ${result.done}`) + (result.errors.length ? T(` · błędy: ${result.errors.length}`, ` · errors: ${result.errors.length}`) : "")),
    result.notes.map((n) => el("div", { class: "small muted", style: "margin-top:4px" }, n)),
    result.errors.length ? el("div", { class: "small", style: "margin-top:6px" }, result.errors.slice(0, 12).map((e) => el("div", {}, e))) : null);
}

function applyPreset(k) {
  const p = PRESETS[k];
  if (!p) return;
  opt.preset = k;
  opt.cPack = p.pack;
  opt.cSlots = [...PACKS[p.pack].slots];
  opt.aData = p.data;
  save();
  draw();
  wayfolder.toast(T(`Preset: ${p.name}`, `Preset: ${p.name}`));
}

function needFiles(text) { return el("div", { class: "empty" }, text || T("Zaznacz obrazy w Wayfolderze i otwórz Game Assets z menu pod prawym przyciskiem.", "Select images in Wayfolder and open Game Assets from the right-click menu.")); }

/** Pasek miniatur zaznaczonych plików; kliknięcie wybiera podgląd. */
function strip(sub) {
  const shown = paths.slice(0, 60);
  return el("div", { class: "strip" }, shown.map((p, i) => el("div", { class: "it" + (i === focus ? " on" : ""), title: baseName(p), onclick: () => { focus = i; draw(); } }, thumb(p, 56), el("span", {}, baseName(p)), sub ? el("span", { class: "muted", "data-sub": p }, sub(p) || "") : null)),
    paths.length > shown.length ? el("span", { class: "muted small", style: "align-self:center" }, `+${paths.length - shown.length}`) : null);
}

function stageBox(id, label) {
  return el("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1;min-height:0" },
    el("div", { class: "small muted", id: id + "-label" }, label || ""),
    el("div", { class: "stage chk", id }, el("span", { class: "muted small" }, T("Wczytywanie…", "Loading…"))));
}

/** Uruchamia asynchroniczny podgląd; ignoruje wynik, gdy w międzyczasie widok się zmienił. */
function later(g, fn) {
  Promise.resolve().then(fn).catch((e) => {
    if (g !== gen) return;
    const box = document.querySelector(".stage");
    if (box) box.replaceChildren(el("span", { class: "warn small" }, errText(e)));
  });
}
const put = (id, node) => { const b = document.getElementById(id); if (b) b.replaceChildren(node); };
const putText = (id, text) => { const b = document.getElementById(id); if (b) b.textContent = text; };

// ---------- 1. Rozmiar i trim ----------

function viewResize(g) {
  const main = paths.length ? [
    el("div", { class: "pair" }, stageBox("r-before", T("Przed", "Before")), stageBox("r-after", T("Po", "After"))),
    strip(),
  ] : needFiles();
  if (paths.length) later(g, async () => {
    const p = paths[Math.min(focus, paths.length - 1)];
    const im = await load(p);
    if (g !== gen) return;
    const groups = opt.trim && opt.shared ? await sharedRects(paths) : new Map();
    if (g !== gen) return;
    const shared = groups.get(seqKey(p, im)) || null;
    const plan = planResize(im, shared);
    putText("r-before-label", T(`Przed · ${baseName(p)} · ${im.w} × ${im.h}`, `Before · ${baseName(p)} · ${im.w} × ${im.h}`));
    if (!plan) { put("r-before", canvasOf(im)); put("r-after", el("span", { class: "warn small" }, ERR.empty)); return; }
    put("r-before", canvasOf(im, opt.trim ? [{ ...plan.rect, dash: true }] : []));
    const out = applyResize({ w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) }, plan);
    putText("r-after-label", T(`Po · ${plan.W} × ${plan.H}`, `After · ${plan.W} × ${plan.H}`) + (shared ? T(` · wspólny kadr animacji „${animOf(stemOf(p))}”`, ` · shared frame of “${animOf(stemOf(p))}”`) : ""));
    put("r-after", canvasOf(out, [{ x: 0, y: 0, w: out.w, h: out.h }]));
  });
  const side = [
    check("trim", T("Trim do przezroczystości", "Trim to transparency")),
    opt.trim ? el("div", { class: "two" }, field(T("Próg alfy", "Alpha threshold"), num("thr", { min: 0, max: 254 })), field(T("Margines (px)", "Margin (px)"), num("margin", { min: 0, max: 64 }))) : null,
    opt.trim ? check("shared", T("Wspólny prostokąt dla klatek animacji", "Shared rectangle for animation frames"), T("hero_walk_00, _01, _02… dostają ten sam kadr, więc animacja nie skacze", "hero_walk_00, _01, _02… get the same frame, so the animation doesn't jump")) : null,
    opt.trim ? check("json", T("Zapisz przesunięcia (trim.json)", "Save offsets (trim.json)")) : null,
    el("hr"),
    el("div", { class: "sec" }, T("Rozmiar", "Size")),
    segOf("size", [["none", T("bez zmian", "unchanged")], ["pot", T("potęga 2", "power of 2")], ["mul4", "× 4"]]),
    opt.size !== "none" ? segOf("fit", [["pad", T("dopełnij przezroczystością", "pad with transparency")], ["scale", T("skaluj", "scale")]]) : null,
    opt.size === "pot" && opt.fit === "scale" ? segOf("scaleDir", [["up", T("w górę", "up")], ["near", T("najbliższa", "nearest")], ["down", T("w dół", "down")]]) : null,
    el("div", { class: "two" }, field(T("Maks. bok", "Max side"), sel("max", [[1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"], [16384, "16384"]])),
      el("label", { style: "align-self:end;padding-bottom:6px" }, el("input", { type: "checkbox", checked: opt.square, onchange: (e) => set("square", e.target.checked) }), T("kwadrat", "square"))),
    opt.size !== "none" && opt.fit === "pad" || opt.size === "none" ? el("div", { class: "row", style: "align-items:center" },
      el("div", { class: "anchor", role: "group", "aria-label": T("Zaczepienie", "Anchor") }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => el("button", { class: opt.anchor === i ? "on" : "", "aria-label": ANCHORS[i], title: ANCHORS[i], onclick: () => set("anchor", i) }))),
      el("span", { class: "small muted" }, T("Zaczepienie: ", "Anchor: "), el("b", { style: "color:var(--text)" }, ANCHORS[opt.anchor]), el("br"), T("postacie: dół-środek – stoją na ziemi", "characters: bottom-center keeps them grounded"))) : null,
    el("hr"),
    check("rBleed", "Alpha bleeding", T("bez ciemnych obwódek w silniku", "no dark halos in the engine")),
    el("div", { class: "two" }, field(T("Format", "Format"), sel("rFmt", [["same", T("jak źródło", "as source")], ["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]])), field(T("Dopisek do nazwy", "Name suffix"), txt("rSuffix", { placeholder: "_game" }))),
  ];
  return [main, side, paths.length ? { label: T(`Przetwórz ${paths.length}`, `Process ${paths.length}`), run: runResize } : null];
}
const ANCHORS = PL ? ["góra-lewo", "góra", "góra-prawo", "lewo", "środek", "prawo", "dół-lewo", "dół-środek", "dół-prawo"] : ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom-center", "bottom-right"];

async function runResize() {
  await batch("resize", paths, async (list, res) => {
    const groups = opt.trim && opt.shared ? await sharedRects(list) : new Map();
    const trims = new Map(); // folder → wpisy
    for (const p of list) {
      try {
        const im = await load(p);
        const plan = planResize(im, groups.get(seqKey(p, im)) || null);
        if (!plan) throw new Error("empty");
        const out = applyResize(im, plan);
        const dir = destDir(p);
        const file = await writeImage(dir, stemOf(p) + (opt.rSuffix || ""), out, { format: resizeFmt(p) });
        res.done++;
        if (opt.trim && opt.json) {
          if (!trims.has(dir)) trims.set(dir, {});
          const sx = plan.sw / plan.rect.w, sy = plan.sh / plan.rect.h;
          trims.get(dir)[baseName(file)] = { source: baseName(p), sourceSize: { w: im.w, h: im.h }, trim: plan.rect, size: { w: plan.W, h: plan.H }, placed: { x: plan.px, y: plan.py, w: plan.sw, h: plan.sh }, offset: { x: Math.round(plan.px - plan.rect.x * sx), y: Math.round(plan.py - plan.rect.y * sy) } };
        }
      } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
      tick();
    }
    for (const [dir, frames] of trims) {
      if (await writeTextAsk(join(dir, "trim.json"), JSON.stringify({ app: "Wayfolder Game Assets", frames }, null, 2))) res.notes.push(join(dir, "trim.json"));
    }
  });
}

// ---------- 2. Atlas ----------

let atlasCache = null; // { key, sprites, layout }
async function atlasNow() {
  const key = JSON.stringify([paths, opt.aMode, opt.aMax, opt.aPage, opt.aPad, opt.aExt, opt.aTrim, opt.aCols, opt.thr]);
  if (atlasCache && atlasCache.key === key) return atlasCache;
  const sprites = await atlasSprites();
  atlasCache = { key, sprites, layout: layoutAtlas(sprites) };
  return atlasCache;
}
let atlasPage = 0;

function viewAtlas(g) {
  const main = paths.length >= 1 ? [
    el("div", { class: "row" }, el("span", { id: "a-pages", class: "row" }), el("span", { class: "spacer" }), el("span", { id: "a-fill", class: "chip" }, "…")),
    stageBox("a-stage", ""),
    el("div", { id: "a-note", class: "small muted" }),
  ] : needFiles(T("Zaznacz sprite'y (co najmniej dwa) i wybierz „Game Assets: atlas z zaznaczonych”.", "Select sprites (at least two) and choose “Game Assets: atlas from selection”."));
  if (paths.length) later(g, async () => {
    const a = await atlasNow();
    if (g !== gen) return;
    const { pages, tooBig } = a.layout;
    if (atlasPage >= pages.length) atlasPage = 0;
    put("a-pages", pages.length > 1 ? seg(pages.map((_, i) => [i, T(`Strona ${i + 1}`, `Page ${i + 1}`)]), atlasPage, (v) => { atlasPage = v; draw(); }) : el("span", {}));
    const pg = pages[atlasPage];
    if (!pg) { put("a-stage", el("span", { class: "warn small" }, T("Nic się nie zmieściło – zwiększ maks. rozmiar strony.", "Nothing fits – increase the max page size."))); return; }
    const img = renderAtlasPage(pg, a.sprites);
    const used = pg.rects.reduce((s, r) => s + a.sprites[r.i].w * a.sprites[r.i].h, 0);
    putText("a-fill", T(`${pg.w} × ${pg.h} · ${pg.rects.length} sprite'ów · wypełnienie ${Math.round((100 * used) / (pg.w * pg.h))}%`, `${pg.w} × ${pg.h} · ${pg.rects.length} sprites · ${Math.round((100 * used) / (pg.w * pg.h))}% filled`));
    put("a-stage", canvasOf(img, pg.rects.map((r) => ({ x: r.sx, y: r.sy, w: a.sprites[r.i].w, h: a.sprites[r.i].h, color: "rgba(127,127,127,.55)" }))));
    putText("a-note", tooBig.length ? T(`Za duże na stronę (pominięte): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`, `Too big for a page (skipped): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`) : opt.aMode === "grid" ? T(`Siatka: komórka ${a.layout.cell[0]} × ${a.layout.cell[1]}, ${pg.cols} kolumn, odstęp ${opt.aPad} px – tak ustaw cięcie w silniku.`, `Grid: cell ${a.layout.cell[0]} × ${a.layout.cell[1]}, ${pg.cols} columns, spacing ${opt.aPad} px – use this to slice in the engine.`) : "");
  });
  const side = [
    segOf("aMode", [["packed", T("upakowany", "packed")], ["grid", T("siatka (spritesheet)", "grid (spritesheet)")]]),
    el("div", { class: "two" },
      field(T("Maks. strona", "Max page"), sel("aMax", [[512, "512"], [1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"]])),
      field(T("Rozmiar strony", "Page size"), sel("aPage", [["pot", T("potęga 2", "power of 2")], ["mul4", "× 4"], ["any", T("dowolny", "any")]])),
      field(opt.aMode === "grid" ? T("Odstęp (px)", "Spacing (px)") : "Padding (px)", num("aPad", { min: 0, max: 64 })),
      opt.aMode === "packed" ? field("Extrude (px)", num("aExt", { min: 0, max: 8 })) : field(T("Kolumny (0 = auto)", "Columns (0 = auto)"), num("aCols", { min: 0, max: 256 }))),
    opt.aMode === "packed" ? check("aTrim", T("Trim sprite'ów w atlasie", "Trim sprites in the atlas")) : null,
    check("aBleed", "Alpha bleeding"),
    el("hr"),
    field(T("Dane atlasu", "Atlas data"), sel("aData", [["godot", "Godot 4 – SpriteFrames (.tres)"], ["tp-hash", "TexturePacker JSON (Hash)"], ["tp-array", "TexturePacker JSON (Array)"], ["csv", "CSV"], ["none", T("bez danych", "no data")]])),
    opt.aData === "godot" ? field(T("Klatki na sekundę animacji", "Animation frames per second"), num("aFps", { min: 1, max: 60 })) : null,
    el("div", { class: "two" }, field(T("Nazwa", "Name"), txt("aName")), field(T("Format", "Format"), sel("aFmt", [["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]]))),
    el("div", { class: "small muted" }, opt.aData === "godot" ? T("Animacje z nazw klatek: hero_walk_00, hero_walk_01… → „hero_walk”. Ścieżki res:// z folderu z project.godot.", "Animations from frame names: hero_walk_00, hero_walk_01… → “hero_walk”. res:// paths from the folder with project.godot.") : opt.aData.startsWith("tp") ? T("Czytają go Phaser, PixiJS, Paper2D (Unreal) oraz wtyczki TexturePacker do Unity i Godota.", "Read by Phaser, PixiJS, Paper2D (Unreal) and TexturePacker plugins for Unity and Godot.") : ""),
  ];
  return [main, side, paths.length ? { label: T("Zbuduj atlas", "Build atlas"), run: runAtlas } : null];
}

async function runAtlas() {
  await batch("atlas", [1], async (_, res) => {
    const a = await atlasNow();
    const { pages, tooBig } = a.layout;
    const dir = destDir(paths[0]);
    const name = (opt.aName || "atlas").replace(/[\\/:*?"<>|]/g, "") || "atlas";
    const files = [];
    busy.total = pages.length + 1;
    for (let i = 0; i < pages.length; i++) {
      const img = renderAtlasPage(pages[i], a.sprites);
      files.push(await writeImage(dir, pages.length > 1 ? `${name}_${i}` : name, img, { format: opt.aFmt }));
      res.done++;
      tick();
    }
    const imgs = files.map(baseName);
    if (opt.aData === "tp-hash" || opt.aData === "tp-array") {
      for (let i = 0; i < pages.length; i++) if (await writeTextAsk(join(dir, stemOf(files[i]) + ".json"), tpJson(pages[i], a.sprites, imgs[i], opt.aData === "tp-hash"))) res.done++;
    } else if (opt.aData === "csv") {
      if (await writeTextAsk(join(dir, name + ".csv"), csvData(pages, a.sprites, imgs))) res.done++;
    } else if (opt.aData === "godot") {
      const res2 = [];
      let missing = false;
      for (const f of files) { const r = await godotRes(f); if (!r) missing = true; res2.push(r || "res://" + baseName(f)); }
      if (missing) res.notes.push(T("Nie znaleziono project.godot nad folderem zapisu – ścieżki res:// wskazują na główny folder projektu. Popraw je w Godocie albo zapisz atlas w folderze projektu.", "No project.godot above the output folder – res:// paths point to the project root. Fix them in Godot or save the atlas inside the project."));
      if (await writeTextAsk(join(dir, name + ".tres"), godotTres(pages, a.sprites, res2, Number(opt.aFps) || 8))) res.done++;
    }
    if (tooBig.length) res.errors.push(T(`Pominięte (większe niż strona): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`, `Skipped (bigger than a page): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`));
    res.notes.push(dir);
  });
}

// ---------- 3. Cięcie spritesheetu ----------

function viewSlice(g) {
  const main = paths.length ? [stageBox("s-stage", ""), el("div", { id: "s-names", class: "row small" }), paths.length > 1 ? strip() : null] : needFiles();
  if (paths.length) later(g, async () => {
    const p = paths[Math.min(focus, paths.length - 1)];
    const im = await load(p);
    if (g !== gen) return;
    const rects = sliceRects(im);
    const frames = sliceFrames(im);
    const kept = new Set(frames.map((f) => `${f.r.x},${f.r.y}`));
    putText("s-stage-label", T(`${baseName(p)} · ${im.w} × ${im.h} · ${rects.length} pól · ${frames.length} klatek`, `${baseName(p)} · ${im.w} × ${im.h} · ${rects.length} cells · ${frames.length} frames`) + (opt.sMode === "grid" && rects[0] ? ` · ${rects[0].w} × ${rects[0].h}` : ""));
    put("s-stage", canvasOf(im, rects.map((r) => ({ ...r, dash: !kept.has(`${r.x},${r.y}`), color: kept.has(`${r.x},${r.y}`) ? accent() : "rgba(127,127,127,.6)" }))));
    put("s-names", el("span", { class: "row" }, el("span", { class: "muted" }, T("Wynik:", "Output:")), frames.slice(0, 5).map((_, i) => el("span", { class: "chip" }, frameName(opt.sNames, stemOf(p), i) + "." + opt.sFmt)), frames.length > 5 ? el("span", { class: "muted" }, `… +${frames.length - 5}`) : null));
  });
  const side = [
    segOf("sMode", [["grid", T("siatka", "grid")], ["islands", T("wyspy alfy (auto)", "alpha islands (auto)")]]),
    opt.sMode === "grid" ? [
      segOf("sBy", [["count", T("kolumny × wiersze", "columns × rows")], ["size", T("rozmiar komórki", "cell size")]]),
      opt.sBy === "count" ? el("div", { class: "two" }, field(T("Kolumny", "Columns"), num("sCols", { min: 1 })), field(T("Wiersze", "Rows"), num("sRows", { min: 1 }))) :
        el("div", { class: "two" }, field(T("Szerokość", "Width"), num("sCw", { min: 1 })), field(T("Wysokość", "Height"), num("sCh", { min: 1 }))),
      el("div", { class: "two" }, field(T("Przesunięcie X", "Offset X"), num("sOx", { min: 0 })), field(T("Przesunięcie Y", "Offset Y"), num("sOy", { min: 0 }))),
      field(T("Odstęp między polami (px)", "Spacing between cells (px)"), num("sGap", { min: 0 })),
      check("sSkip", T("Pomiń puste klatki", "Skip empty frames")),
    ] : el("div", { class: "two" }, field(T("Próg alfy", "Alpha threshold"), num("sThr", { min: 0, max: 254 })), field(T("Min. rozmiar (px)", "Min size (px)"), num("sMin", { min: 1 }))),
    check("sTrim", T("Trim każdej klatki", "Trim each frame")),
    el("hr"),
    field(T("Nazwy klatek", "Frame names"), txt("sNames")),
    el("div", { class: "small muted" }, T("{name} – nazwa pliku, {nr} albo {nr:00} – numer", "{name} – file name, {nr} or {nr:00} – number")),
    field(T("Format", "Format"), sel("sFmt", [["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]])),
  ];
  return [main, side, paths.length ? { label: T("Potnij", "Slice"), run: runSlice } : null];
}

async function runSlice() {
  await batch("slice", paths, async (list, res) => {
    for (const p of list) {
      try {
        const im = await load(p);
        const frames = sliceFrames(im);
        const dir = destDir(p);
        busy.total += frames.length;
        for (let i = 0; i < frames.length; i++) {
          await writeImage(dir, frameName(opt.sNames, stemOf(p), i), frames[i].part, { format: opt.sFmt });
          res.done++;
          tick();
        }
      } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
      tick();
    }
  });
}

// ---------- 4. Kanały ----------

const CH = [["R", "#d0453a"], ["G", "#3b9a4b"], ["B", "#3f6fd8"], ["A", "#777"]];
const ROLE_LABEL = { ao: "AO", rough: "Roughness", metal: "Metallic", smooth: "Smoothness", mask: T("Maska detali", "Detail mask"), height: T("Wysokość", "Height"), white: T("biały (255)", "white (255)"), black: T("czarny (0)", "black (0)"), none: T("puste", "empty") };

function slotsNow() { return opt.cPack === "custom" ? opt.cSlots : PACKS[opt.cPack].slots; }

function viewChannels(g) {
  const sets = groupSets(paths);
  const slots = slotsNow();
  let main;
  if (opt.cMode === "unpack") {
    main = paths.length ? [el("div", { class: "small muted" }, T("Każdy zaznaczony obraz zostanie rozbity na szare pliki: _R, _G, _B (i _A).", "Each selected image is split into grey files: _R, _G, _B (and _A).")), strip()] : needFiles();
  } else if (!sets.length) {
    main = needFiles(T("Nie rozpoznano map po nazwach. Pliki powinny kończyć się np. na _ao, _rough, _metal, _smooth, _mask (rock_ao.png, rock_rough.png…).", "No maps recognised by name. Files should end with e.g. _ao, _rough, _metal, _smooth, _mask (rock_ao.png, rock_rough.png…)."));
  } else {
    const first = sets[Math.min(focus, sets.length - 1)];
    main = [
      el("div", { class: "slots" },
        slots.map((role, k) => {
          const r = role === "none" ? null : resolveRole(first.maps, role);
          const inv = (r && r.inv) !== !!opt.cInv[k];
          return el("div", { class: "slot" },
            el("div", { class: "row" }, el("span", { class: "badge", style: `background:${CH[k][1]}` }, CH[k][0]), el("b", {}, ROLE_LABEL[role] || role)),
            el("div", { class: "mini chk" }, r && r.map ? thumb(first.maps[r.map], 80) : el("span", { class: "small muted" }, role === "none" ? (k === 3 ? "255" : "0") : String(r ? r.value : 0))),
            opt.cPack === "custom" ? el("select", { "aria-label": T(`Kanał ${CH[k][0]}`, `Channel ${CH[k][0]}`), onchange: (e) => { opt.cSlots = slots.map((s, i) => (i === k ? e.target.value : s)); save(); draw(); } }, Object.keys(ROLE_LABEL).map((rl) => el("option", { value: rl, selected: rl === role }, ROLE_LABEL[rl]))) :
              el("span", { class: "small muted", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, r && r.map ? baseName(first.maps[r.map]) + (r.inv ? T(" (odwrócony)", " (inverted)") : "") : T("stała wartość", "constant")),
            el("label", { class: "small" }, el("input", { type: "checkbox", checked: !!opt.cInv[k], onchange: (e) => { opt.cInv = opt.cInv.map((v, i) => (i === k ? e.target.checked : v)); save(); draw(); } }), T("Odwróć", "Invert")));
        }),
        el("div", { class: "slot", style: "background:var(--side)" }, el("b", {}, T("Wynik", "Result")), el("div", { class: "mini chk", id: "c-out" }), el("span", { class: "small", id: "c-name" }, first.base + packSuffix() + "." + opt.cFmt), el("span", { class: "small muted", id: "c-size" }))),
      el("div", { class: "sec" }, T(`Zestawy rozpoznane po nazwach (${sets.length})`, `Sets recognised by name (${sets.length})`)),
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", { style: "width:16%" }, T("Zestaw", "Set")), ["ao", "rough", "metal", "smooth", "mask"].map((r) => el("th", {}, ROLE_LABEL[r])), el("th", {}, T("Plik wynikowy", "Output")))),
        el("tbody", {}, sets.map((s, i) => el("tr", { style: i === focus ? "background:var(--accent-soft)" : "", onclick: () => { focus = i; draw(); } },
          el("td", {}, el("b", {}, s.base)),
          ["ao", "rough", "metal", "smooth", "mask"].map((r) => el("td", { class: s.maps[r] ? "" : "muted" }, s.maps[r] ? baseName(s.maps[r]) : "–")),
          el("td", {}, s.base + packSuffix() + "." + opt.cFmt))))),
      el("div", { class: "small muted" }, T("Brakująca mapa = stała wartość: AO 255, Roughness 255, Metallic 0. Smoothness bez własnej mapy = odwrócony Roughness.", "Missing map = constant: AO 255, Roughness 255, Metallic 0. Smoothness without its own map = inverted Roughness.")),
    ];
    later(g, async () => {
      const im = await packSet(first, 256);
      if (g !== gen) return;
      put("c-out", canvasOf(im.preview));
      putText("c-size", `${im.w} × ${im.h} · ${slots[3] === "none" ? "RGB" : "RGBA"} · ${T("liniowy", "linear")}`);
    });
  }
  const side = [
    segOf("cMode", [["pack", T("pakuj", "pack")], ["unpack", T("rozbij na szare", "split to grey")]]),
    opt.cMode === "pack" ? [
      field(T("Układ kanałów", "Channel layout"), sel("cPack", [["orm", "ORM – Unreal / Godot / glTF"], ["hdrp", "Unity HDRP – Mask Map"], ["urp", "Unity URP / Built-in – Metallic"], ["custom", T("własny", "custom")]])),
      el("div", { class: "small muted" }, T("ORM: R = AO, G = Roughness, B = Metallic. HDRP: R = Metallic, G = AO, B = maska detali, A = Smoothness. URP: RGB = Metallic, A = Smoothness.", "ORM: R = AO, G = Roughness, B = Metallic. HDRP: R = Metallic, G = AO, B = detail mask, A = Smoothness. URP: RGB = Metallic, A = Smoothness.")),
    ] : check("cAlpha", T("Zapisz też kanał A", "Also save channel A")),
    el("hr"),
    field(T("Format", "Format"), sel("cFmt", [["png", "PNG"], ["tga", "TGA"], ["dds", T("DDS BC7 (liniowy)", "DDS BC7 (linear)")]])),
    el("div", { class: "small muted" }, T("Maski to dane, nie kolor – zapis zawsze liniowy (bez sRGB). Różne rozmiary map są skalowane do największej.", "Masks are data, not colour – always saved linear (no sRGB). Maps of different sizes are scaled to the largest.")),
    el("div", { class: "small muted" }, T("Rozpoznawane końcówki: _ao, _occlusion, _rough, _roughness, _metal, _metallic, _smooth, _gloss, _mask, _height.", "Recognised endings: _ao, _occlusion, _rough, _roughness, _metal, _metallic, _smooth, _gloss, _mask, _height.")),
  ];
  const n = opt.cMode === "unpack" ? paths.length : sets.length;
  return [main, side, n ? { label: opt.cMode === "unpack" ? T(`Rozbij ${n}`, `Split ${n}`) : T(`Utwórz ${n} ${n === 1 ? "teksturę" : n < 5 ? "tekstury" : "tekstur"}`, `Create ${n} texture${n === 1 ? "" : "s"}`), run: runChannels } : null];
}
const packSuffix = () => (opt.cPack === "custom" ? "_packed" : PACKS[opt.cPack].suffix);

/** Składa zestaw; `previewSize` > 0 – tylko podgląd zmniejszony. */
async function packSet(set, previewSize = 0) {
  const slots = slotsNow();
  const imgs = {};
  for (const [role, p] of Object.entries(set.maps)) imgs[role] = await load(p);
  const all = Object.values(imgs);
  let w = Math.max(...all.map((i) => i.w)), h = Math.max(...all.map((i) => i.h));
  let pw = w, ph = h;
  if (previewSize) { const s = Math.min(1, previewSize / Math.max(w, h)); pw = Math.max(1, Math.round(w * s)); ph = Math.max(1, Math.round(h * s)); }
  const sized = (im) => (im.w === pw && im.h === ph ? im : resize(im, pw, ph, true));
  const chans = slots.map((role, k) => {
    if (role === "none") return { value: k === 3 ? 255 : 0, inv: !!opt.cInv[k] };
    const r = resolveRole(set.maps, role);
    const inv = !!r.inv !== !!opt.cInv[k];
    return r.map ? { img: sized(opaque(imgs[r.map])), inv } : { value: r.value, inv };
  });
  const out = packChannels(pw, ph, chans);
  if (previewSize) { const pv = { w: pw, h: ph, d: new Uint8ClampedArray(out.d) }; for (let i = 3; i < pv.d.length; i += 4) pv.d[i] = 255; return { w, h, preview: pv }; }
  return out;
}
/** Mapy szare czasem mają przezroczystość – do skalowania traktujemy je jako nieprzezroczyste. */
function opaque(im) { if (alphaRange(im).lo === 255) return im; const c = { w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) }; for (let i = 3; i < c.d.length; i += 4) c.d[i] = 255; return c; }

async function runChannels() {
  if (opt.cMode === "unpack") {
    await batch("channels", paths, async (list, res) => {
      for (const p of list) {
        try {
          const im = await load(p);
          const names = opt.cAlpha ? ["R", "G", "B", "A"] : ["R", "G", "B"];
          for (let k = 0; k < names.length; k++) {
            const g = mk(im.w, im.h);
            for (let i = 0; i < im.w * im.h; i++) { const v = im.d[i * 4 + k]; g.d[i * 4] = g.d[i * 4 + 1] = g.d[i * 4 + 2] = v; g.d[i * 4 + 3] = 255; }
            await writeImage(destDir(p), `${stemOf(p)}_${names[k]}`, g, { format: opt.cFmt === "dds" ? "dds" : opt.cFmt, channels: 1, dds: "bc4", srgb: false, mipmaps: true });
            res.done++;
          }
        } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
        tick();
      }
    });
    return;
  }
  const sets = groupSets(paths);
  await batch("channels", sets, async (list, res) => {
    const alpha = slotsNow()[3] !== "none";
    for (const s of list) {
      try {
        const im = await packSet(s);
        await writeImage(destDir(join(s.dir, "x")), s.base + packSuffix(), im, { format: opt.cFmt, channels: alpha ? 4 : 3, dds: "bc7", srgb: false, mipmaps: true });
        res.done++;
      } catch (e) { res.errors.push(`${s.base}: ${errText(e)}`); }
      tick();
    }
  });
}

// ---------- 5. Konwersja i normal ----------

let infos = new Map(); // ścieżka → info z nagłówka
async function infoOf(p) {
  if (!infos.has(p)) infos.set(p, await wayfolder.images.info(p).catch(() => null));
  return infos.get(p);
}

function viewConvert(g) {
  const normals = paths.filter(isNormalName).length;
  const main = paths.length ? [
    el("table", {},
      el("thead", {}, el("tr", {}, el("th", { style: "width:30%" }, T("Plik", "File")), el("th", {}, T("Teraz", "Now")), el("th", {}, T("Na", "To")), el("th", { style: "width:96px" }, "VRAM"))),
      el("tbody", {}, paths.slice(0, 300).map((p) => {
        const o = convertOpts(p);
        return el("tr", {},
          el("td", { title: p }, el("b", {}, baseName(p))),
          el("td", { class: "muted", "data-now": p }, "…"),
          el("td", {}, ddsLabel(o) + (flipsHere(p) ? T(" · G odwr.", " · G flipped") : "") + (opt.vBleed ? " · bleed" : "")),
          el("td", { "data-vram": p }, "…"));
      }))),
    paths.length > 300 ? el("div", { class: "small muted" }, T(`… i ${paths.length - 300} więcej`, `… and ${paths.length - 300} more`)) : null,
    el("div", { class: "small muted", id: "v-total" }),
    opt.vFmt === "dds" && opt.vDds === "auto" ? el("div", { class: "small muted" }, T("Automatycznie wg nazwy: _N / _normal → BC5, maski (_ao, _rough, _metal…) → BC4, reszta → BC7. Mapy danych (normal, maski, ORM) zapisywane liniowo, kolor w sRGB.", "Automatic by name: _N / _normal → BC5, masks (_ao, _rough, _metal…) → BC4, the rest → BC7. Data maps (normal, masks, ORM) are saved linear, colour as sRGB.")) : null,
    el("div", { class: "card row", style: "align-items:flex-start;gap:14px" },
      el("div", { class: "col", style: "flex:1" },
        el("b", {}, T("Normal mapy", "Normal maps")),
        check("vFlip", T(`Odwróć zielony (G) – DirectX ↔ OpenGL`, `Flip green (G) – DirectX ↔ OpenGL`), T(`Plików z _N / _normal w nazwie: ${normals}`, `Files with _N / _normal in the name: ${normals}`)),
        opt.vFlip ? check("vFlipAll", T("Traktuj wszystkie zaznaczone jako normal mapy", "Treat all selected files as normal maps")) : null),
      el("div", { class: "small muted", style: "flex:1" }, T("Unreal używa DirectX (G w dół), a Unity, Godot, Blender i glTF – OpenGL (G w górę). Gdy oświetlenie wygląda „od spodu”, odwróć G.", "Unreal uses DirectX (G down); Unity, Godot, Blender and glTF use OpenGL (G up). If lighting looks “inside out”, flip G."))),
  ] : needFiles();
  if (paths.length) later(g, async () => {
    let total = 0, raw = 0;
    for (const p of paths.slice(0, 300)) {
      const i = await infoOf(p);
      if (g !== gen) return;
      const now = document.querySelector(`[data-now="${CSS.escape(p)}"]`), vr = document.querySelector(`[data-vram="${CSS.escape(p)}"]`);
      if (!i) { if (now) now.textContent = "?"; continue; }
      if (now) now.textContent = `${extOf(p).toUpperCase()} ${i.width} × ${i.height}${i.bits > 8 ? ` · ${i.bits} bit` : ""}`;
      const o = convertOpts(p);
      const b = vramBytes(i.width, i.height, vramFmt(o), o.format === "dds" && o.mipmaps);
      total += b; raw += vramBytes(i.width, i.height, "rgba8", true);
      if (vr) { vr.textContent = mb(b); if (o.format === "dds" && o.dds !== "rgba" && (i.width % 4 || i.height % 4)) { vr.className = "warn"; vr.title = ERR.dds_not_multiple_of_4; vr.textContent = T("nie × 4", "not × 4"); } }
    }
    putText("v-total", T(`VRAM razem: ${mb(total)} (bez kompresji z mipmapami: ${mb(raw)})`, `Total VRAM: ${mb(total)} (uncompressed with mipmaps: ${mb(raw)})`));
  });
  const side = [
    field(T("Format", "Format"), sel("vFmt", [["dds", "DDS"], ["png", "PNG"], ["tga", "TGA"], ["exr", "EXR"], ["webp", T("WebP (bez strat)", "WebP (lossless)")], ["jpg", "JPG"]])),
    opt.vFmt === "dds" ? [
      field(T("Kompresja", "Compression"), sel("vDds", [["auto", T("automatycznie wg nazwy", "automatic by name")], ["bc7", T("BC7 – kolor z alfą, najlepsza", "BC7 – colour + alpha, best")], ["bc1", T("BC1 – kolor bez alfy, najmniejszy", "BC1 – colour, no alpha, smallest")], ["bc3", T("BC3 – kolor z alfą (starsze)", "BC3 – colour + alpha (legacy)")], ["bc4", T("BC4 – jeden kanał (maski)", "BC4 – one channel (masks)")], ["bc5", T("BC5 – dwa kanały (normal mapy)", "BC5 – two channels (normal maps)")], ["rgba", T("bez kompresji (RGBA8)", "uncompressed (RGBA8)")]])),
      check("vMips", T("Mipmapy", "Mipmaps")),
    ] : null,
    opt.vFmt === "png" || opt.vFmt === "tga" ? field(T("Kanały", "Channels"), sel("vCh", [["auto", "RGBA"], ["3", "RGB"], ["1", T("szary (z R)", "grey (from R)")]])) : null,
    opt.vFmt === "jpg" ? field(T("Jakość", "Quality"), num("vQuality", { min: 40, max: 100 })) : null,
    opt.vFmt === "dds" || opt.vFmt === "exr" ? field(T("Przestrzeń koloru", "Colour space"), sel("vSpace", [["auto", T("automatycznie (dane = liniowo)", "automatic (data = linear)")], ["srgb", "sRGB"], ["linear", T("liniowa", "linear")]])) : null,
    el("hr"),
    check("vBleed", "Alpha bleeding", T("kolor pod przezroczystymi pikselami", "colour under transparent pixels")),
    field(T("Dopisek do nazwy", "Name suffix"), txt("vSuffix", { placeholder: "_gl" })),
    el("div", { class: "small muted" }, T("Zapis zawsze w 8 bitach, bez metadanych i profilu ICC.", "Always saved as 8-bit, without metadata or ICC profile.")),
  ];
  return [main, side, paths.length ? { label: T(`Konwertuj ${paths.length}`, `Convert ${paths.length}`), run: runConvert } : null];
}

async function runConvert() {
  await batch("convert", paths, async (list, res) => {
    for (const p of list) {
      try {
        let im = await loadCopy(p);
        if (flipsHere(p)) flipGreen(im);
        if (opt.vBleed) bleed(im);
        await writeImage(destDir(p), stemOf(p) + (opt.vSuffix || ""), im, convertOpts(p));
        res.done++;
      } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
      tick();
    }
  });
}

// ---------- 6. Sprawdź pliki ----------

let reportAll = false;
function viewCheck(g) {
  if (report) report.forEach((r) => { if (r.w) { r.vram = vramBytes(r.w, r.h, opt.kVram, true); r.raw = vramBytes(r.w, r.h, "rgba8", true); } });
  const isBad = (r) => r.issues.some((i) => i.level !== "info");
  const rows = report ? (reportAll ? report : report.filter(isBad)) : [];
  const bad = report ? report.filter(isBad).length : 0;
  const total = report ? report.reduce((s, r) => s + (r.vram || 0), 0) : 0;
  const raw = report ? report.reduce((s, r) => s + (r.raw || 0), 0) : 0;
  const main = !paths.length ? needFiles(T("Zaznacz obrazy albo foldery i wybierz „Game Assets: sprawdź pliki”.", "Select images or folders and choose “Game Assets: check files”.")) : !report ? el("div", { class: "empty" }, busy ? T("Sprawdzam…", "Checking…") : el("button", { class: "btn primary", onclick: runCheck }, T(`Sprawdź ${paths.length}`, `Check ${paths.length}`))) : [
    el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("span", { class: "small muted" }, T("Sprawdzone", "Checked")), el("b", {}, String(report.length))),
      el("div", { class: "tile", style: bad ? "background:var(--warn-soft);border-color:transparent" : "" }, el("span", { class: "small", style: bad ? "color:var(--warn)" : "" }, T("Do poprawy", "Need attention")), el("b", { style: bad ? "color:var(--warn)" : "" }, String(bad))),
      el("div", { class: "tile" }, el("span", { class: "small muted" }, `VRAM (${opt.kVram === "bc7" ? "BC7" : opt.kVram === "bc1" ? "BC1" : "RGBA8"} + mip)`), el("b", {}, mb(total)), el("span", { class: "small muted" }, T(`bez kompresji ${mb(raw)}`, `uncompressed ${mb(raw)}`)))),
    el("div", { class: "row" },
      seg([[false, T(`Problemy (${bad})`, `Issues (${bad})`)], [true, T(`Wszystkie (${report.length})`, `All (${report.length})`)]], reportAll, (v) => { reportAll = v; draw(); }),
      el("span", { class: "spacer" }),
      el("button", { class: "btn", onclick: saveCsv }, T("Zapisz raport (CSV)", "Save report (CSV)"))),
    rows.length ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", { style: "width:24%" }, T("Plik", "File")), el("th", { style: "width:92px" }, T("Wymiary", "Size")), el("th", {}, T("Problem", "Issue")), el("th", { style: "width:72px" }, "VRAM"), el("th", { style: "width:136px" }, ""))),
      el("tbody", {}, rows.map((r) => el("tr", {},
        el("td", { title: r.path }, el("b", {}, baseName(r.path))),
        el("td", { class: "muted" }, r.w ? `${r.w} × ${r.h}` : "?"),
        el("td", { style: "white-space:normal" }, r.issues.length ? r.issues.map((i) => el("span", { class: i.level === "info" ? "chip" : "chip warn", style: "margin:1px 4px 1px 0", title: i.level === "info" ? T("wskazówka – nie błąd", "hint – not an error") : null }, i.text)) : el("span", { class: "chip ok" }, "OK")),
        el("td", {}, r.vram ? mb(r.vram) : ""),
        el("td", {}, fixButton(r)))))) : el("div", { class: "empty" }, T("Brak problemów.", "No issues.")),
  ];
  const side = [
    el("div", { class: "sec" }, T("Sprawdzaj", "Check for")),
    field(T("Maks. rozmiar", "Max size"), sel("kMax", [[1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"]])),
    check("kPot", T("Wymagaj potęgi 2", "Require power of 2"), T("bez tego sprawdzana jest wielokrotność 4", "otherwise multiple of 4 is checked")),
    check("kAlpha", T("Pusta i zbędna alfa", "Empty and unused alpha"), T("czyta piksele – wolniej", "reads pixels – slower")),
    el("div", { class: "small muted" }, T("Zawsze: 16 bit, CMYK, spacje i znaki spoza ASCII w nazwach.", "Always: 16-bit, CMYK, spaces and non-ASCII characters in names.")),
    el("hr"),
    field(T("VRAM liczony dla", "VRAM counted for"), sel("kVram", [["bc7", T("BC7 / ETC2 + mipmapy", "BC7 / ETC2 + mipmaps")], ["bc1", T("BC1 + mipmapy", "BC1 + mipmaps")], ["rgba8", T("RGBA8 + mipmapy", "RGBA8 + mipmaps")]])),
  ];
  return [main, side, paths.length ? { label: report ? T("Sprawdź ponownie", "Check again") : T(`Sprawdź ${paths.length}`, `Check ${paths.length}`), run: runCheck } : null];
}

function fixButton(r) {
  const kinds = new Set(r.issues.filter((i) => i.level !== "info").map((i) => i.fix));
  const k = ["name", "resize", "convert"].find((x) => kinds.has(x));
  if (!k) return null;
  const same = report.filter((x) => x.issues.some((i) => i.fix === k)).map((x) => x.path);
  const label = k === "name" ? T("Popraw nazwę", "Fix name") : k === "resize" ? T("Rozmiar…", "Size…") : T("Konwertuj…", "Convert…");
  return el("button", { class: "btn", title: T(`Wszystkie z tym problemem: ${same.length}`, `All with this issue: ${same.length}`), onclick: () => (k === "name" ? fixNames(same) : openTab(k === "resize" ? "resize" : "convert", same)) }, label);
}

async function fixNames(list) {
  const pairs = list.map((p) => [p, safeName(stemOf(p)) + (extOf(p) ? "." + extOf(p) : "")]).filter(([p, n]) => n !== baseName(p));
  if (!pairs.length) return;
  if (!(await wayfolder.ui.confirm(T(`Zmienić nazwy ${pairs.length} plików? Np. „${baseName(pairs[0][0])}” → „${pairs[0][1]}”. Można cofnąć w Dzienniku.`, `Rename ${pairs.length} files? E.g. “${baseName(pairs[0][0])}” → “${pairs[0][1]}”. Can be undone in the Journal.`)))) return;
  const r = await wayfolder.files.renameMany(pairs);
  wayfolder.toast(T(`Zmieniono nazwy: ${r.done}`, `Renamed: ${r.done}`) + (r.errors.length ? ` · ${r.errors.join(", ")}` : ""));
  const map = new Map(pairs.map(([p, n]) => [p, join(dirOf(p), n)]));
  paths = paths.map((p) => map.get(p) || p);
  report = null;
  infos = new Map();
  await runCheck();
}

function openTab(tab, list) {
  paths = list;
  focus = 0;
  result = null;
  report = null;
  set("tab", tab);
}

async function runCheck() {
  report = null;
  busy = { done: 0, total: paths.length, label: T("Sprawdzam…", "Checking…") };
  draw();
  const out = [];
  for (const p of paths) {
    const r = { path: p, w: 0, h: 0, issues: [] };
    const add = (text, fix, level) => r.issues.push({ text, fix, level });
    try {
      let i = await infoOf(p);
      if (!i) { const im = await load(p); i = { width: im.w, height: im.h, channels: 4, bits: 8, cmyk: false }; }
      r.w = i.width; r.h = i.height;
      if (Math.max(i.width, i.height) > opt.kMax) add(T(`Ponad limit ${opt.kMax}`, `Over the ${opt.kMax} limit`), "resize");
      if (opt.kPot && !(isPot(i.width) && isPot(i.height))) add(T("Nie jest potęgą 2", "Not a power of 2"), "resize");
      else if (i.width % 4 || i.height % 4) add(T("Nie jest wielokrotnością 4", "Not a multiple of 4"), "resize");
      if (i.bits > 8) add(`${i.bits} bit`, "convert");
      if (i.cmyk) add("CMYK", "convert");
      if (opt.kAlpha && (i.channels === 2 || i.channels === 4 || extOf(p) === "psd" || extOf(p) === "dds") && i.width * i.height <= 4096 * 4096) {
        const a = alphaRange(await load(p));
        if (a.hi === 0) add(T("Całkowicie przezroczysty", "Fully transparent"), null);
        else if (a.lo === 255 && (i.channels === 2 || i.channels === 4)) add(T("Alfa zawsze 255 – może być RGB", "Alpha always 255 – could be RGB"), "convert", "info");
      }
    } catch (e) { add(errText(e), null); }
    const n = baseName(p);
    if (/\s/.test(n)) add(T("Spacja w nazwie", "Space in the name"), "name");
    if (/[^\x20-\x7E]/.test(n)) add(T("Znaki spoza ASCII w nazwie", "Non-ASCII characters in the name"), "name");
    out.push(r);
    busy.done++;
    if (busy.done % 4 === 0) tickNow();
  }
  report = out;
  busy = null;
  draw();
}

async function saveCsv() {
  if (!report || !report.length) return;
  const rows = [["file", "width", "height", "vram_bytes", "issues"], ...report.map((r) => [r.path, r.w, r.h, r.vram || 0, r.issues.map((i) => i.text).join("; ")])];
  const text = rows.map((r) => r.map((v) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";
  const file = join(dirOf(paths[0]), "game-assets-raport.csv");
  if (await writeTextAsk(file, text)) wayfolder.toast(T(`Zapisano ${baseName(file)}`, `Saved ${baseName(file)}`));
}

// =====================================================================================================
// Wspólne: przebieg zadania, otwieranie
// =====================================================================================================

let lastTick = 0;
function tick() { busy && busy.done++; const now = Date.now(); if (now - lastTick > 120) { lastTick = now; tickNow(); } }
function tickNow() { const b = document.querySelector(".prog i"); if (b && busy) b.style.width = `${Math.round((100 * busy.done) / Math.max(1, busy.total))}%`; else draw(); }

async function batch(tab, list, fn) {
  if (busy) return;
  if (opt.where === "custom" && !opt.custom.trim()) return wayfolder.toast(T("Podaj folder docelowy", "Enter a target folder"));
  busy = { done: 0, total: list.length, label: T("Zapisuję…", "Saving…") };
  result = null;
  draw();
  const res = { tab, done: 0, errors: [], notes: [] };
  try { await fn(list, res); } catch (e) { res.errors.push(errText(e)); }
  busy = null;
  result = res;
  wayfolder.toast(T(`Gotowe: ${res.done}`, `Done: ${res.done}`) + (res.errors.length ? T(` · błędy: ${res.errors.length}`, ` · errors: ${res.errors.length}`) : ""));
  draw();
}

/** Obrazy z zaznaczenia; foldery rozwijane (raport: z podfolderami, najwyżej 3000 plików). */
async function collect(list, deep) {
  const out = [];
  const walk = async (dir, depth) => {
    const items = await wayfolder.files.list(dir).catch(() => []);
    for (const it of items) {
      if (out.length >= 3000) return;
      if (it.isDir) { if (deep && depth < 8) await walk(it.path, depth + 1); }
      else if (IMAGE_EXT.includes((it.ext || extOf(it.path)).toLowerCase())) out.push(it.path);
    }
  };
  for (const p of list) {
    if (IMAGE_EXT.includes(extOf(p))) { out.push(p); continue; }
    const i = await wayfolder.files.info(p).catch(() => null);
    if (i && i.isDir) await walk(p, 0);
  }
  return [...new Set(out)];
}

async function open(tab, ctx) {
  const saved = await wayfolder.storage.get("opt").catch(() => null);
  if (saved && typeof saved === "object") opt = { ...DEF, ...saved };
  const src = ctx && ctx.paths && ctx.paths.length ? ctx.paths : ctx && ctx.folder ? [ctx.folder] : [];
  paths = (await collect(src, tab === "check")).sort((a, b) => natural(baseName(a), baseName(b)));
  if (tab) opt.tab = tab;
  focus = 0;
  result = null;
  report = null;
  atlasCache = null;
  infos = new Map();
  draw();
  await wayfolder.ui.panel.open({ title: "Game Assets", width: 1180, height: 780 });
  if (opt.tab === "check" && paths.length) runCheck();
}

if (typeof document !== "undefined" && document.head) document.head.append(el("style", {}, STYLE));
wayfolder.ui.panel.onClose(() => { cache.clear(); cacheBytes = 0; atlasCache = null; });

wayfolder.menu.add({ id: "open", label: T("Game Assets…", "Game Assets…"), when: { files: true, ext: IMAGE_EXT }, run: (ctx) => open(null, ctx) });
wayfolder.menu.add({ id: "atlas", label: T("Game Assets: atlas z zaznaczonych…", "Game Assets: atlas from selection…"), when: { files: true, min: 2, ext: IMAGE_EXT }, run: (ctx) => open("atlas", ctx) });
wayfolder.menu.add({ id: "channels", label: T("Game Assets: pakuj kanały PBR…", "Game Assets: pack PBR channels…"), when: { files: true, min: 2, ext: IMAGE_EXT }, run: (ctx) => open("channels", ctx) });
wayfolder.menu.add({ id: "check", label: T("Game Assets: sprawdź pliki…", "Game Assets: check files…"), when: { files: true, folders: true, background: true }, run: (ctx) => open("check", ctx) });
wayfolder.commands.add({ id: "open-cmd", label: "Game Assets…", run: (ctx) => open(null, ctx) });
