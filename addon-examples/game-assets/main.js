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

/** Prostokąt nieprzezroczystych pikseli (alfa > próg) albo null, gdy obraz jest pusty. Wynik zapamiętany dla obrazu. */
const bboxMemo = new WeakMap();
function bbox(im, thr) {
  let m = bboxMemo.get(im);
  if (!m) { m = new Map(); bboxMemo.set(im, m); }
  if (!m.has(thr)) m.set(thr, bboxRaw(im, thr));
  return m.get(thr);
}
function bboxRaw(im, thr) {
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

// ---------- MaxRects: kilka metod układania i kolejności, wybierany najlepszy wynik ----------

const SORTS = {
  max: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  area: (a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h),
  height: (a, b) => b.h - a.h || b.w - a.w,
  width: (a, b) => b.w - a.w || b.h - a.h,
};
const HEURS = ["bssf", "blsf", "baf", "bl"];
/** Pełny zestaw prób (wynik końcowy) i szybki (szukanie skali). */
const COMBOS_FULL = HEURS.flatMap((h) => Object.keys(SORTS).map((s) => [h, s]));
const COMBOS_QUICK = [["bssf", "max"], ["baf", "area"], ["bl", "height"]];

/** Pakuje prostokąty { i, w, h } do strony W×H. Zwraca { placed: [{ i, x, y, w, h }], rest: [...] }.
 *  heur: bssf (krótszy bok), blsf (dłuższy bok), baf (najmniejsza wolna powierzchnia), bl (dół-lewo). */
function maxRects(items, W, H, heur = "bssf", sort = "max") {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const placed = [], rest = [];
  const sorted = [...items].sort(SORTS[sort] || SORTS.max);
  for (const it of sorted) {
    let best = null, b1 = Infinity, b2 = Infinity;
    for (const f of free) {
      if (it.w > f.w || it.h > f.h) continue;
      const dw = f.w - it.w, dh = f.h - it.h;
      let s1, s2;
      if (heur === "blsf") { s1 = Math.max(dw, dh); s2 = Math.min(dw, dh); }
      else if (heur === "baf") { s1 = f.w * f.h - it.w * it.h; s2 = Math.min(dw, dh); }
      else if (heur === "bl") { s1 = f.y + it.h; s2 = f.x; }
      else { s1 = Math.min(dw, dh); s2 = Math.max(dw, dh); }
      if (s1 < b1 || (s1 === b1 && s2 < b2)) { best = f; b1 = s1; b2 = s2; }
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

const extent = (rects) => { let w = 1, h = 1; for (const r of rects) { w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h); } return [w, h]; };
const placedArea = (rects) => rects.reduce((s, r) => s + r.w * r.h, 0);

/** Dzieli prostokąty na strony atlasu. `page`: "pot" | "mul4" | "any". Zwraca { pages: [{ w, h, rects }], tooBig: [i] }. */
function packPages(items, max, page, combos = COMBOS_FULL) {
  const pages = [], tooBig = [];
  let left = items.filter((it) => (it.w <= max && it.h <= max) || (tooBig.push(it.i), false));
  const sizeOf = (rects) => {
    const [w, h] = extent(rects);
    return page === "pot" ? [nextPot(w), nextPot(h)] : page === "mul4" ? [roundUp(w, 4), roundUp(h, 4)] : [w, h];
  };
  while (left.length) {
    let done = null;
    if (page === "pot") {
      // najmniejsza strona POT, na której mieści się wszystko, co zostało (próbując kolejnych metod)
      const area = left.reduce((s, it) => s + it.w * it.h, 0);
      const sizes = [];
      for (let w = 1; w <= max; w *= 2) for (let h = 1; h <= max; h *= 2) if (w * h >= area) sizes.push([w, h]);
      sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));
      outer: for (const [w, h] of sizes) {
        for (const [heur, sort] of combos) {
          const r = maxRects(left, w, h, heur, sort);
          if (!r.rest.length) { done = { w, h, rects: r.placed }; left = []; break outer; }
        }
      }
    } else if (left.length) {
      // dowolny rozmiar / × 4: najmniejsza powierzchnia strony z próbami w kwadracie i pasach
      let best = null;
      const total = left.reduce((s, it) => s + it.w * it.h, 0);
      const minW = Math.max(...left.map((it) => it.w));
      const tries = [max];
      for (let f = 1.05; f <= 2.6; f += 0.15) { const s = Math.ceil(Math.sqrt(total * f)); if (s >= minW && s < max) tries.push(s); }
      for (const W of tries) for (const [heur, sort] of combos) {
        const r = maxRects(left, W, max, heur, sort);
        if (r.rest.length) continue;
        const [w, h] = sizeOf(r.placed);
        if (h > max) continue;
        if (!best || w * h < best.w * best.h) best = { w, h, rects: r.placed };
      }
      if (best) { done = best; left = []; }
    }
    if (!done) {
      // nie mieści się na jednej stronie: pełna strona, największa zajęta powierzchnia
      let best = null;
      for (const [heur, sort] of combos) {
        const r = maxRects(left, max, max, heur, sort);
        if (!best || placedArea(r.placed) > placedArea(best.placed)) best = r;
      }
      if (!best.placed.length) { tooBig.push(...left.map((it) => it.i)); break; }
      const [w, h] = sizeOf(best.placed);
      done = { w: Math.min(w, max), h: Math.min(h, max), rects: best.placed };
      left = best.rest;
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
  // bez przezroczystości – cały obraz to jeden kształt (bez kosztownego zalewania)
  if (alphaRange(im).lo > thr) { const one = [{ x: 0, y: 0, w: im.w, h: im.h }]; one.scale = 1; return one; }
  const f = im.w * im.h > 2000000 ? Math.ceil(Math.sqrt((im.w * im.h) / 1000000)) : 1;
  if (f === 1) { const r = islandsExact(im, thr, minSize); r.scale = 1; return r; }
  // duży obraz: alfa jako maksimum z bloków f×f, prostokąty przeskalowane z powrotem
  const sw = Math.ceil(im.w / f), sh = Math.ceil(im.h / f), sm = mk(sw, sh);
  for (let y = 0; y < im.h; y++) {
    const row = y * im.w * 4, srow = Math.floor(y / f) * sw;
    for (let x = 0; x < im.w; x++) { const a = im.d[row + x * 4 + 3], j = (srow + Math.floor(x / f)) * 4 + 3; if (a > sm.d[j]) sm.d[j] = a; }
  }
  const r = islandsExact(sm, thr, Math.max(1, Math.floor(minSize / f))).map((q) => {
    const x = q.x * f, y = q.y * f;
    return { x, y, w: Math.min(im.w, (q.x + q.w) * f) - x, h: Math.min(im.h, (q.y + q.h) * f) - y };
  });
  r.scale = f;
  return r;
}
function islandsExact(im, thr, minSize) {
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

// ---------- normal mapy ----------

/** Jasność 0–1 (Float32Array). */
function lum(im) {
  const n = im.w * im.h, out = new Float32Array(n), d = im.d;
  for (let i = 0; i < n; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return out;
}

/** Rozmycie: 3 przebiegi rozmycia pudełkowego (≈ gauss), osobno w poziomie i pionie. */
function blurF(src, w, h, r) {
  r = Math.round(r);
  if (r < 1) return src;
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** Odległość (px) każdego nieprzezroczystego piksela od najbliższego przezroczystego albo brzegu (chamfer 3-4). */
function distInside(im, thr = 8) {
  const { w, h, d } = im, INF = 1e9, D = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = d[i * 4 + 3] > thr ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!D[i]) continue;
    D[i] = Math.min(D[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!D[i]) continue;
    D[i] = Math.min(D[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < w * h; i++) D[i] /= 3;
  return D;
}

const PROFILES = {
  round: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))),
  bevel: (t) => t,
  pillow: (t) => t * t * (3 - 2 * t),
};

/** Wysokość (px) sprite'a: wypukłość od krawędzi przezroczystości + drobny detal z rysunku. */
function heightSprite(im, o) {
  const { w, h } = im, bevel = Math.max(1, o.bevel), prof = PROFILES[o.profile] || PROFILES.round;
  const dist = distInside(im);
  const L = lum(im), fine = blurF(L, w, h, 2);
  const k = (o.strength / 100) * 2, det = (o.detail / 100) * 6;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!dist[i]) continue;
    H[i] = prof(Math.min(1, dist[i] / bevel)) * bevel * k + (L[i] - fine[i]) * det * (o.invert ? -1 : 1);
  }
  return o.smooth ? blurF(H, w, h, o.smooth) : H;
}

/** Wysokość (px) z jasności tekstury lub zdjęcia: drobne, średnie i duże detale; bardzo duże plamy (oświetlenie) pomijane. */
function heightTexture(im, o) {
  const { w, h } = im, s = Math.max(1, Math.max(w, h) / 1024);
  let L = lum(im);
  if (o.smooth) L = blurF(L, w, h, o.smooth);
  const b1 = blurF(L, w, h, 2 * s), b2 = blurF(L, w, h, 8 * s), b3 = blurF(L, w, h, 32 * s);
  const m = o.mix / 100, k = (o.strength / 100) * 25 * (o.invert ? -1 : 1);
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = ((L[i] - b1[i]) * (0.5 + m) + (b1[i] - b2[i]) + (b2[i] - b3[i]) * (1.5 - m)) * k;
  return H;
}

/** Wysokość (px) z szarej mapy wysokości. */
function heightFromMap(im, o) {
  let L = lum(im);
  if (o.smooth) L = blurF(L, im.w, im.h, o.smooth);
  const k = (o.strength / 100) * 30 * (o.invert ? -1 : 1);
  return L.map((v) => v * k);
}

/** Normal mapa z wysokości (Sobel). dir: "gl" (Godot, Unity, Blender) albo "dx" (Unreal). Piksele poza `mask` – płaskie. */
function normalFromHeight(H, w, h, dir, mask) {
  const out = mk(w, h), o = out.d;
  const at = (x, y) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const sg = dir === "dx" ? -1 : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    if (mask && !mask[y * w + x]) { o[j] = 128; o[j + 1] = 128; o[j + 2] = 255; o[j + 3] = 255; continue; }
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    let nx = -gx, ny = gy * sg, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    o[j] = (nx / l * 0.5 + 0.5) * 255; o[j + 1] = (ny / l * 0.5 + 0.5) * 255; o[j + 2] = (nz / l * 0.5 + 0.5) * 255; o[j + 3] = 255;
  }
  return out;
}

/** Łączy normal mapy (Reoriented Normal Mapping): bazowa + detal o sile `amount` 0–1. Obie w tym samym rozmiarze i kierunku. */
function combineNormals(base, det, amount) {
  const out = mk(base.w, base.h), a = base.d, b = det.d, o = out.d;
  for (let i = 0; i < a.length; i += 4) {
    const tx = a[i] / 127.5 - 1, ty = a[i + 1] / 127.5 - 1, tz = a[i + 2] / 127.5 - 1 + 1;
    let ux = (b[i] / 127.5 - 1) * amount, uy = (b[i + 1] / 127.5 - 1) * amount, uz = 1 - (1 - (b[i + 2] / 127.5 - 1)) * amount;
    ux = -ux; uy = -uy;
    const dt = tx * ux + ty * uy + tz * uz;
    let rx = (tx * dt) / tz - ux, ry = (ty * dt) / tz - uy, rz = (tz * dt) / tz - uz;
    const l = Math.hypot(rx, ry, rz) || 1;
    o[i] = (rx / l * 0.5 + 0.5) * 255; o[i + 1] = (ry / l * 0.5 + 0.5) * 255; o[i + 2] = (rz / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  return out;
}

/** Podgląd oświetlenia: albedo × (otoczenie + rozproszone) + odbłysk; światło punktowe w (lx, ly) 0–1 nad obrazem. */
function shade(nm, albedo, lx, ly, dir) {
  const { w, h } = nm, out = mk(w, h), n = nm.d, o = out.d, al = albedo && albedo.d;
  const pz = 0.6 * Math.max(w, h), sg = dir === "dx" ? -1 : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const nx = n[i] / 127.5 - 1, ny = (n[i + 1] / 127.5 - 1) * sg, nz = n[i + 2] / 127.5 - 1;
    let Lx = lx * w - x, Ly = -(ly * h - y), Lz = pz;
    const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    const diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
    let hx = Lx, hy = Ly, hz = Lz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
    const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 24) * 0.35 * 255;
    const lit = 0.16 + 0.95 * diff;
    const r = al ? al[i] : 178, g = al ? al[i + 1] : 178, b = al ? al[i + 2] : 178;
    o[i] = r * lit + spec; o[i + 1] = g * lit + spec; o[i + 2] = b * lit + spec; o[i + 3] = al ? al[i + 3] : 255;
  }
  return out;
}

// ---------- wykrywanie siatki w arkuszu ----------

/** Szuka równej siatki, w której każdy kształt mieści się w jednej komórce. Zwraca { cols, rows, cw, ch, frames } albo null. */
function detectGrid(im, thr = 2) {
  const isl = islands(im, thr, 2);
  if (isl.length < 2) return null;
  const tol = isl.scale > 1 ? isl.scale : 0; // przybliżenie z mniejszej kopii – margines na granicy komórki
  let best = null;
  for (let cols = 1; cols <= 64; cols++) {
    if (im.w % cols) continue;
    const cw = im.w / cols;
    if (isl.some((r) => Math.floor((r.x + tol) / cw) !== Math.floor((r.x + r.w - 1 - tol) / cw))) continue;
    for (let rows = 1; rows <= 64; rows++) {
      if (im.h % rows) continue;
      const ch = im.h / rows;
      if (cols * rows < 2 || isl.some((r) => Math.floor((r.y + tol) / ch) !== Math.floor((r.y + r.h - 1 - tol) / ch))) continue;
      const used = new Set(isl.map((r) => Math.floor((r.y + tol) / ch) * cols + Math.floor((r.x + tol) / cw)));
      const empty = cols * rows - used.size;
      if (empty > used.size) continue; // zbyt drobna siatka
      const score = used.size * 10 - empty - Math.abs(Math.log(cw / ch));
      if (!best || score > best.score) best = { cols, rows, cw, ch, frames: used.size, score };
    }
  }
  return best;
}

// testy w Node (w Wayfolderze `module` nie istnieje)
if (typeof module !== "undefined") module.exports = { lum, blurF, distInside, heightSprite, heightTexture, heightFromMap, normalFromHeight, combineNormals, shade, detectGrid, COMBOS_FULL, COMBOS_QUICK, mk, bbox, union, crop, blit, resize, bleed, extrude, flipGreen, alphaRange, maxRects, packPages, gridPages, islands, frameName, roleOf, groupSets, resolveRole, packChannels, vramBytes, tpJson, csvData, godotTres, animOf, safeName, nextPot, nearPot, isPot };

// =====================================================================================================
// Okno dodatku
// =====================================================================================================


const DEF = {
  v: 2, tab: "start", engine: "godot", where: "sub", sub: "game", custom: "",
  // rozmiar
  rMode: "auto", trim: false, thr: 2, margin: 1, shared: true, json: true, size: "pot", fit: "fit", fitLong: "auto", fitShort: "pot", scaleDir: "up", square: false, max: 4096, anchor: 4, rBleed: true, rFmt: "same", rSuffix: "",
  // atlas
  aMode: "packed", aMax: 2048, aPage: "pot", aPad: 2, aExt: 1, aTrim: true, aBleed: true, aCols: 0, aData: "godot", aName: "atlas", aFmt: "png", aFps: 8, aFit: false, aFitMax: 20, aFitWho: "all", aBig: "scale",
  // cięcie
  sMode: "grid", sBy: "count", sCols: 4, sRows: 4, sCw: 64, sCh: 64, sOx: 0, sOy: 0, sGap: 0, sSkip: true, sTrim: false, sThr: 2, sMin: 4, sNames: "{name}_{nr:00}", sFmt: "png",
  // kanały
  cMode: "pack", cPack: "orm", cSlots: ["ao", "rough", "metal", "none"], cInv: [false, false, false, false], cFmt: "png", cAlpha: false,
  // normal mapy
  nMethod: "auto", nStrength: 60, nBevel: 12, nDetail: 40, nProfile: "round", nMix: 50, nSmooth: 1, nInvert: false, nDir: "auto", nHeightOut: false, nFmt: "png", nAmount: 100,
  // konwersja
  vFmt: "auto", vDds: "auto", vMips: true, vCh: "auto", vSpace: "auto", vFlip: "auto", vFlipAll: false, vBleed: false, vSuffix: "", vQuality: 90, vPad: true,
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
const shown = new WeakMap();
/** Kopia do wyświetlenia: najwyżej `max` px (duże tekstury rysowane w pełnej rozdzielczości spowalniały okno). */
function forDisplay(im, max = 1200) {
  if (Math.max(im.w, im.h) <= max) return im;
  let m = shown.get(im);
  if (!m) { m = new Map(); shown.set(im, m); }
  if (!m.has(max)) { const s = max / Math.max(im.w, im.h); m.set(max, resize(im, Math.max(1, Math.round(im.w * s)), Math.max(1, Math.round(im.h * s)), true)); }
  return m.get(max);
}
function canvasOf(im0, boxes = [], max = 1200) {
  const im = forDisplay(im0, max), ds = im.w / im0.w;
  // małe obrazy powiększone całkowitą wielokrotnością (ostre piksele, cienkie ramki)
  const k = Math.max(1, Math.min(8, Math.floor(640 / Math.max(im.w, im.h)))) * ds;
  const kk = k / ds; // powiększenie względem kopii
  const src = el("canvas", { width: im.w, height: im.h });
  src.getContext("2d").putImageData(new ImageData(im.d, im.w, im.h), 0, 0);
  const c = kk === 1 ? src : el("canvas", { width: im.w * kk, height: im.h * kk });
  const g = c.getContext("2d");
  if (kk > 1) { g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, im.w * kk, im.h * kk); }
  const lw = Math.max(1, Math.round(Math.max(c.width, c.height) / 500));
  for (const b of boxes) {
    g.strokeStyle = b.color || accent();
    g.lineWidth = b.bold ? lw * 3 : lw;
    g.setLineDash(b.dash ? [lw * 4, lw * 3] : []);
    g.strokeRect(b.x * k + lw / 2, b.y * k + lw / 2, Math.max(0, b.w * k - lw), Math.max(0, b.h * k - lw));
  }
  return c;
}
/** Wyniki podglądów (ostatnie 24) – przełączanie „Dostosuj” nie liczy wszystkiego od nowa. */
const memoMap = new Map();
function memo(key, fn) {
  if (memoMap.has(key)) { const v = memoMap.get(key); memoMap.delete(key); memoMap.set(key, v); return v; }
  const v = fn();
  memoMap.set(key, v);
  if (memoMap.size > 24) memoMap.delete(memoMap.keys().next().value);
  return v;
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
  if (opt.size === "pot" && opt.fit === "fit") {
    // proporcjonalnie: dłuższy bok = potęga 2, krótszy przeskalowany o tyle samo i dopełniony alfą
    const fp = fitPlan(cw, ch, prevPot(max));
    W = fp.W; H = fp.H; sw = fp.sw; sh = fp.sh;
    const ax = [0, 0.5, 1][opt.anchor % 3], ay = [0, 0.5, 1][Math.floor(opt.anchor / 3)];
    return { rect: r, W, H, sw, sh, px: Math.round((W - sw) * ax), py: Math.round((H - sh) * ay), scale: fp.s, waste: 1 - (sw * sh) / (W * H) };
  }
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
  return { rect: r, W, H, sw, sh, px, py, scale: sw / cw, waste: 1 - (sw * sh) / (W * H) };
}

/** Skalowanie proporcjonalne do potęgi 2: dłuższy bok – wybrana potęga 2 (auto = najmniej pustej alfy),
 *  krótszy – najmniejsza potęga 2 / wielokrotność 4 / kwadrat. */
function fitPlan(cw, ch, lim) {
  const L = Math.max(cw, ch), S = Math.min(cw, ch);
  const cand = (T) => {
    T = Math.max(1, Math.min(T, lim));
    const s = T / L, short = Math.max(1, Math.round(S * s));
    const S2 = Math.min(lim, opt.fitShort === "square" ? T : opt.fitShort === "mul4" ? roundUp(short, 4) : nextPot(short));
    return { T, s, short: Math.min(short, S2), S2, waste: 1 - short / S2 };
  };
  let c;
  const fl = opt.fitLong;
  if (typeof fl === "number") c = cand(fl);
  else if (fl === "up") c = cand(nextPot(L));
  else if (fl === "down") c = cand(prevPot(L));
  else if (fl === "near") c = cand(nearPot(L));
  else {
    // auto: sąsiednie potęgi 2 – mniej pustej alfy, przy remisie bliżej oryginału
    const a = cand(prevPot(L)), b = cand(nextPot(L));
    c = Math.abs(a.waste - b.waste) < 0.02 ? (Math.abs(Math.log(a.s)) <= Math.abs(Math.log(b.s)) ? a : b) : a.waste < b.waste ? a : b;
  }
  const wide = cw >= ch;
  return { s: c.s, W: wide ? c.T : c.S2, H: wide ? c.S2 : c.T, sw: wide ? c.T : c.short, sh: wide ? c.short : c.T };
}

function applyResize(im, plan, withBleed = true) {
  let c = crop(im, plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h);
  if (c.w !== plan.sw || c.h !== plan.sh) c = resize(c, plan.sw, plan.sh, true);
  const out = mk(plan.W, plan.H);
  blit(out, c, plan.px, plan.py);
  if (opt.rBleed && withBleed) bleed(out);
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

// ---------- atlas: sprite'y, skala, układ ----------

/** Ręczne ustawienia sprite'ów atlasu: ścieżka (małe litery) → { m: skala, box: [w, h] wspólna ramka }. Pamiętane między otwarciami. */
let atlasCfg = {};
const cfgOf = (p) => atlasCfg[p.toLowerCase()] || {};
function setCfg(list, fn) {
  for (const p of list) {
    const k = p.toLowerCase(), c = fn({ ...(atlasCfg[k] || {}) }, p);
    if (!c || (!c.box && (c.m == null || Math.abs(c.m - 1) < 1e-4))) delete atlasCfg[k]; else atlasCfg[k] = c;
  }
  const keys = Object.keys(atlasCfg);
  if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete atlasCfg[k];
  wayfolder.storage.set("atlasCfg", atlasCfg).catch(() => {});
  atlasCache = null;
  draw();
}

/** Sprite'y przed skalowaniem: { name, path, im, ox, oy, w, h, srcW, srcH } (prostokąt po trimie). */
let baseCache = null;
async function atlasBase() {
  const key = JSON.stringify([paths, opt.aMode, opt.aTrim, opt.thr]);
  if (baseCache && baseCache.key === key) return baseCache.list;
  const list = [...paths].sort((a, b) => natural(baseName(a), baseName(b)));
  const out = [];
  for (const p of list) {
    const im = await load(p);
    const r = opt.aMode === "packed" && opt.aTrim ? bbox(im, Number(opt.thr) || 0) || { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: im.w, h: im.h };
    out.push({ name: stemOf(p), path: p, im, ox: r.x, oy: r.y, w: r.w, h: r.h, srcW: im.w, srcH: im.h });
  }
  baseCache = { key, list: out };
  return out;
}

/** Rozmiar treści po ręcznej skali i ramka: { cw, ch, fw, fh } w pikselach przed skalą automatyczną. */
function manualDims(b) {
  const c = cfgOf(b.path), m = c.m || 1;
  const cw = Math.max(1, Math.round(b.w * m)), ch = Math.max(1, Math.round(b.h * m));
  return { m, cw, ch, fw: c.box ? Math.max(cw, c.box[0]) : cw, fh: c.box ? Math.max(ch, c.box[1]) : ch, box: !!c.box };
}

/** Sprite'y końcowe przy skali automatycznej g: wymiary w atlasie, przesunięcia i rozmiar źródła do danych silnika. */
function finalSprites(base, g) {
  const pad = Math.max(0, Number(opt.aPad) || 0), ext = opt.aMode === "packed" ? Math.max(0, Number(opt.aExt) || 0) : 0;
  const room = Math.max(1, (Number(opt.aMax) || 2048) - pad - 2 * ext);
  const longest = Math.max(1, ...base.map((b) => { const d = manualDims(b); return Math.max(d.fw, d.fh); }));
  return base.map((b) => {
    const d = manualDims(b);
    const big = opt.aFitWho !== "big" || Math.max(d.fw, d.fh) >= longest * 0.5;
    let s = opt.aFit && big ? g : 1;
    // za duży na stronę – zmniejszamy zamiast pomijać
    let shrink = 1;
    if (opt.aBig === "scale" && Math.max(d.fw, d.fh) * s > room) shrink = room / (Math.max(d.fw, d.fh) * s);
    s *= shrink;
    const cw = Math.max(1, Math.round(d.cw * s)), ch = Math.max(1, Math.round(d.ch * s));
    const fw = Math.max(cw, Math.round(d.fw * s)), fh = Math.max(ch, Math.round(d.fh * s));
    const total = d.m * s;
    const sp = { name: b.name, path: b.path, base: b, cw, ch, w: fw, h: fh, scale: total, auto: s, shrink, box: d.box };
    if (d.box) Object.assign(sp, { ox: 0, oy: 0, srcW: fw, srcH: fh });
    else Object.assign(sp, { ox: Math.round(b.ox * total), oy: Math.round(b.oy * total), srcW: Math.max(fw, Math.round(b.srcW * total)), srcH: Math.max(fh, Math.round(b.srcH * total)) });
    return sp;
  });
}

function layoutAtlas(sprites, combos = COMBOS_FULL) {
  const pad = Math.max(0, Number(opt.aPad) || 0), ext = Math.max(0, Number(opt.aExt) || 0), max = Number(opt.aMax) || 2048;
  if (opt.aMode === "grid") {
    const cw = Math.max(...sprites.map((s) => s.w)), ch = Math.max(...sprites.map((s) => s.h));
    const g = gridPages(sprites.map((s, i) => ({ i })), cw, ch, pad, Number(opt.aCols) || 0, max, opt.aPage);
    for (const pg of g.pages) for (const r of pg.rects) { const s = sprites[r.i]; r.sx = r.x + Math.floor((cw - s.w) / 2); r.sy = r.y + (ch - s.h); }
    return { ...g, cell: [cw, ch] };
  }
  const items = sprites.map((s, i) => ({ i, w: s.w + 2 * ext + pad, h: s.h + 2 * ext + pad }));
  const res = packPages(items, max, opt.aPage, combos);
  for (const pg of res.pages) for (const r of pg.rects) { r.sx = r.x + ext; r.sy = r.y + ext; }
  return res;
}

const layoutScore = (L) => [L.tooBig.length, L.pages.length, L.pages.reduce((s, p) => s + p.w * p.h, 0)];
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
const fillOf = (L, sprites) => { const used = L.pages.reduce((s, p) => s + p.rects.reduce((t, r) => t + sprites[r.i].w * sprites[r.i].h, 0), 0), all = L.pages.reduce((s, p) => s + p.w * p.h, 0); return all ? used / all : 0; };

/** Szuka skali automatycznej (od 100% w dół do limitu): najmniej pominiętych, najmniej stron, najmniejsza powierzchnia,
 *  a przy remisie – największa skala. */
function fitScale(base) {
  if (!opt.aFit || opt.aMode !== "packed") return 1;
  const minG = Math.max(0.1, 1 - Math.max(0, Math.min(90, Number(opt.aFitMax) || 0)) / 100);
  const step = Math.max(0.01, (1 - minG) / 30);
  let best = null, bestG = 1;
  for (let g = 1; g >= minG - 1e-9; g -= step) {
    const sc = layoutScore(layoutAtlas(finalSprites(base, g), COMBOS_QUICK));
    if (!best || better(sc, best)) { best = sc; bestG = g; }
  }
  return Math.round(bestG * 1000) / 1000;
}

function spriteImage(s) {
  const key = `${s.path}|${s.cw}x${s.ch}|${s.w}x${s.h}|${s.base.ox},${s.base.oy},${s.base.w},${s.base.h}`;
  if (spriteImgs.has(key)) return spriteImgs.get(key);
  let c = crop(s.base.im, s.base.ox, s.base.oy, s.base.w, s.base.h);
  if (c.w !== s.cw || c.h !== s.ch) c = resize(c, s.cw, s.ch, true);
  if (s.w !== s.cw || s.h !== s.ch) { const f = mk(s.w, s.h); blit(f, c, Math.floor((s.w - s.cw) / 2), Math.floor((s.h - s.ch) / 2)); c = f; }
  if (spriteImgs.size > 400) spriteImgs.clear();
  spriteImgs.set(key, c);
  return c;
}
const spriteImgs = new Map();

function renderAtlasPage(pg, sprites, withBleed = true) {
  const out = mk(pg.w, pg.h);
  const ext = opt.aMode === "packed" ? Math.max(0, Number(opt.aExt) || 0) : 0;
  for (const r of pg.rects) {
    const s = sprites[r.i];
    blit(out, spriteImage(s), r.sx, r.sy);
    if (ext) extrude(out, r.sx, r.sy, s.w, s.h, ext);
  }
  if (opt.aBleed && withBleed) bleed(out);
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
  const fmt = opt.vFmt === "auto" ? eng().fmt : opt.vFmt;
  const linear = opt.vSpace === "auto" ? isDataName(p) : opt.vSpace === "linear";
  let dds = opt.vDds;
  if (dds === "auto") {
    const r = roleOf(stemOf(p));
    dds = isNormalName(p) ? "bc5" : r && ["ao", "rough", "metal", "smooth", "height", "mask"].includes(r.role) ? "bc4" : "bc7";
  }
  const ch = opt.vCh === "auto" ? 0 : Number(opt.vCh);
  return { format: fmt, dds, mipmaps: !!opt.vMips, srgb: fmt === "exr" ? !linear : !linear, channels: ch, quality: Number(opt.vQuality) || 90 };
}
const flipOn = () => (opt.vFlip === "auto" ? eng().normal === "dx" : !!opt.vFlip);
const flipsHere = (p) => flipOn() && (opt.vFlipAll || isNormalName(p));
const ddsLabel = (o) => (o.format !== "dds" ? o.format.toUpperCase() : `DDS ${o.dds.toUpperCase()}${o.dds === "bc7" || o.dds === "bc1" || o.dds === "bc3" || o.dds === "rgba" ? (o.srgb ? " sRGB" : T(" liniowy", " linear")) : ""}${o.mipmaps ? " + mip" : ""}`);
const vramFmt = (o) => (o.format !== "dds" ? "rgba8" : o.dds === "rgba" ? "rgba8" : o.dds === "bc1" || o.dds === "bc4" ? "bc1" : "bc7");

// =====================================================================================================
// Rysowanie
// =====================================================================================================










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

let atlasCache = null; // { key, sprites, layout, g, plain, alt }
async function atlasNow() {
  const key = JSON.stringify([paths, opt.aMode, opt.aMax, opt.aPage, opt.aPad, opt.aExt, opt.aTrim, opt.aCols, opt.thr, opt.aFit, opt.aFitMax, opt.aFitWho, opt.aBig, atlasCfg]);
  if (atlasCache && atlasCache.key === key) return atlasCache;
  const base = await atlasBase();
  const g = fitScale(base);
  const sprites = finalSprites(base, g);
  const layout = layoutAtlas(sprites);
  // porównanie: bez skali automatycznej, i podpowiedź „× 4”, gdy strona POT jest pusta w połowie
  let plain = null, alt = null;
  if (g < 1) { const ps = finalSprites(base, 1), pl = layoutAtlas(ps); plain = { layout: pl, fill: fillOf(pl, ps) }; }
  const fill = fillOf(layout, sprites);
  if (opt.aMode === "packed" && opt.aPage === "pot" && fill < 0.6) {
    const keep = opt.aPage; opt.aPage = "mul4";
    const al = layoutAtlas(sprites); opt.aPage = keep;
    if (al.pages.length <= layout.pages.length) alt = { layout: al, fill: fillOf(al, sprites) };
  }
  let fitSug = null;
  if (!opt.aFit && opt.aMode === "packed") {
    const keep = [opt.aFit, opt.aFitMax];
    opt.aFit = true; opt.aFitMax = 15;
    const g2 = fitScale(base);
    if (g2 < 1) {
      const s2 = finalSprites(base, g2), l2 = layoutAtlas(s2);
      const area = (L) => L.pages.reduce((s, p) => s + p.w * p.h, 0);
      if (l2.tooBig.length <= layout.tooBig.length && (l2.pages.length < layout.pages.length || area(l2) < area(layout))) fitSug = { g: g2, layout: l2, saving: Math.round((1 - area(l2) / area(layout)) * 100) };
    }
    [opt.aFit, opt.aFitMax] = keep;
  }
  atlasCache = { key, sprites, layout, g, fill, plain, alt, fitSug };
  return atlasCache;
}
let atlasPage = 0;
let aSel = new Set(); // zaznaczone sprite'y (ścieżki)
let aSizeBy = "max";
let aSizePx = 128;
let aScalePct = 100;

const pct = (v) => `${Math.round(v * 100)}%`;
const pagesText = (L) => L.pages.map((p) => `${p.w} × ${p.h}`).join(" + ");

function toggleSel(p, add) {
  if (!add) { const only = aSel.size === 1 && aSel.has(p); aSel = new Set(only ? [] : [p]); }
  else if (aSel.has(p)) aSel.delete(p); else aSel.add(p);
  draw();
}

/** Akcje dla zaznaczonych sprite'ów. */
function sizeAction(kind) {
  const list = [...aSel];
  if (!list.length || !baseCache) return;
  const base = new Map(baseCache.list.map((b) => [b.path, b]));
  const dims = list.map((p) => base.get(p)).filter(Boolean).map((b) => ({ b, d: manualDims(b) }));
  if (!dims.length) return;
  if (kind === "h" || kind === "w") {
    const vals = dims.map(({ d }) => (kind === "h" ? d.ch : d.cw));
    const target = aSizeBy === "max" ? Math.max(...vals) : aSizeBy === "min" ? Math.min(...vals) : Math.max(1, Number(aSizePx) || 1);
    setCfg(list, (c, p) => { const b = base.get(p); return { ...c, m: target / (kind === "h" ? b.h : b.w), box: undefined }; });
  } else if (kind === "box") {
    const w = Math.max(...dims.map(({ d }) => d.cw)), h = Math.max(...dims.map(({ d }) => d.ch));
    setCfg(list, (c) => ({ ...c, box: [w, h] }));
  } else if (kind === "scale") {
    const m = Math.max(1, Math.min(400, Number(aScalePct) || 100)) / 100;
    setCfg(list, (c) => ({ ...c, m }));
  } else if (kind === "reset") {
    setCfg(list, () => null);
  }
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
    if (a.g < 1) res.notes.push(T(`Skala automatyczna: ${pct(a.g)}`, `Auto scale: ${pct(a.g)}`));
    const scaled = a.sprites.filter((s) => Math.abs(s.scale - 1) > 0.001);
    if (scaled.length) res.notes.push(T(`Sprite'y w innej skali niż 100%: ${scaled.length} – w silniku ustaw im odpowiednio większy rozmiar lub Pixels Per Unit.`, `Sprites not at 100%: ${scaled.length} – adjust their size or Pixels Per Unit in the engine.`));
    if (tooBig.length) res.errors.push(T(`Pominięte (większe niż strona): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`, `Skipped (bigger than a page): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`));
    res.notes.push(dir);
  });
}

// ---------- 3. Cięcie spritesheetu ----------


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

/** Ręczne wybory w polach: klucz zestawu → [R, G, B, A], każde { path } | { value } | { none } | undefined (= automatycznie). */
let picks = new Map();
const setKey = (s) => s.dir.toLowerCase() + "|" + s.base.toLowerCase();

/** Zestawy do pakowania: rozpoznane po końcówkach nazw; gdy żadnego – jeden zestaw ze wszystkich zaznaczonych (po kolei R, G, B, A). */
function channelSets() {
  const sets = groupSets(paths);
  if (sets.length) return sets;
  if (!paths.length) return [];
  const stems = paths.map(stemOf);
  let base = stems.reduce((a, b) => { let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++; return a.slice(0, i); });
  base = base.replace(/[_\-. ]+$/, "") || stems[0];
  return [{ base, dir: dirOf(paths[0]), maps: {}, manual: paths.slice(0, 4) }];
}

/** Źródło każdego kanału: { path, inv, auto, why } | { value, inv, auto } | { none: true }. */
function slotSources(set) {
  const slots = slotsNow(), mine = picks.get(setKey(set)) || [];
  const all = { ...folderMaps(set), ...set.maps };
  return slots.map((role, k) => {
    const p = mine[k];
    let s;
    if (p && p.path) s = { path: p.path, inv: false };
    else if (p && p.value != null) s = { value: p.value, inv: false };
    else if (p && p.none) s = { none: true };
    else if (set.manual) s = set.manual[k] ? { path: set.manual[k], inv: false, auto: true } : k === 3 ? { none: true, auto: true } : { value: 0, auto: true };
    else if (role === "none") s = { none: true, auto: true };
    else {
      const r = resolveRole(all, role);
      s = r.map ? { path: all[r.map], inv: r.inv, auto: true, why: r.inv ? T(`odwrócony ${ROLE_LABEL[r.map]}`, `inverted ${ROLE_LABEL[r.map]}`) : null } : { value: r.value, inv: false, auto: true };
    }
    s.inv = !!s.inv !== !!opt.cInv[k];
    return s;
  });
}

function setPick(set, k, v) {
  const key = setKey(set), cur = [...(picks.get(key) || [])];
  cur[k] = v;
  picks.set(key, cur);
  draw();
}

/** Obrazy z folderu zestawu – do wyboru tekstury spoza zaznaczenia. */
const folderLists = new Map();
function folderImages(dir) {
  if (!folderLists.has(dir)) {
    folderLists.set(dir, null);
    wayfolder.files.list(dir).then((items) => {
      folderLists.set(dir, items.filter((i) => !i.isDir && IMAGE_EXT.includes((i.ext || extOf(i.path)).toLowerCase())).map((i) => i.path).sort((a, b) => natural(baseName(a), baseName(b))));
      if (opt.tab === "channels") draw();
    }).catch(() => folderLists.set(dir, []));
  }
  return folderLists.get(dir) || [];
}


const packSuffix = () => (opt.cPack === "custom" ? "_packed" : PACKS[opt.cPack].suffix);

/** Składa zestaw; `previewSize` > 0 – tylko podgląd zmniejszony. */
async function packSet(set, previewSize = 0) {
  const srcs = slotSources(set);
  const imgs = new Map();
  for (const s of srcs) if (s.path && !imgs.has(s.path)) imgs.set(s.path, await load(s.path));
  const all = [...imgs.values()];
  const w = all.length ? Math.max(...all.map((i) => i.w)) : 4, h = all.length ? Math.max(...all.map((i) => i.h)) : 4;
  let pw = w, ph = h;
  if (previewSize) { const s = Math.min(1, previewSize / Math.max(w, h)); pw = Math.max(1, Math.round(w * s)); ph = Math.max(1, Math.round(h * s)); }
  const sized = new Map();
  const get = (p) => { if (!sized.has(p)) { const im = opaque(imgs.get(p)); sized.set(p, im.w === pw && im.h === ph ? im : resize(im, pw, ph, true)); } return sized.get(p); };
  const chans = srcs.map((s, k) => (s.path ? { img: get(s.path), inv: s.inv } : s.none ? { value: k === 3 ? 255 : 0, inv: false } : { value: s.value, inv: s.inv }));
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
  const sets = channelSets();
  await batch("channels", sets, async (list, res) => {
    for (const s of list) {
      try {
        const alpha = !slotSources(s)[3].none;
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


async function runConvert() {
  await batch("convert", paths, async (list, res) => {
    for (const p of list) {
      try {
        let im = await loadCopy(p);
        if (flipsHere(p)) flipGreen(im);
        if (opt.vBleed) bleed(im);
        const o = convertOpts(p);
        // kompresja BC wymaga boków podzielnych przez 4 – dopełnienie przezroczystością
        if (o.format === "dds" && o.dds !== "rgba" && (im.w % 4 || im.h % 4) && opt.vPad) { const pd = mk(roundUp(im.w, 4), roundUp(im.h, 4)); blit(pd, im, 0, 0); im = pd; }
        await writeImage(destDir(p), stemOf(p) + (opt.vSuffix || ""), im, o);
        res.done++;
      } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
      tick();
    }
  });
}

// ---------- 6. Sprawdź pliki ----------



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


async function saveCsv() {
  if (!report || !report.length) return;
  const rows = [["file", "width", "height", "vram_bytes", "issues"], ...report.map((r) => [r.path, r.w, r.h, r.vram || 0, r.issues.map((i) => i.text).join("; ")])];
  const text = rows.map((r) => r.map((v) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";
  const file = join(dirOf(paths[0]), "game-assets-raport.csv");
  if (await writeTextAsk(file, text)) wayfolder.toast(T(`Zapisano ${baseName(file)}`, `Saved ${baseName(file)}`));
}

// =====================================================================================================
// Interfejs v2: najpierw wynik, potem „Dostosuj”
// =====================================================================================================

const ENGINES = {
  godot: { name: "Godot", pack: "orm", data: "godot", normal: "gl", fmt: "png", pot: false },
  unity: { name: "Unity", pack: "urp", data: "tp-hash", normal: "gl", fmt: "png", pot: false },
  unreal: { name: "Unreal", pack: "orm", data: "tp-hash", normal: "dx", fmt: "tga", pot: true },
  web: { name: "Web", pack: "orm", data: "tp-hash", normal: "gl", fmt: "webp", pot: false },
};
const eng = () => ENGINES[opt.engine] || ENGINES.godot;
function setEngine(k) {
  const e = ENGINES[k];
  if (!e) return;
  Object.assign(opt, { engine: k, cPack: e.pack, cSlots: [...PACKS[e.pack].slots], aData: e.data, kPot: e.pot });
  atlasCache = null;
  normalCache = null;
  save();
  draw();
}

const TABS = [
  ["start", T("Co zrobić?", "What to do?"), T("podpowiem, od czego zacząć", "I'll suggest where to start")],
  ["resize", T("Dopasuj rozmiar", "Fit size"), T("potęga 2, puste brzegi", "power of 2, empty edges")],
  ["atlas", T("Złóż w atlas", "Build an atlas"), T("wiele obrazków w 1 pliku", "many images in 1 file")],
  ["slice", T("Potnij arkusz", "Slice a sheet"), T("arkusz → osobne klatki", "sheet → separate frames")],
  ["channels", T("Połącz mapy PBR", "Pack PBR maps"), "AO + Rough + Metal → 1"],
  ["normal", T("Zrób normal mapę", "Make a normal map"), T("z obrazu, wysokości, sprite'a", "from image, height, sprite")],
  ["convert", T("Przygotuj do silnika", "Prepare for engine"), T("format, normal mapy", "format, normal maps")],
  ["check", T("Sprawdź pliki", "Check files"), T("co poprawić przed eksportem", "what to fix before export")],
];

const STYLE = `
body{padding:0;height:100vh;overflow:hidden}
.ga{display:flex;flex-direction:column;height:100vh}
.ga-top{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);flex:none}
.chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;background:var(--hover);font-size:12px;white-space:nowrap}
.chip.warn{background:var(--warn-soft);color:var(--warn)}
.chip.ok{color:var(--ok)}
.pills{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--side);border:1px solid var(--border)}
.pills button{height:26px;padding:0 13px;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer}
.pills button.on{background:var(--accent-soft);color:var(--text);font-weight:600}
.ga-mid{flex:1;display:flex;min-height:0}
.ga-nav{width:212px;flex:none;background:var(--side);border-right:1px solid var(--border);padding:8px;display:flex;flex-direction:column;gap:1px;overflow:auto}
.ni{display:flex;gap:10px;align-items:center;width:100%;padding:6px 8px;border:0;border-radius:12px;background:transparent;color:var(--text);text-align:left;cursor:pointer}
.ni:hover{background:var(--hover)}
.ni.on{background:var(--accent-soft)}
.ni b{display:block;font-size:13px}
.ni small{display:block;font-size:11px;color:var(--muted)}
.ic{width:28px;height:28px;border-radius:9px;background:var(--hover);flex:none;position:relative}
.ic i{position:absolute}
.ga-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;padding:14px;overflow:auto}
.ga-main>*{flex-shrink:0}
.ga-main>.grow{flex:1 1 auto;flex-shrink:1;min-height:200px}
.ga-side{width:300px;flex:none;border-left:1px solid var(--border);padding:14px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.ga-side>*{flex-shrink:0}
.ga-foot{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid var(--border);flex:none;flex-wrap:wrap;min-height:44px;box-sizing:border-box;font-size:12px;color:var(--muted)}
.ga-foot b{color:var(--text)}
.linkbtn{border:0;background:none;color:var(--accent);cursor:pointer;padding:0;font:inherit}
.res{border-radius:14px;background:var(--side);border:1px solid var(--border);padding:12px 14px;display:flex;flex-direction:column;gap:5px}
.res .big{font-size:17px;font-weight:600;line-height:1.3}
.bigbtn{height:40px;border-radius:999px;font-size:14px;width:100%}
.sug{border-radius:14px;background:var(--accent-soft);padding:12px;display:flex;flex-direction:column;gap:8px;line-height:1.45}
.sug.warn{background:var(--warn-soft)}
.tw{border-radius:14px;border:1px solid var(--border);overflow:hidden;background:var(--side)}
.tw-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;font-weight:600}
.tw-row{border-top:1px solid var(--border);padding:7px 12px;display:flex;flex-direction:column;gap:6px;background:var(--bg)}
.tw-line{display:flex;align-items:center;gap:10px;min-height:30px}
.tw-lb{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.tw-hint{font-size:11px;color:var(--muted);line-height:1.4}
.tech{color:var(--muted);font-size:11px;font-weight:400}
.tw-more{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;font:inherit;text-align:left}
.tw-more:hover{background:var(--hover)}
.c-seg{display:flex;flex:none;padding:2px;border-radius:999px;background:var(--side);border:1px solid var(--border)}
.c-seg button{height:26px;padding:0 9px;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.c-seg button:hover{color:var(--text)}
.c-seg button.on{background:var(--accent);color:#fff;font-weight:600}
.c-seg.wide button{flex:1;padding:0 4px}
.c-sw{width:38px;height:22px;flex:none;border-radius:999px;border:0;padding:0;position:relative;background:var(--hover);cursor:pointer;box-shadow:inset 0 0 0 1px var(--border)}
.c-sw i{position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:var(--muted);transition:left .12s}
.c-sw.on{background:var(--accent);box-shadow:none}
.c-sw.on i{left:20px;background:#fff}
.c-st{display:flex;align-items:center;flex:none;padding:2px;border-radius:999px;background:var(--side);border:1px solid var(--border)}
.c-st button{width:26px;height:26px;border:0;border-radius:999px;background:var(--hover);color:var(--text);cursor:pointer;font:inherit;font-size:14px;line-height:1;padding:0}
.c-st button:hover:not(:disabled){background:var(--accent-soft)}
.c-st button:disabled{opacity:.4;cursor:default}
.c-st b,.c-st label{min-width:48px;display:flex;align-items:center;justify-content:center;gap:2px;font-size:12px;font-weight:600}
.c-st input{min-width:2ch;max-width:6ch;border:0;background:transparent;color:var(--text);font:inherit;font-weight:600;text-align:center;padding:0;height:24px;-moz-appearance:textfield;appearance:textfield}
.c-st input::-webkit-inner-spin-button,.c-st input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.c-st span{color:var(--muted);font-weight:400}
.c-sel{position:relative;flex:none;max-width:150px;display:flex}
.c-sel select{appearance:none;-webkit-appearance:none;height:28px;max-width:150px;padding:0 26px 0 10px;border-radius:8px;border:1px solid var(--border);background:var(--hover);color:var(--text);font:inherit;font-size:12px;cursor:pointer;text-overflow:ellipsis}
.c-sel::after{content:"▾";position:absolute;right:9px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;font-size:11px}
.c-txt{height:28px;width:120px;flex:none;border-radius:8px;border:1px solid var(--border);background:var(--side);color:var(--text);font:inherit;font-size:12px;padding:0 8px;box-sizing:border-box}
.modes{display:flex;gap:8px}
.mode{flex:1;min-width:0;border-radius:14px;border:1px solid var(--border);background:var(--side);padding:10px 12px;display:flex;flex-direction:column;gap:3px;text-align:left;color:var(--text);cursor:pointer;font:inherit}
.mode.on{border:2px solid var(--accent);background:var(--accent-soft);padding:9px 11px}
.mode small{color:var(--muted);font-size:12px;line-height:1.35}
.mode .why{color:var(--ok);font-size:12px}
.chk{background-color:var(--bg);background-image:conic-gradient(var(--tile) 25%,transparent 0 50%,var(--tile) 0 75%,transparent 0);background-size:16px 16px;border:1px solid var(--border);border-radius:12px}
.stage{flex:1;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px;position:relative}
.stage canvas{display:block;width:100%;height:100%;object-fit:contain}
.pair{display:flex;gap:10px}
.pair>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.strip{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.strip .it{width:80px;flex:none;text-align:center;font-size:11px;cursor:pointer;border-radius:10px;padding:4px 2px;border:0;background:transparent;color:var(--text)}
.strip .it.on{background:var(--accent-soft)}
.strip .it img,.strip .it canvas{width:56px;height:48px;object-fit:contain;border-radius:8px;background:var(--tile);display:block;margin:0 auto 3px}
.strip .it span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog{height:6px;border-radius:3px;background:var(--hover);overflow:hidden;width:150px}
.prog i{display:block;height:100%;background:var(--accent)}
.meter{height:8px;border-radius:4px;background:var(--hover);overflow:hidden;flex:1}
.meter i{display:block;height:100%;background:var(--ok)}
.card{border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--side)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.task{border-radius:14px;border:1px solid var(--border);background:var(--side);padding:12px;display:flex;flex-direction:column;gap:5px;text-align:left;color:var(--text);cursor:pointer;font:inherit;line-height:1.4}
.task:hover{border-color:var(--muted)}
.task.off{opacity:.62}
.rec{border:2px solid var(--accent);background:var(--accent-soft);flex-direction:row;align-items:center;gap:16px;padding:16px}
.badge{display:inline-flex;align-items:center;height:20px;padding:0 9px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;font-weight:700}
.slotrow{display:flex;align-items:center;gap:12px;border-radius:14px;border:1px solid var(--border);background:var(--side);padding:9px 12px}
.slotrow.drop{border:2px dashed var(--accent);padding:8px 11px}
.slotrow.picked{border-color:var(--accent)}
.cb{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex:none}
.thumb{width:58px;height:58px;border-radius:10px;flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}
.thumb img,.thumb canvas{width:100%;height:100%;object-fit:cover}
.tray{display:flex;gap:8px;flex-wrap:wrap}
.tray .tt{width:132px;display:flex;flex-direction:column;gap:3px;padding:7px;border-radius:12px;border:1px solid var(--border);background:var(--side);cursor:grab;font-size:11px}
.tray .tt img{width:100%;height:56px;object-fit:cover;border-radius:7px;background:var(--tile)}
.tray .tt.unused{border:1px dashed var(--warn)}
.tray .tt span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grp{border-radius:14px;border:1px solid var(--border);background:var(--side);padding:12px;display:flex;gap:14px;align-items:center}
.grp.hl{border-color:var(--accent)}
.grp.bad{background:var(--warn-soft);border-color:transparent}
.grp .th{display:flex;gap:4px;flex:none}
.grp .th img{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--tile)}
.prob{border-radius:14px;border:1px solid var(--border);background:var(--side);padding:11px 14px;display:flex;gap:12px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.ring{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.ring>div{width:54px;height:54px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:700}
.floatbar{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px 6px 6px 14px;border-radius:999px;background:var(--side);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:nowrap;max-width:calc(100% - 20px);flex-wrap:wrap}
.btn.small{height:28px;padding:0 11px;border-radius:999px}
.btn{border-radius:999px}
.sl{display:flex;flex-direction:column;align-items:stretch;gap:4px;flex:1;min-width:140px}
.sl input[type=range]{width:100%;accent-color:var(--accent)}
.anchor{display:grid;grid-template-columns:repeat(3,24px);gap:3px}
.anchor button{width:24px;height:20px;border-radius:6px;border:1px solid var(--border);background:var(--bg);padding:0;cursor:pointer}
.anchor button.on{background:var(--accent);border-color:var(--accent)}
.empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:24px;line-height:1.5}
.ga table{table-layout:fixed}
.ga th{max-width:none}
`;

// ---------- drobne elementy ----------

let dismissed = new Set(); // odrzucone podpowiedzi
let editDest = false;

/** Ikony narzędzi (rysowane CSS-em, kolory z motywu). */
function icon(k) {
  const a = "var(--accent)", t = "var(--text)", m = "var(--muted)";
  const S = {
    start: `inset:7px;border-radius:50%;border:2px solid ${a}`,
    resize: `left:7px;top:7px;width:10px;height:10px;border:2px dashed ${t};border-radius:3px`,
    atlas: `left:7px;top:7px;width:6px;height:6px;background:${t};border-radius:2px;box-shadow:8px 0 0 ${t},0 8px 0 ${t},8px 8px 0 ${m}`,
    slice: `left:6px;top:6px;width:16px;height:16px;border-radius:3px;background:linear-gradient(var(--hover),var(--hover)) 50% 0/2px 100% no-repeat,linear-gradient(var(--hover),var(--hover)) 0 50%/100% 2px no-repeat,${t}`,
    channels: "left:6px;top:8px;width:4px;height:12px;border-radius:3px;background:#d0453a;box-shadow:6px 0 0 #3b9a4b,12px 0 0 #3f6fd8",
    normal: "left:6px;top:6px;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#c8b4ff,#8080ff 55%,#5a4ad0)",
    convert: `left:6px;top:6px;width:16px;height:16px;border-radius:4px;border:2px solid ${t};box-sizing:border-box;border-top-width:6px`,
    check: "left:10px;top:5px;width:6px;height:12px;border:solid var(--ok);border-width:0 3px 3px 0;transform:rotate(45deg)",
  };
  return el("span", { class: "ic", "aria-hidden": "true" }, el("i", { style: S[k] }));
}

function slider(k, label, min, max, unit = "%") {
  const out = el("span", { class: "muted" }, `${opt[k]}${unit}`);
  return el("label", { class: "sl" }, el("span", { class: "row", style: "justify-content:space-between" }, label, out),
    el("input", { type: "range", min, max, value: String(opt[k]), oninput: (e) => { opt[k] = Number(e.target.value); out.textContent = `${opt[k]}${unit}`; liveUpdate(); }, onchange: () => { save(); draw(); } }));
}
let liveTimer = 0;
function liveUpdate() { clearTimeout(liveTimer); liveTimer = setTimeout(() => { if (opt.tab === "normal") renderNormalPreview(gen); }, 60); }

// ---------- kontrolki panelu „Ustawienia” ----------
const same = (a, b) => String(a) === String(b);
/** Segment: 2–7 krótkich opcji obok siebie. */
function segC(k, options, after, wide) {
  return el("div", { class: "c-seg" + (wide ? " wide" : ""), role: "group" }, options.map(([v, l, title]) => el("button", { class: same(opt[k], v) ? "on" : "", title: title || null, "aria-pressed": String(same(opt[k], v)), onclick: () => { opt[k] = v; save(); if (after) after(v); draw(); } }, l)));
}
/** Przełącznik tak/nie. */
function swC(k, after, label) {
  const on = !!opt[k];
  return el("button", { class: "c-sw" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": label || null, onclick: () => { opt[k] = !on; save(); if (after) after(!on); draw(); } }, el("i"));
}
/** Liczba z przyciskami − / +. `fmt` – jak pokazać wartość (np. 0 → „auto”). */
function stepC(k, { min = 0, max = 99999, step = 1, unit = "", fmt, after } = {}) {
  const val = Number(opt[k]) || 0;
  const put = (v) => { v = Math.max(min, Math.min(max, Math.round(v))); if (v === Number(opt[k])) return; opt[k] = v; save(); if (after) after(v); draw(); };
  const shown = fmt ? fmt(val) : null;
  return el("div", { class: "c-st" },
    el("button", { "aria-label": T("mniej", "less"), disabled: val <= min, onclick: () => put(val - step) }, "−"),
    shown != null ? el("b", {}, shown) : el("label", {}, el("input", { type: "number", value: String(val), min, max, style: `width:${String(val).length + 1}ch`, "aria-label": T("wartość", "value"), onchange: (e) => put(Number(e.target.value)) }), unit ? el("span", {}, unit) : null),
    el("button", { "aria-label": T("więcej", "more"), disabled: val >= max, onclick: () => put(val + step) }, "+"));
}
/** Lista rozwijana dla dłuższych wyborów. */
function selC(k, options, after) {
  return el("span", { class: "c-sel" }, el("select", { onchange: (e) => { const o = options.find(([v]) => String(v) === e.target.value); opt[k] = o ? o[0] : e.target.value; save(); if (after) after(opt[k]); draw(); } },
    options.map(([v, l]) => el("option", { value: String(v), selected: same(opt[k], v) }, l))));
}
/** Krótkie pole tekstowe. */
function txtC(k, placeholder, width) { return el("input", { class: "c-txt", type: "text", value: String(opt[k] ?? ""), placeholder: placeholder || "", style: width ? `width:${width}px` : null, onchange: (e) => set(k, e.target.value) }); }

let advOpen = new Set(); // zakładki z rozwiniętym „Więcej ustawień”
/**
 * Panel „Ustawienia”: każde ustawienie od razu jako kontrolka.
 * Wiersz: { id, label, sub?, ctl: () => węzeł, wide? (kontrolka pod etykietą), hint? (mały tekst pod spodem), adv? (pod „Więcej ustawień”) }
 */
function tweaks(rows, note) {
  rows = rows.filter(Boolean);
  const row = (r) => el("div", { class: "tw-row" + (r.wide ? " wide" : ""), "data-id": r.id },
    el("div", { class: "tw-line" }, el("span", { class: "tw-lb" }, r.label, r.sub ? el("span", { class: "tech" }, r.sub) : null), r.wide ? null : r.ctl()),
    r.wide ? r.ctl() : null,
    r.hint ? el("span", { class: "tw-hint" }, r.hint) : null);
  const main = rows.filter((r) => !r.adv), adv = rows.filter((r) => r.adv), isOpen = advOpen.has(opt.tab);
  return el("div", { class: "col", style: "gap:8px" },
    el("div", { class: "tw" },
      el("div", { class: "tw-hd" }, T("Ustawienia", "Settings"), el("span", { class: "tech", style: "margin-left:auto" }, note || T("dobrane automatycznie", "chosen automatically"))),
      main.map(row), isOpen ? adv.map(row) : null),
    adv.length ? el("button", { class: "tw-more", "aria-expanded": String(isOpen), onclick: () => { if (isOpen) advOpen.delete(opt.tab); else advOpen.add(opt.tab); draw(); } },
      el("span", { style: "white-space:nowrap;flex:none" }, isOpen ? T("Mniej ustawień", "Fewer settings") : T("Więcej ustawień", "More settings")),
      isOpen ? null : el("span", { class: "tech", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" }, adv.map((r) => r.short ?? r.label).filter(Boolean).join(", ").toLowerCase()),
      el("span", { style: "margin-left:auto" }, isOpen ? "▴" : "▾")) : null);
}

function resCard(label, big, ...rest) { return el("div", { class: "res" }, el("span", { class: "small muted" }, label), el("span", { class: "big" }, big), rest); }
function mainBtn(label, run, disabled) { return el("button", { class: "btn primary bigbtn", disabled: !!busy || !!disabled, onclick: run }, busy ? busy.label : label); }
function suggestion(id, text, applyLabel, apply, warn) {
  if (dismissed.has(id)) return null;
  return el("div", { class: "sug" + (warn ? " warn" : "") }, el("b", {}, warn ? T("Uwaga", "Heads-up") : T("Mogę zrobić lepiej", "I can do better")), el("span", {}, text),
    el("div", { class: "row" }, applyLabel ? el("button", { class: "btn primary small", onclick: apply }, applyLabel) : null, el("button", { class: "btn small", onclick: () => { dismissed.add(id); draw(); } }, applyLabel ? T("Nie, dziękuję", "No, thanks") : T("OK", "OK"))));
}
function needFiles(text) { return el("div", { class: "empty" }, text || T("Zaznacz obrazy w Wayfolderze i otwórz Game Assets z menu pod prawym przyciskiem.", "Select images in Wayfolder and open Game Assets from the right-click menu.")); }
const nFiles = (n) => (PL ? `${n} ${n === 1 ? "obraz" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "obrazy" : "obrazów"}` : `${n} image${n === 1 ? "" : "s"}`);
const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

/** Pasek miniatur; kliknięcie wybiera plik do podglądu. `sub(p)` – tekst pod nazwą (może się uzupełnić później przez data-sub). */
function strip(sub) {
  const shown = paths.slice(0, 60);
  return el("div", { class: "strip" }, shown.map((p, i) => el("button", { class: "it" + (i === focus ? " on" : ""), title: baseName(p), onclick: () => { focus = i; draw(); } }, thumb(p, 56), el("span", {}, baseName(p)), sub ? el("span", { class: "muted", "data-sub": p }, sub(p) || "") : null)),
    paths.length > shown.length ? el("span", { class: "muted small", style: "align-self:center" }, `+${paths.length - shown.length}`) : null);
}
function stageBox(id, label, extra) {
  return el("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1;min-height:0" },
    el("div", { class: "small muted", id: id + "-label" }, label || ""),
    el("div", { class: "stage chk", id }, el("span", { class: "muted small" }, T("Wczytywanie…", "Loading…")), extra || null));
}

function resultCard() {
  if (!result || result.tab !== opt.tab) return null;
  return el("div", { class: "card" },
    el("b", { class: result.errors.length ? "warn" : "ok" }, T(`Gotowe – zapisane pliki: ${result.done}`, `Done – files saved: ${result.done}`) + (result.errors.length ? T(` · problemy: ${result.errors.length}`, ` · problems: ${result.errors.length}`) : "")),
    result.notes.map((n) => el("div", { class: "small muted", style: "margin-top:4px" }, n)),
    result.errors.length ? el("div", { class: "small", style: "margin-top:6px" }, result.errors.slice(0, 12).map((e) => el("div", {}, e))) : null,
    el("div", { class: "small muted", style: "margin-top:6px" }, T("Coś nie tak? „Cofnij” w Dzienniku Wayfoldera usuwa nowe pliki.", "Something wrong? Undo in Wayfolder's Journal removes the new files.")));
}

/** Gdzie trafią pliki – zdanie i edycja po kliknięciu „zmień”. */
function footer(custom) {
  if (custom) return el("div", { class: "ga-foot" }, custom, busyBar());
  if (editDest) return el("div", { class: "ga-foot" },
    el("span", {}, T("Zapisz do", "Save to")),
    seg([["sub", T("podfolderu obok oryginału", "subfolder next to original")], ["same", T("tego samego folderu", "same folder")], ["custom", T("innego folderu", "another folder")]], opt.where, (v) => set("where", v)),
    opt.where === "sub" ? el("input", { type: "text", value: opt.sub, style: "width:110px", "aria-label": T("Nazwa podfolderu", "Subfolder name"), onchange: (e) => set("sub", e.target.value.replace(/[\\/:*?"<>|]/g, "") || "game") }) : null,
    opt.where === "custom" ? el("input", { type: "text", value: opt.custom, placeholder: "D:\\Gra\\Assets\\Sprites", style: "width:260px", "aria-label": T("Folder docelowy", "Target folder"), onchange: (e) => set("custom", e.target.value.trim()) }) : null,
    el("button", { class: "btn small", onclick: () => { editDest = false; draw(); } }, T("Gotowe", "Done")), busyBar());
  const p = paths[0];
  const where = !p ? "" : opt.where === "same" ? T("w tym samym folderze co oryginały", "in the same folder as the originals") : opt.where === "custom" ? (opt.custom || T("(podaj folder)", "(enter a folder)")) : `${baseName(dirOf(p)) || dirOf(p)}\\${opt.sub || "game"}`;
  return el("div", { class: "ga-foot" },
    el("span", {}, opt.where === "sub" ? T("Zapiszę obok oryginałów, w folderze ", "I'll save next to the originals, in ") : T("Zapiszę ", "I'll save "), el("b", {}, where)),
    el("button", { class: "linkbtn", onclick: () => { editDest = true; draw(); } }, T("zmień", "change")),
    el("span", { class: "muted" }, "· " + T("oryginały zostają, wszystko można cofnąć", "originals stay, everything can be undone")), busyBar());
}
function busyBar() {
  return busy ? el("span", { class: "row", style: "margin-left:auto" }, busy.label, el("span", { class: "prog" }, el("i", { style: `width:${Math.round((100 * busy.done) / Math.max(1, busy.total))}%` }))) : null;
}

function draw() {
  const g = ++gen;
  const views = { start: viewStart, resize: viewResize, atlas: viewAtlas, slice: viewSlice, channels: viewChannels, normal: viewNormal, convert: viewConvert, check: viewCheck };
  const t = views[opt.tab] ? opt.tab : "start";
  const v = views[t](g);
  const folder = paths.length ? baseName(dirOf(paths[0])) : "";
  const keep = snapshot(t);
  render(el("div", { class: "ga" },
    el("div", { class: "ga-top" },
      el("span", { class: "chip" }, nFiles(paths.length) + (folder ? ` · ${folder}` : "")),
      el("span", { class: "spacer" }),
      el("span", { class: "small muted" }, T("Robię pliki dla", "Making files for")),
      el("span", { class: "pills", role: "group", "aria-label": T("Silnik", "Engine") }, Object.entries(ENGINES).map(([k, e]) => el("button", { class: opt.engine === k ? "on" : "", "aria-pressed": String(opt.engine === k), onclick: () => setEngine(k) }, e.name)))),
    el("div", { class: "ga-mid" },
      el("nav", { class: "ga-nav", "aria-label": T("Narzędzia", "Tools") }, TABS.map(([k, l, h]) => el("button", { class: "ni" + (k === t ? " on" : ""), "aria-current": k === t ? "page" : null, onclick: () => { result = null; set("tab", k); } }, icon(k), el("span", {}, el("b", {}, l), el("small", {}, h))))),
      el("div", { class: "ga-main" }, v.main, resultCard()),
      el("div", { class: "ga-side" }, v.side)),
    footer(v.foot)));
  restore(keep);
}

// ---------- spokojne odświeżanie: bez skakania po kliknięciu ----------
// Po każdej zmianie ustawienia cały widok jest budowany od nowa. Żeby nic nie skakało:
// zostają pozycje przewinięcia, fokus klawiatury, a pola liczone w tle (wynik, podgląd,
// podpowiedzi) pokazują poprzednią treść, dopóki nie przyjdzie nowa – zamiast „Układam…”.
const KEEP_IDS = ["a-res", "a-sug", "a-note", "a-pages", "a-stage", "a-table", "r-res", "r-before", "r-after", "s-res", "s-stage", "s-strip"];
let lastTab = null, lastPaths = null;
function snapshot(tab) {
  const same = tab === lastTab && paths === lastPaths;
  lastTab = tab; lastPaths = paths;
  if (!same) return null;
  const q = (sel) => document.querySelector(sel);
  const scroll = {};
  for (const sel of [".ga-main", ".ga-side", ".ga-nav", "#a-table"]) { const e = q(sel); if (e) scroll[sel] = e.scrollTop; }
  const boxes = {};
  for (const id of KEEP_IDS) { const e = document.getElementById(id); if (e && e.childNodes.length) boxes[id] = { kids: [...e.childNodes], h: e.offsetHeight }; }
  // fokus: wiersz ustawień + który element w nim
  let focus = null;
  const a = document.activeElement;
  if (a && a !== document.body) {
    const row = a.closest("[data-id]");
    if (row) { const all = [...row.querySelectorAll("button,input,select")]; focus = { row: row.getAttribute("data-id"), i: all.indexOf(a) }; }
  }
  return { scroll, boxes, focus };
}
function restore(k) {
  if (!k) return;
  for (const [id, b] of Object.entries(k.boxes)) {
    const e = document.getElementById(id);
    if (!e) continue;
    e.replaceChildren(...b.kids);
    if (id.endsWith("-stage")) e.style.minHeight = b.h + "px"; // podgląd nie zapada się na chwilę
  }
  for (const [sel, top] of Object.entries(k.scroll)) { const e = document.querySelector(sel); if (e) e.scrollTop = top; }
  if (k.focus) {
    const row = document.querySelector(`.ga-side [data-id="${k.focus.row}"]`);
    const all = row ? [...row.querySelectorAll("button,input,select")] : [];
    const f = all[k.focus.i] || all[0];
    if (f) f.focus({ preventScroll: true });
  }
}

// =====================================================================================================
// 0. Co zrobić? (start)
// =====================================================================================================

let startInfo = null; // { key, alpha, sheet, maxSide }
function startKey() { return paths.join("|"); }

function recommend() {
  const sets = groupSets(paths).filter((s) => Object.keys(s.maps).length >= 2);
  const normals = paths.filter(isNormalName).length;
  const info = startInfo && startInfo.key === startKey() ? startInfo : null;
  if (sets.length) return { tab: "channels", why: T(`Rozpoznałem mapy PBR (${sets.map((s) => s.base).join(", ")}). Silnik czyta je jako jedną teksturę – połączę je w kanały.`, `I recognised PBR maps (${sets.map((s) => s.base).join(", ")}). The engine reads them as one texture – I'll pack them into channels.`) };
  if (paths.length === 1 && info && info.sheet) return { tab: "slice", why: T(`To arkusz z ${info.sheet} klatkami – potnę go na osobne pliki.`, `This is a sheet with ${info.sheet} frames – I'll slice it into files.`) };
  if (normals && normals === paths.length) return { tab: "convert", why: T("To normal mapy – przygotuję je w formacie i kierunku, jakiego oczekuje silnik.", "These are normal maps – I'll prepare them in the format and direction the engine expects.") };
  if (paths.length >= 2 && info && info.alpha && info.maxSide <= 8192) return { tab: "atlas", why: T(`To ${paths.length} elementów z przezroczystym tłem. W grze najlepiej trzymać je w jednym pliku – mniej wczytywania i szybsze rysowanie.`, `These are ${paths.length} elements with transparent backgrounds. In a game they're best kept in one file – less loading, faster drawing.`) };
  return { tab: "resize", why: T("Dopasuję rozmiar do potęgi 2 – tego oczekuje silnik przy kompresji i mipmapach.", "I'll fit the size to a power of 2 – what the engine expects for compression and mipmaps.") };
}

function fitText(tab) {
  const sets = groupSets(paths).filter((s) => Object.keys(s.maps).length >= 2);
  switch (tab) {
    case "atlas": return paths.length >= 2 ? [true, T("Pasuje", "Fits")] : [false, T("Zaznacz co najmniej 2 obrazy", "Select at least 2 images")];
    case "slice": return paths.length === 1 ? [true, T("Pasuje", "Fits")] : [false, T("Zaznacz jeden arkusz z klatkami", "Select one sheet with frames")];
    case "channels": return sets.length ? [true, T(`Rozpoznałem zestawy: ${sets.length}`, `Sets found: ${sets.length}`)] : [false, T("Nie widzę map PBR – możesz je wybrać ręcznie", "No PBR maps found – you can pick them manually")];
    default: return [true, T("Pasuje", "Fits")];
  }
}

function viewStart(g) {
  if (!paths.length) return { main: needFiles(), side: null };
  const rec = recommend();
  const tabInfo = Object.fromEntries(TABS.map(([k, l, h]) => [k, { l, h }]));
  const desc = {
    resize: T("Potęga 2 dla silnika, bez pustych brzegów, z zachowaniem proporcji.", "Power of 2 for the engine, no empty edges, proportions kept."),
    atlas: T("Wiele obrazków w jednym pliku + dane dla silnika.", "Many images in one file + data for the engine."),
    slice: T("Arkusz z klatkami animacji → osobne pliki.", "A sheet of animation frames → separate files."),
    channels: T("AO, Roughness i Metallic w jedną teksturę.", "AO, Roughness and Metallic in one texture."),
    normal: T("Wypukłości do świateł 2D albo normal mapa z tekstury.", "Bumps for 2D lights or a normal map from a texture."),
    convert: T("Format dobrany do silnika, normal mapy odwrócone, gdy trzeba.", "Format matched to the engine, normal maps flipped when needed."),
    check: T("Co poprawić, zanim wrzucisz pliki do gry.", "What to fix before the files go into the game."),
  };
  later(g, async () => {
    if (startInfo && startInfo.key === startKey()) return;
    let alpha = false, maxSide = 0, sheet = 0;
    for (const p of paths.slice(0, 12)) {
      const im = await load(p);
      maxSide = Math.max(maxSide, im.w, im.h);
      if (!alpha && alphaRange(im).lo < 250) alpha = true;
    }
    if (paths.length === 1) { const gr = detectGrid(await load(paths[0])); if (gr && gr.frames >= 4) sheet = gr.frames; }
    startInfo = { key: startKey(), alpha, maxSide, sheet };
    if (g === gen) draw();
  });
  const main = [
    el("div", {}, el("h2", { style: "font-size:20px;margin:0" }, T(`Co zrobić z ${paths.length === 1 ? "tym obrazem" : `tymi ${paths.length} obrazami`}?`, `What to do with ${paths.length === 1 ? "this image" : `these ${paths.length} images`}?`)),
      el("p", { class: "muted", style: "margin:4px 0 0" }, T("Wybierz zadanie – resztę ustawię sam. Każdą decyzję zmienisz potem w „Dostosuj”.", "Pick a task – I'll set up the rest. You can change any decision later in “Adjust”."))),
    el("button", { class: "task rec", onclick: () => { result = null; set("tab", rec.tab); } },
      icon(rec.tab),
      el("div", { style: "display:flex;flex-direction:column;gap:5px;flex:1" },
        el("div", { class: "row" }, el("span", { class: "badge" }, T("Polecam", "Recommended")), el("b", { style: "font-size:17px" }, tabInfo[rec.tab].l)),
        el("span", {}, rec.why)),
      el("span", { class: "btn primary", style: "height:38px;display:inline-flex;align-items:center;padding:0 18px" }, T("Zaczynamy", "Let's go"))),
    el("div", { class: "small muted" }, T("Albo inne zadanie", "Or another task")),
    el("div", { class: "cards" }, TABS.filter(([k]) => k !== "start" && k !== rec.tab).map(([k, l]) => {
      const [ok, ft] = fitText(k);
      return el("button", { class: "task" + (ok ? "" : " off"), onclick: () => { result = null; set("tab", k); } },
        el("span", { class: "row", style: "flex-wrap:nowrap" }, icon(k), el("b", {}, l)), el("span", {}, desc[k]), el("span", { class: "small", style: `color:var(${ok ? "--ok" : "--muted"})` }, ft));
    })),
  ];
  const sets = groupSets(paths);
  const lines = [];
  const anim = new Map();
  for (const p of paths) { const a = animOf(stemOf(p)); if (a !== stemOf(p)) anim.set(a, (anim.get(a) || 0) + 1); }
  for (const [a, n] of anim) if (n > 1) lines.push(T(`${n} klatki animacji „${a}”`, `${n} frames of “${a}” animation`));
  if (sets.length) lines.push(T(`mapy PBR: ${sets.map((s) => s.base).join(", ")}`, `PBR maps: ${sets.map((s) => s.base).join(", ")}`));
  const nn = paths.filter(isNormalName).length;
  if (nn) lines.push(T(`normal mapy: ${nn}`, `normal maps: ${nn}`));
  const info = startInfo && startInfo.key === startKey() ? startInfo : null;
  if (info) { lines.push(info.alpha ? T("przezroczyste tło", "transparent background") : T("obrazy bez przezroczystości", "images without transparency")); lines.push(T(`największy bok: ${info.maxSide} px`, `largest side: ${info.maxSide} px`)); }
  const side = [
    el("b", {}, T("Zaznaczone", "Selected")),
    el("div", { style: "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px" }, paths.slice(0, 9).map((p) => el("div", { class: "thumb chk", style: "width:auto;height:62px", title: baseName(p) }, thumb(p, 60)))),
    paths.length > 9 ? el("span", { class: "small muted" }, `+${paths.length - 9}`) : null,
    lines.length ? el("div", { class: "col", style: "gap:3px" }, el("span", {}, T("Rozpoznałem:", "I see:")), lines.map((l) => el("span", { class: "muted" }, "· " + l))) : null,
    el("div", { class: "card", style: "margin-top:auto" }, el("b", {}, T("Bez obaw", "No worries")), el("div", { class: "small muted", style: "margin-top:4px;line-height:1.45" }, T("Oryginały zostają nietknięte. Nowe pliki trafiają do Dziennika – „Cofnij” usuwa je jednym kliknięciem.", "Originals stay untouched. New files go to the Journal – Undo removes them in one click."))),
  ];
  return { main, side };
}

// =====================================================================================================
// 1. Dopasuj rozmiar
// =====================================================================================================

const RMODES = {
  texture: { trim: false, size: "pot", fit: "fit" },
  sprite: { trim: true, shared: false, size: "pot", fit: "pad" },
  anim: { trim: true, shared: true, size: "pot", fit: "pad" },
};
let resizeAuto = null; // { key, mode, why }
function animGroups() {
  const m = new Map();
  for (const p of paths) { const a = dirOf(p) + "|" + animOf(stemOf(p)); if (animOf(stemOf(p)) !== stemOf(p)) m.set(a, (m.get(a) || 0) + 1); }
  return [...m.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);
}
function setRMode(mode) { opt.rMode = mode; Object.assign(opt, RMODES[mode]); save(); draw(); }
const curRMode = () => (opt.rMode === "auto" ? (resizeAuto && resizeAuto.mode) || "texture" : opt.rMode);

function viewResize(g) {
  if (!paths.length) return { main: needFiles(), side: null };
  // tryb automatyczny: klatki animacji → wspólny kadr; przezroczyste brzegi → sprite; reszta → tekstura
  if (opt.rMode === "auto" && (!resizeAuto || resizeAuto.key !== startKey())) {
    later(g, async () => {
      let mode = "texture", why = T("to obrazy bez pustych brzegów", "images without empty edges");
      if (animGroups() >= 2) { mode = "anim"; why = T(`widzę ${animGroups()} klatki animacji`, `I see ${animGroups()} animation frames`); }
      else {
        let border = 0;
        for (const p of paths.slice(0, 12)) { const im = await load(p); const b = bbox(im, 2); if (b && b.w * b.h < im.w * im.h * 0.85) border++; }
        if (border > 0) { mode = "sprite"; why = T("obrazy mają przezroczyste brzegi", "images have transparent edges"); }
      }
      resizeAuto = { key: startKey(), mode, why };
      Object.assign(opt, RMODES[mode]);
      if (g === gen) draw();
    });
  }
  const mode = curRMode();
  const why = opt.rMode === "auto" && resizeAuto ? resizeAuto.why : null;
  const card = (k, t, d) => el("button", { class: "mode" + (mode === k ? " on" : ""), "aria-pressed": String(mode === k), onclick: () => setRMode(k) }, el("b", {}, t), el("small", {}, d), mode === k && why ? el("span", { class: "why" }, T("Wybrane – ", "Picked – ") + why) : null);
  const main = [
    el("div", { class: "modes" },
      card("texture", T("Tekstura lub tło", "Texture or background"), T("Cały obraz do potęgi 2, proporcje zachowane", "Whole image to a power of 2, proportions kept")),
      card("sprite", T("Sprite / element UI", "Sprite / UI element"), T("Przytnę puste brzegi i dopełnię do potęgi 2 – bez skalowania", "I'll trim empty edges and pad to a power of 2 – no scaling")),
      card("anim", T("Klatki animacji", "Animation frames"), T("Wspólny kadr dla klatek, żeby animacja nie skakała", "A shared frame so the animation doesn't jump"))),
    el("div", { class: "pair grow" }, stageBox("r-before", T("Teraz", "Now")), stageBox("r-after", T("Po", "After"))),
    strip(() => "…"),
  ];
  const side = [
    el("div", { id: "r-res" }, resCard(T("Wynik dla tego obrazu", "Result for this image"), "…")),
    mainBtn(T(`Przygotuj ${nFiles(paths.length)}`, `Prepare ${nFiles(paths.length)}`), runResize),
    tweaks(resizeRows(mode)),
  ];
  later(g, async () => {
    const p = paths[Math.min(focus, paths.length - 1)];
    const im = await load(p);
    if (g !== gen) return;
    const groups = opt.trim && opt.shared ? await sharedRects(paths) : new Map();
    if (g !== gen) return;
    const shared = groups.get(seqKey(p, im)) || null;
    const plan = planResize(im, shared);
    putText("r-before-label", T(`Teraz · ${baseName(p)} · ${im.w} × ${im.h}`, `Now · ${baseName(p)} · ${im.w} × ${im.h}`));
    if (!plan) { put("r-before", canvasOf(im)); put("r-after", el("span", { class: "warn small" }, ERR.empty)); return; }
    put("r-before", canvasOf(im, opt.trim ? [{ ...plan.rect, dash: true }] : []));
    // podgląd bez „ochrony krawędzi” – nie zmienia widocznych pikseli, a kosztuje
    const out = memo("r|" + p + "|" + JSON.stringify(plan), () => applyResize(im, plan, false));
    putText("r-after-label", T(`Po · ${plan.W} × ${plan.H}`, `After · ${plan.W} × ${plan.H}`) + (shared ? T(` · wspólny kadr „${animOf(stemOf(p))}”`, ` · shared frame “${animOf(stemOf(p))}”`) : ""));
    put("r-after", canvasOf(out, [{ x: 0, y: 0, w: out.w, h: out.h }]));
    const sc = plan.scale && Math.abs(plan.scale - 1) > 0.005;
    const sentence = [
      sc ? T(`${plan.scale < 1 ? "Zmniejszę" : "Powiększę"} do ${Math.round(plan.scale * 100)}%`, `${plan.scale < 1 ? "Shrink" : "Enlarge"} to ${Math.round(plan.scale * 100)}%`) : opt.trim ? T(`Przytnę puste brzegi (${plan.rect.w} × ${plan.rect.h})`, `Trim empty edges (${plan.rect.w} × ${plan.rect.h})`) : T("Bez skalowania", "No scaling"),
      plan.waste > 0.005 ? T(`, a resztę wypełni przezroczystość (${Math.round(plan.waste * 100)}% pustego miejsca).`, `; the rest is transparent (${Math.round(plan.waste * 100)}% empty).`) : ".",
    ].join("");
    put("r-res", resCard(T("Wynik dla tego obrazu", "Result for this image"), `${im.w} × ${im.h} → ${plan.W} × ${plan.H}`,
      el("span", { style: "line-height:1.45" }, sentence),
      plan.scale > 1.01 ? el("span", { class: "small warn" }, T("Powiększenie – obraz może być lekko rozmyty.", "Upscaled – the image may look soft.")) : null));
    // rozmiary wszystkich plików w pasku
    for (const q of paths.slice(0, 60)) {
      const iq = await load(q);
      if (g !== gen) return;
      const pq = planResize(iq, groups.get(seqKey(q, iq)) || null);
      const elq = document.querySelector(`[data-sub="${CSS.escape(q)}"]`);
      if (elq) elq.textContent = pq ? `${pq.W} × ${pq.H}` : "–";
    }
  });
  return { main, side };
}

function resizeRows(mode) {
  const anchorGrid = () => el("div", { class: "anchor", role: "group", "aria-label": T("Położenie", "Position") }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => el("button", { class: opt.anchor === i ? "on" : "", "aria-label": ANCHORS[i], title: ANCHORS[i], onclick: () => set("anchor", i) })));
  const tex = mode === "texture";
  return [
    tex ? { id: "long", label: T("Dłuższy bok", "Longer side"), wide: true, ctl: () => segC("fitLong", [["auto", "auto"], [512, "512"], [1024, "1024"], [2048, "2048"], [4096, "4096"], ["up", "↑", T("najbliższa potęga 2 w górę", "nearest power of 2 up")], ["down", "↓", T("najbliższa potęga 2 w dół", "nearest power of 2 down")]], null, true), hint: T("Auto: najmniej pustego miejsca bez dużego powiększania. ↑ / ↓ – najbliższa potęga 2 w górę lub w dół.", "Auto: least empty space without big upscaling. ↑ / ↓ – nearest power of 2 up or down.") } : null,
    tex ? { id: "short", label: T("Puste miejsce", "Empty space"), sub: T("krótszy bok", "shorter side"), ctl: () => selC("fitShort", [["pot", T("do potęgi 2", "to power of 2")], ["mul4", T("jak najmniej (× 4)", "minimal (× 4)")], ["square", T("kwadrat", "square")]]) } : null,
    tex ? { id: "shape", label: T("Proporcje", "Proportions"), adv: true, ctl: () => segC("fit", [["fit", T("zachowaj", "keep")], ["scale", T("rozciągnij", "stretch")]]) } : null,
    !tex ? { id: "trim", label: T("Przytnij puste brzegi", "Trim empty edges"), ctl: () => swC("trim") } : null,
    !tex && opt.trim ? { id: "margin", label: T("Margines po przycięciu", "Margin after trim"), ctl: () => stepC("margin", { min: 0, max: 64, unit: "px" }) } : null,
    !tex ? { id: "size", label: T("Rozmiar pliku", "File size"), ctl: () => selC("size", [["pot", T("potęga 2", "power of 2")], ["mul4", T("wielokrotność 4", "multiple of 4")], ["none", T("tylko przycięcie", "trim only")]]) } : null,
    mode === "anim" ? { id: "shared", label: T("Wspólny kadr klatek", "Shared frame"), sub: T("hero_walk_00, _01…", "hero_walk_00, _01…"), ctl: () => swC("shared") } : null,
    { id: "anchor", label: T("Gdzie stoi obraz", "Image position"), sub: ANCHORS[opt.anchor], ctl: anchorGrid, hint: T("Postacie: dół-środek – stoją na ziemi.", "Characters: bottom-center keeps them grounded.") },
    { id: "bleed", label: T("Ochrona krawędzi", "Edge protection"), sub: "alpha bleeding", ctl: () => swC("rBleed") },
    { id: "fmt", label: T("Format", "Format"), ctl: () => selC("rFmt", [["same", T("jak oryginał", "as original")], ["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]]) },
    { id: "max", label: T("Maks. bok", "Max side"), adv: true, ctl: () => selC("max", [[1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"]]) },
    !tex && opt.trim ? { id: "thr", label: T("Próg przezroczystości", "Alpha threshold"), short: T("próg", "threshold"), adv: true, ctl: () => stepC("thr", { min: 0, max: 254 }) } : null,
    !tex ? { id: "json", label: T("Zapisz przesunięcia", "Save offsets"), sub: "trim.json", short: "trim.json", adv: true, ctl: () => swC("json") } : null,
    { id: "suffix", label: T("Dopisek do nazwy", "Name suffix"), short: T("dopisek", "suffix"), adv: true, ctl: () => txtC("rSuffix", "_game", 100) },
  ];
}

// =====================================================================================================
// 2. Złóż w atlas
// =====================================================================================================

let atlasListOpen = false;
function viewAtlas(g) {
  if (paths.length < 1) return { main: needFiles(T("Zaznacz obrazki (co najmniej dwa) i wybierz „Game Assets: atlas z zaznaczonych”.", "Select images (at least two) and choose “Game Assets: atlas from selection”.")), side: null };
  const hasCfg = paths.some((p) => atlasCfg[p.toLowerCase()]);
  const main = [
    el("div", { class: "row" }, el("b", { style: "font-size:15px" }, T("Podgląd atlasu", "Atlas preview")), el("span", { class: "small muted" }, T("kliknij obrazek, żeby go zaznaczyć · Ctrl – kilka", "click an image to select it · Ctrl – several")), el("span", { class: "spacer" }), el("span", { id: "a-pages" })),
    el("div", { class: "stage chk grow", id: "a-stage" }, el("span", { class: "muted small" }, T("Układam…", "Packing…"))),
    el("div", { id: "a-note", class: "col small" }),
    el("div", { class: "row" }, el("button", { class: "linkbtn", onclick: () => { atlasListOpen = !atlasListOpen; draw(); } }, (atlasListOpen ? "▾ " : "▸ ") + T(`Lista obrazków (${paths.length})`, `Image list (${paths.length})`)),
      el("span", { class: "spacer" }), aSel.size ? null : el("button", { class: "btn small", onclick: () => { aSel = new Set(paths); draw(); } }, T("Zaznacz wszystkie", "Select all"))),
    atlasListOpen ? el("div", { id: "a-table", style: "max-height:220px;overflow:auto" }) : null,
  ];
  const side = [el("div", { id: "a-res" }, resCard(T("Wynik", "Result"), T("Układam…", "Packing…"))), mainBtn(T("Zrób atlas", "Build atlas"), runAtlas), el("div", { id: "a-sug", class: "col", style: "gap:10px" }), tweaks(atlasRows(hasCfg))];
  later(g, async () => {
    await new Promise((r) => setTimeout(r, 0));
    const a = await atlasNow();
    if (g !== gen) return;
    const { pages, tooBig } = a.layout;
    if (atlasPage >= pages.length) atlasPage = 0;
    put("a-pages", pages.length > 1 ? seg(pages.map((_, i) => [i, T(`Plik ${i + 1}`, `File ${i + 1}`)]), atlasPage, (v) => { atlasPage = v; draw(); }) : el("span", {}));
    const dataName = { godot: T("animacje i pozycje dla Godota (.tres)", "animations and positions for Godot (.tres)"), "tp-hash": T("pozycje obrazków (JSON)", "image positions (JSON)"), "tp-array": T("pozycje obrazków (JSON)", "image positions (JSON)"), csv: T("pozycje obrazków (CSV)", "image positions (CSV)"), none: T("bez danych", "no data") }[opt.aData];
    put("a-res", resCard(T("Wynik", "Result"), T(`${nFiles(a.sprites.length - tooBig.length)} → ${pages.length} ${plural(pages.length, "plik", "pliki", "plików")} ${pagesText(a.layout)}`, `${nFiles(a.sprites.length - tooBig.length)} → ${pages.length} file${pages.length === 1 ? "" : "s"} ${pagesText(a.layout)}`),
      el("div", { class: "row" }, el("span", { class: "meter" }, el("i", { style: `width:${Math.round(a.fill * 100)}%;background:var(${a.fill < 0.5 ? "--warn" : "--ok"})` })), el("span", { class: "small" }, T(`${pct(a.fill)} wypełnione`, `${pct(a.fill)} filled`))),
      opt.aData !== "none" ? el("span", { class: "small muted" }, "+ " + dataName) : null,
      a.g < 1 ? el("span", { class: "small muted" }, T(`obrazki zmniejszone do ${pct(a.g)}`, `images scaled to ${pct(a.g)}`)) : null));
    // podpowiedzi
    const sug = [];
    if (a.fitSug) sug.push(suggestion("fit", T(`Zmniejszę obrazki o ${100 - Math.round(a.fitSug.g * 100)}% i atlas zmieści się w ${pagesText(a.fitSug.layout)} – ${a.fitSug.saving}% mniej pamięci.`, `I'll shrink the images by ${100 - Math.round(a.fitSug.g * 100)}% and the atlas fits ${pagesText(a.fitSug.layout)} – ${a.fitSug.saving}% less memory.`), T("Zastosuj", "Apply"), () => { opt.aFit = true; opt.aFitMax = Math.max(Number(opt.aFitMax) || 0, Math.ceil(100 - a.fitSug.g * 100) + 1); save(); atlasCache = null; draw(); }));
    if (a.alt && !eng().pot) sug.push(suggestion("mul4", T(`Plik potęgi 2 jest wypełniony tylko w ${pct(a.fill)}. Z rozmiarem „× 4” wyjdzie ${pagesText(a.alt.layout)}, wypełnienie ${pct(a.alt.fill)}.`, `The power-of-2 file is only ${pct(a.fill)} filled. With “× 4” size it's ${pagesText(a.alt.layout)}, ${pct(a.alt.fill)} filled.`), T("Zastosuj", "Apply"), () => set("aPage", "mul4")));
    const shrunk = a.sprites.filter((s) => s.shrink < 1);
    if (shrunk.length) sug.push(suggestion("big", T(`Za duże na plik ${opt.aMax} px – zmniejszyłem: ${shrunk.map((s) => `${s.name} (${pct(s.scale)})`).join(", ")}. Wolisz większy plik? Zmień „Maks. rozmiar pliku”.`, `Too big for a ${opt.aMax} px file – scaled down: ${shrunk.map((s) => `${s.name} (${pct(s.scale)})`).join(", ")}. Prefer a bigger file? Change “Max file size”.`), null, null, true));
    if (tooBig.length) sug.push(suggestion("skip", T(`Pominięte (większe niż plik): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`, `Skipped (bigger than the file): ${tooBig.map((i) => a.sprites[i].name).join(", ")}`), null, null, true));
    put("a-sug", el("div", { class: "col", style: "gap:10px" }, sug.filter(Boolean)));
    const pg = pages[atlasPage];
    const notes = [];
    if (opt.aMode === "grid" && pg) notes.push(el("span", { class: "muted" }, T(`Siatka: komórka ${a.layout.cell[0]} × ${a.layout.cell[1]}, ${pg.cols} kolumn, odstęp ${opt.aPad} px – tak ustaw cięcie w silniku.`, `Grid: cell ${a.layout.cell[0]} × ${a.layout.cell[1]}, ${pg.cols} columns, spacing ${opt.aPad} px – slice like this in the engine.`)));
    put("a-note", el("div", { class: "col", style: "gap:3px" }, notes));
    if (atlasListOpen) renderAtlasTable(a);
    if (!pg) { put("a-stage", el("span", { class: "warn small" }, T("Nic się nie zmieściło – zwiększ maks. rozmiar pliku.", "Nothing fits – increase the max file size."))); return; }
    const img = memo("a|" + a.key + "|" + atlasPage, () => renderAtlasPage(pg, a.sprites, false));
    const boxes = pg.rects.map((r) => ({ x: r.sx, y: r.sy, w: a.sprites[r.i].w, h: a.sprites[r.i].h, color: aSel.has(a.sprites[r.i].path) ? accent() : "rgba(127,127,127,.5)", bold: aSel.has(a.sprites[r.i].path) }));
    const cv = canvasOf(img, boxes);
    cv.style.cursor = "pointer";
    cv.addEventListener("click", (e) => {
      const rc = cv.getBoundingClientRect(), k = cv.width / img.w;
      const sc = Math.min(rc.width / cv.width, rc.height / cv.height);
      const x = (e.clientX - rc.left - (rc.width - cv.width * sc) / 2) / sc / k, y = (e.clientY - rc.top - (rc.height - cv.height * sc) / 2) / sc / k;
      const hit = pg.rects.find((r) => x >= r.sx && y >= r.sy && x < r.sx + a.sprites[r.i].w && y < r.sy + a.sprites[r.i].h);
      if (hit) toggleSel(a.sprites[hit.i].path, e.ctrlKey || e.metaKey || e.shiftKey);
      else if (aSel.size) { aSel = new Set(); draw(); }
    });
    put("a-stage", el("div", { style: "position:absolute;inset:8px;display:flex" }, cv));
    if (aSel.size) document.getElementById("a-stage").append(el("div", { class: "floatbar" },
      el("b", { class: "small" }, T(`${aSel.size} zaznaczone`, `${aSel.size} selected`)),
      el("button", { class: "btn small", title: T("Skaluje do wysokości największego", "Scales to the tallest"), onclick: () => sizeAction("h") }, T("Ta sama wysokość", "Same height")),
      el("button", { class: "btn small", title: T("Skaluje do szerokości największego", "Scales to the widest"), onclick: () => sizeAction("w") }, T("Ta sama szerokość", "Same width")),
      el("button", { class: "btn small", title: T("Ten sam rozmiar bez skalowania – np. stany przycisku", "Same size without scaling – e.g. button states"), onclick: () => sizeAction("box") }, T("Wspólna ramka", "Common frame")),
      el("input", { type: "number", min: 1, max: 400, value: String(aScalePct), style: "width:62px;height:28px", "aria-label": T("Skala %", "Scale %"), onchange: (e) => { aScalePct = Number(e.target.value) || 100; } }),
      el("button", { class: "btn small", onclick: () => sizeAction("scale") }, "%"),
      el("button", { class: "btn small", onclick: () => sizeAction("reset") }, T("Cofnij zmiany", "Reset")),
      el("button", { class: "btn small", "aria-label": T("Odznacz", "Deselect"), onclick: () => { aSel = new Set(); draw(); } }, "×")));
  });
  return { main, side, foot: null };
}

function renderAtlasTable(a) {
  const placed = new Set(a.layout.pages.flatMap((p) => p.rects.map((r) => r.i)));
  put("a-table", el("table", {},
    el("thead", {}, el("tr", {}, el("th", { style: "width:30px" }, ""), el("th", {}, T("Obrazek", "Image")), el("th", { style: "width:100px" }, T("Oryginał", "Original")), el("th", { style: "width:64px" }, T("Skala", "Scale")), el("th", { style: "width:100px" }, T("W atlasie", "In atlas")), el("th", { style: "width:120px" }, ""))),
    el("tbody", {}, a.sprites.map((s, i) => el("tr", { style: (aSel.has(s.path) ? "background:var(--accent-soft);" : "") + "cursor:pointer", onclick: (e) => { if (e.target.tagName !== "INPUT") toggleSel(s.path, true); } },
      el("td", {}, el("input", { type: "checkbox", checked: aSel.has(s.path), "aria-label": s.name, onchange: () => toggleSel(s.path, true) })),
      el("td", { title: s.path }, s.name), el("td", { class: "muted" }, `${s.base.w} × ${s.base.h}`), el("td", {}, pct(s.scale)), el("td", {}, `${s.w} × ${s.h}`),
      el("td", { class: "small muted" }, [cfgOf(s.path).m ? T("ręcznie", "manual") : null, s.box ? T("ramka", "frame") : null, s.shrink < 1 ? T("za duży", "too big") : null, !placed.has(i) ? T("pominięty", "skipped") : null].filter(Boolean).join(" · ")))))));
}

function atlasRows(hasCfg) {
  const packed = opt.aMode === "packed";
  return [
    { id: "max", label: T("Maks. rozmiar pliku", "Max file size"), ctl: () => selC("aMax", [[512, "512"], [1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"]]) },
    { id: "pad", label: T("Odstęp między obrazkami", "Spacing between images"), sub: "padding", ctl: () => stepC("aPad", { min: 0, max: 64, unit: "px" }) },
    packed ? { id: "ext", label: T("Ochrona krawędzi", "Edge protection"), sub: "extrude", ctl: () => stepC("aExt", { min: 0, max: 8, unit: "px" }) } : null,
    packed ? { id: "trim", label: T("Przytnij puste brzegi", "Trim empty edges"), ctl: () => swC("aTrim") } : null,
    packed ? { id: "fit", label: T("Pomniejsz, by upakować", "Shrink to pack better"), sub: T("szuka mniejszego pliku", "looks for a smaller file"), ctl: () => swC("aFit") } : null,
    packed && opt.aFit ? { id: "fitmax", label: T("Najwyżej o", "At most by"), ctl: () => stepC("aFitMax", { min: 1, max: 90, unit: "%" }) } : null,
    packed && opt.aFit ? { id: "fitwho", label: T("Które pomniejszać", "Which to shrink"), ctl: () => segC("aFitWho", [["all", T("wszystkie", "all")], ["big", T("największe", "largest")]]) } : null,
    { id: "data", label: T("Dane dla silnika", "Engine data"), ctl: () => selC("aData", [["godot", "Godot (.tres)"], ["tp-hash", "JSON (TexturePacker)"], ["tp-array", "JSON (Array)"], ["csv", "CSV"], ["none", T("bez danych", "none")]]), hint: opt.aData === "godot" ? T("Animacje z nazw: hero_walk_00, _01… → „hero_walk”.", "Animations from names: hero_walk_00, _01… → “hero_walk”.") : opt.aData === "none" ? null : T("Czytają go Phaser, PixiJS, Paper2D i wtyczki TexturePacker.", "Read by Phaser, PixiJS, Paper2D and TexturePacker plugins.") },
    opt.aData === "godot" ? { id: "fps", label: T("Klatki na sekundę", "Frames per second"), ctl: () => stepC("aFps", { min: 1, max: 60 }) } : null,
    { id: "name", label: T("Nazwa pliku", "File name"), ctl: () => txtC("aName", "atlas") },
    { id: "fmt", label: T("Format", "Format"), ctl: () => segC("aFmt", [["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]]) },
    { id: "mode", label: T("Układ", "Layout"), adv: true, ctl: () => segC("aMode", [["packed", T("upakowany", "packed")], ["grid", T("siatka", "grid")]]) },
    opt.aMode === "grid" ? { id: "cols", label: T("Kolumny", "Columns"), adv: true, short: T("kolumny", "columns"), ctl: () => stepC("aCols", { min: 0, max: 256, fmt: (v) => (v ? String(v) : "auto") }) } : null,
    { id: "page", label: T("Kształt pliku", "File shape"), adv: true, ctl: () => selC("aPage", [["pot", T("potęga 2", "power of 2")], ["mul4", T("wielokrotność 4", "multiple of 4")], ["any", T("dowolny", "any")]]), hint: eng().pot ? T(`${eng().name} najlepiej działa z potęgą 2.`, `${eng().name} works best with a power of 2.`) : null },
    { id: "big", label: T("Za duże obrazki", "Oversized images"), adv: true, ctl: () => segC("aBig", [["scale", T("zmniejsz", "shrink")], ["skip", T("pomiń", "skip")]]) },
    hasCfg ? { id: "reset", label: T("Ręczne zmiany obrazków", "Manual image changes"), ctl: () => el("button", { class: "btn small", onclick: () => setCfg(paths, () => null) }, T("Usuń", "Clear")) } : null,
  ];
}

// =====================================================================================================
// 3. Potnij arkusz
// =====================================================================================================

let sliceAuto = new Map(); // ścieżka → wynik wykrywania siatki
function viewSlice(g) {
  if (!paths.length) return { main: needFiles(), side: null };
  const p = paths[Math.min(focus, paths.length - 1)];
  const det = sliceAuto.get(p);
  if (!det) later(g, async () => {
    const im = await load(p);
    const gr = detectGrid(im, Number(opt.sThr) || 2);
    const isl = gr ? null : islands(im, Number(opt.sThr) || 2, Number(opt.sMin) || 4);
    sliceAuto.set(p, gr ? { grid: true, ...gr } : { grid: false, count: isl.length });
    if (gr) Object.assign(opt, { sMode: "grid", sBy: "count", sCols: gr.cols, sRows: gr.rows, sOx: 0, sOy: 0, sGap: 0 });
    else Object.assign(opt, { sMode: "islands" });
    if (g === gen) draw();
  });
  const head = !det ? el("span", { class: "muted" }, T("Szukam siatki…", "Looking for a grid…")) :
    opt.sMode === "grid" ? el("div", { class: "row" }, el("span", { style: "font-size:15px" }, el("b", {}, det.grid ? T(`Wykryłem siatkę ${det.cols} × ${det.rows}`, `Found a ${det.cols} × ${det.rows} grid`) : T("Siatka ustawiona ręcznie", "Grid set manually")), el("span", { class: "muted", id: "s-cell" }))) :
      !det.grid && det.count <= 1 ? el("div", { class: "sug warn", style: "flex-direction:row;align-items:center;gap:12px" },
        el("span", { style: "flex:1" }, el("b", {}, T("To nie wygląda na arkusz z klatkami", "This doesn't look like a frame sheet")), el("br"), T("Nie widzę osobnych kształtów na przezroczystym tle. Jeśli klatki leżą w równych polach, podziel obraz siatką.", "I don't see separate shapes on a transparent background. If frames sit in equal cells, split it with a grid.")),
        el("button", { class: "btn small", onclick: () => { Object.assign(opt, { sMode: "grid", sBy: "count", sCols: 2, sRows: 2 }); save(); draw(); } }, T("Podziel siatką", "Split with a grid"))) :
      el("span", { style: "font-size:15px" }, el("b", {}, T("Dzielę po kształtach", "Splitting by shapes")), el("span", { class: "muted" }, T(" – każdy obiekt na przezroczystym tle to osobna klatka", " – each object on the transparent background is a frame")));
  const main = [head, el("div", { class: "stage chk grow", id: "s-stage" }, el("span", { class: "muted small" }, T("Wczytywanie…", "Loading…"))),
    el("div", { class: "small muted" }, T("Klatki po kolei · przerywane pola są puste – pominę je", "Frames in order · dashed cells are empty – I'll skip them")),
    el("div", { class: "strip", id: "s-strip" }), paths.length > 1 ? strip() : null];
  const side = [el("div", { id: "s-res" }, resCard(T("Wynik", "Result"), "…")), el("div", { id: "s-btn" }, mainBtn(T("Potnij", "Slice"), runSlice)), tweaks(sliceRows())];
  if (det) later(g, async () => {
    const im = await load(p);
    if (g !== gen) return;
    const sk = "s|" + p + "|" + JSON.stringify([opt.sMode, opt.sBy, opt.sCols, opt.sRows, opt.sCw, opt.sCh, opt.sOx, opt.sOy, opt.sGap, opt.sSkip, opt.sTrim, opt.sThr, opt.sMin]);
    const { rects, frames } = memo(sk, () => ({ rects: sliceRects(im), frames: sliceFrames(im) }));
    const kept = new Set(frames.map((f) => `${f.r.x},${f.r.y}`));
    if (opt.sMode === "grid" && rects[0]) putText("s-cell", T(` – klatki ${rects[0].w} × ${rects[0].h} px`, ` – ${rects[0].w} × ${rects[0].h} px frames`));
    put("s-stage", el("div", { style: "position:absolute;inset:8px;display:flex" }, canvasOf(im, rects.map((r) => ({ ...r, dash: !kept.has(`${r.x},${r.y}`), color: kept.has(`${r.x},${r.y}`) ? accent() : "rgba(127,127,127,.6)" })))));
    put("s-strip", el("div", { class: "strip" }, frames.slice(0, 16).map((f, i) => el("div", { class: "it" }, canvasOf(f.part, [], 96), el("span", {}, String(i).padStart(2, "0")))), frames.length > 16 ? el("span", { class: "muted small", style: "align-self:center" }, `+${frames.length - 16}`) : null));
    const first = frameName(opt.sNames, stemOf(p), 0), last = frameName(opt.sNames, stemOf(p), frames.length - 1);
    put("s-res", resCard(T("Wynik", "Result"), T(`${paths.length === 1 ? "1 arkusz" : `${paths.length} ${plural(paths.length, "arkusz", "arkusze", "arkuszy")}`} → ${frames.length} ${plural(frames.length, "klatka", "klatki", "klatek")}`, `${paths.length} sheet${paths.length === 1 ? "" : "s"} → ${frames.length} frames`),
      el("span", { style: "line-height:1.45" }, T(`Osobne pliki: ${first}.${opt.sFmt} … ${last}.${opt.sFmt}`, `Separate files: ${first}.${opt.sFmt} … ${last}.${opt.sFmt}`))));
    put("s-btn", mainBtn(T(`Potnij na ${frames.length} ${plural(frames.length, "klatkę", "klatki", "klatek")}`, `Slice into ${frames.length} frames`), runSlice));
  });
  return { main, side };
}

function sliceRows() {
  const grid = opt.sMode === "grid";
  return [
    { id: "mode", label: T("Jak dzielić", "How to split"), ctl: () => segC("sMode", [["grid", T("siatka", "grid")], ["islands", T("kształty", "shapes")]]) },
    grid ? { id: "by", label: T("Siatka według", "Grid by"), ctl: () => segC("sBy", [["count", T("liczby pól", "cell count")], ["size", T("rozmiaru", "size")]]) } : null,
    grid && opt.sBy === "count" ? { id: "cols", label: T("Kolumny", "Columns"), ctl: () => stepC("sCols", { min: 1, max: 256 }) } : null,
    grid && opt.sBy === "count" ? { id: "rows", label: T("Wiersze", "Rows"), ctl: () => stepC("sRows", { min: 1, max: 256 }) } : null,
    grid && opt.sBy === "size" ? { id: "cw", label: T("Szerokość klatki", "Frame width"), ctl: () => stepC("sCw", { min: 1, max: 16384, unit: "px" }) } : null,
    grid && opt.sBy === "size" ? { id: "ch", label: T("Wysokość klatki", "Frame height"), ctl: () => stepC("sCh", { min: 1, max: 16384, unit: "px" }) } : null,
    { id: "skip", label: T("Pomiń puste klatki", "Skip empty frames"), ctl: () => swC("sSkip") },
    { id: "trim", label: T("Przytnij puste brzegi", "Trim empty edges"), sub: T("klatki mogą mieć różne rozmiary", "frames may differ in size"), ctl: () => swC("sTrim") },
    { id: "names", label: T("Nazwy", "Names"), ctl: () => txtC("sNames", "{name}_{nr:00}"), hint: T("{name} – nazwa arkusza, {nr} albo {nr:00} – numer", "{name} – sheet name, {nr} or {nr:00} – number") },
    { id: "fmt", label: T("Format", "Format"), ctl: () => segC("sFmt", [["png", "PNG"], ["tga", "TGA"], ["webp", "WebP"]]) },
    grid ? { id: "gap", label: T("Odstęp między polami", "Spacing between cells"), short: T("odstęp", "spacing"), adv: true, ctl: () => stepC("sGap", { min: 0, max: 512, unit: "px" }) } : null,
    grid ? { id: "ox", label: T("Margines arkusza – lewo", "Sheet margin – left"), short: T("margines", "margin"), adv: true, ctl: () => stepC("sOx", { min: 0, max: 4096, unit: "px" }) } : null,
    grid ? { id: "oy", label: T("Margines arkusza – góra", "Sheet margin – top"), short: "", adv: true, ctl: () => stepC("sOy", { min: 0, max: 4096, unit: "px" }) } : null,
  ];
}

// =====================================================================================================
// 4. Połącz mapy PBR
// =====================================================================================================

const PLAIN = { ao: T("cienie w zagłębieniach (AO)", "cavity shadows (AO)"), rough: T("chropowatość (Roughness)", "roughness"), metal: T("metaliczność (Metallic)", "metalness (Metallic)"), smooth: T("gładkość (Smoothness)", "smoothness"), mask: T("maska detali", "detail mask"), height: T("wysokość", "height"), white: T("biały", "white"), black: T("czarny", "black"), none: T("puste", "empty") };
const CHNAME = [T("Czerwony", "Red"), T("Zielony", "Green"), T("Niebieski", "Blue"), T("Przezroczystość", "Alpha")];
const PACKNAME = { orm: "ORM", hdrp: "Mask Map", urp: "Metallic", custom: T("własny", "custom") };

/** Mapy z folderu zestawu, których nie było w zaznaczeniu (ta sama nazwa bazowa). */
function folderMaps(set) {
  const out = {};
  if (set.manual) return out;
  for (const p of folderImages(set.dir)) {
    const r = roleOf(stemOf(p));
    if (r && r.base.toLowerCase() === set.base.toLowerCase() && !set.maps[r.role] && !out[r.role]) out[r.role] = p;
  }
  return out;
}

function viewChannels(g) {
  const sets = channelSets();
  const slots = slotsNow();
  if (opt.cMode === "unpack") {
    const main = paths.length ? [el("b", { style: "font-size:15px" }, T("Rozbiję każdy obraz na szare pliki kanałów", "I'll split each image into grey channel files")), el("span", { class: "muted" }, T("Pliki: nazwa_R, nazwa_G, nazwa_B (i nazwa_A).", "Files: name_R, name_G, name_B (and name_A).")), strip()] : needFiles();
    return { main, side: [resCard(T("Wynik", "Result"), T(`${nFiles(paths.length)} → ${paths.length * (opt.cAlpha ? 4 : 3)} szarych plików`, `${nFiles(paths.length)} → ${paths.length * (opt.cAlpha ? 4 : 3)} grey files`)), mainBtn(T("Rozbij", "Split"), runChannels), tweaks(chanRows())] };
  }
  if (!sets.length) return { main: needFiles(T("Zaznacz szare tekstury (np. AO, Roughness, Metallic).", "Select grey textures (e.g. AO, Roughness, Metallic).")), side: null };
  if (focus >= sets.length) focus = 0;
  const set = sets[focus];
  const srcs = slotSources(set);
  const sel = [...paths].sort((a, b) => natural(baseName(a), baseName(b)));
  const other = folderImages(set.dir).filter((p) => !paths.some((q) => q.toLowerCase() === p.toLowerCase()));
  const used = new Map(srcs.map((s, k) => [s.path && s.path.toLowerCase(), k]).filter(([p]) => p));
  const inFolder = (p) => !paths.some((q) => q.toLowerCase() === p.toLowerCase());
  const nSlots = srcs[3].none && slots[3] === "none" ? 3 : 4;
  const slotRow = (k) => {
    const s = srcs[k], role = slots[k];
    const note = s.path ? (s.auto ? (inFolder(s.path) ? T("Nie było w zaznaczeniu – znalazłem w tym samym folderze", "Not in the selection – found in the same folder") : s.why ? T(`✓ ${s.why}`, `✓ ${s.why}`) : T("✓ dobrane po nazwie", "✓ matched by name")) : T("wybrane ręcznie", "picked manually")) :
      s.none ? (k === 3 ? T("bez kanału przezroczystości", "no alpha channel") : T("puste (0)", "empty (0)")) : T(`Brak mapy – wstawię stałą ${s.inv ? 255 - s.value : s.value} (${s.value >= 128 ? T("jasno", "light") : T("ciemno", "dark")})`, `No map – I'll use a constant ${s.inv ? 255 - s.value : s.value}`);
    const row = el("div", { class: "slotrow" + (!s.auto ? " picked" : ""), ondragover: (e) => { e.preventDefault(); row.classList.add("drop"); }, ondragleave: () => row.classList.remove("drop"), ondrop: (e) => { e.preventDefault(); const p = e.dataTransfer.getData("text/plain"); if (p) setPick(set, k, { path: p }); } },
      el("span", { class: "cb", style: `background:${CH[k][1]}` }, CH[k][0]),
      el("div", { class: "thumb chk" }, s.path ? thumb(s.path, 58) : el("span", { class: "small muted" }, s.none ? (k === 3 ? "255" : "0") : String(s.inv ? 255 - s.value : s.value))),
      el("div", { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" },
        el("b", {}, `${CHNAME[k]} · ${PLAIN[role] || role}`),
        el("span", { class: "small", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, s.path ? baseName(s.path) : T("stała wartość", "constant value")),
        el("span", { class: "small", style: `color:var(${s.path && s.auto && inFolder(s.path) ? "--accent" : s.path ? "--ok" : "--muted"})` }, note)),
      slotSelect(set, k, s, { sel, other }),
      !s.path && !s.none ? el("input", { type: "number", min: 0, max: 255, value: String(s.value), style: "width:64px", "aria-label": T("Wartość 0–255", "Value 0–255"), onchange: (e) => setPick(set, k, { value: Math.max(0, Math.min(255, Math.round(Number(e.target.value) || 0))) }) }) : null,
      el("label", { class: "small muted" }, el("input", { type: "checkbox", checked: !!opt.cInv[k], onchange: (e) => { opt.cInv = opt.cInv.map((v, i) => (i === k ? e.target.checked : v)); save(); draw(); } }), T("Odwróć", "Invert")));
    return row;
  };
  const trayList = [...new Set([...sel, ...other.filter((p) => { const r = roleOf(stemOf(p)); return r && r.base.toLowerCase() === set.base.toLowerCase(); })])];
  const main = [
    el("div", {}, el("b", { style: "font-size:15px" }, set.manual ? T("Nazwy plików nie mówią, która to mapa – włożyłem je po kolei", "File names don't say which map is which – I put them in order") : T(`${eng().name} czyta jedną teksturę ${PACKNAME[opt.cPack]} – dobrałem mapy do kanałów`, `${eng().name} reads one ${PACKNAME[opt.cPack]} texture – I matched maps to channels`)),
      el("div", { class: "small muted", style: "margin-top:2px" }, T("Nie pasuje? Przeciągnij teksturę z dołu na kanał albo wybierz z listy.", "Not right? Drag a texture from below onto a channel or pick from the list."))),
    [0, 1, 2, 3].slice(0, nSlots).map(slotRow),
    el("div", { class: "small muted", style: "margin-top:4px" }, T("Tekstury do przeciągnięcia", "Textures to drag")),
    el("div", { class: "tray" }, trayList.map((p) => {
      const k = used.get(p.toLowerCase());
      const r = roleOf(stemOf(p));
      const tag = k != null ? T(`w kanale ${CH[k][0]}`, `in channel ${CH[k][0]}`) + (inFolder(p) ? T(" · z folderu", " · from folder") : "") : r && r.role === "height" && !slots.includes("height") ? T(`nieużyta – ${PACKNAME[opt.cPack]} nie ma miejsca na wysokość`, `unused – ${PACKNAME[opt.cPack]} has no slot for height`) : inFolder(p) ? T("z folderu – przeciągnij, jeśli potrzebna", "from folder – drag if needed") : T("nieużyta", "unused");
      return el("div", { class: "tt" + (k == null && !inFolder(p) ? " unused" : ""), draggable: "true", ondragstart: (e) => e.dataTransfer.setData("text/plain", p), title: p },
        thumb(p, 120), el("span", {}, stemOf(p)), el("span", { style: `color:var(${k != null ? "--ok" : inFolder(p) ? "--muted" : "--warn"})` }, tag));
    })),
    sets.length > 1 ? [el("div", { class: "small muted" }, T(`Zestawy (${sets.length}) – kliknij, aby ustawić`, `Sets (${sets.length}) – click to set up`)), el("div", { class: "row" }, sets.map((s, i) => el("button", { class: "btn small" + (i === focus ? " primary" : ""), onclick: () => { focus = i; draw(); } }, s.base)))] : null,
  ];
  const side = [
    el("div", { class: "res" }, el("span", { class: "small muted" }, T("Wynik", "Result")), el("div", { class: "chk", id: "c-out", style: "height:150px;border-radius:10px;overflow:hidden;display:flex" }),
      el("span", { class: "big", style: "font-size:15px;word-break:break-all" }, set.base + packSuffix() + "." + opt.cFmt), el("span", { class: "small muted", id: "c-size" }, "…")),
    mainBtn(sets.length > 1 ? T(`Połącz ${sets.length} zestawy`, `Pack ${sets.length} sets`) : T("Połącz w jedną teksturę", "Pack into one texture"), runChannels),
    picks.size ? el("button", { class: "btn", onclick: () => { picks = new Map(); draw(); } }, T("Wróć do automatycznego", "Back to automatic")) : null,
    tweaks(chanRows()),
  ];
  later(g, async () => {
    const ck = "c|" + setKey(set) + "|" + opt.cPack + "|" + JSON.stringify(srcs.map((x) => [x.path, x.value, x.none, x.inv]));
    let im = memoMap.get(ck);
    if (!im) { const v = await packSet(set, 256); im = memo(ck, () => v); }
    if (g !== gen) return;
    put("c-out", el("div", { style: "flex:1;display:flex" }, canvasOf(im.preview)));
    putText("c-size", `${im.w} × ${im.h} · ${srcs[3].none ? "RGB" : "RGBA"} · ${T(`gotowe dla ${eng().name} (bez sRGB)`, `ready for ${eng().name} (no sRGB)`)}`);
  });
  return { main, side };
}

function slotSelect(set, k, src, choices) {
  const val = src.path && !src.auto ? "f:" + src.path : !src.auto && src.none ? "none" : !src.auto ? "const" : "auto";
  const pick = (e) => {
    const v = e.target.value;
    if (v === "auto") setPick(set, k, undefined);
    else if (v === "const") setPick(set, k, { value: src.value != null ? src.value : k === 3 ? 255 : 0 });
    else if (v === "none") setPick(set, k, { none: true });
    else setPick(set, k, { path: v.slice(2) });
  };
  return el("select", { "aria-label": T(`Zmień kanał ${CH[k][0]}`, `Change channel ${CH[k][0]}`), style: "max-width:150px", onchange: pick },
    el("option", { value: "auto", selected: val === "auto" }, T("Zmień ▾ (auto)", "Change ▾ (auto)")),
    el("optgroup", { label: T("Zaznaczone", "Selected") }, choices.sel.map((p) => el("option", { value: "f:" + p, selected: val === "f:" + p }, baseName(p)))),
    choices.other.length ? el("optgroup", { label: T("W tym folderze", "In this folder") }, choices.other.map((p) => el("option", { value: "f:" + p, selected: val === "f:" + p }, baseName(p)))) : null,
    el("optgroup", { label: T("Bez tekstury", "No texture") }, el("option", { value: "const", selected: val === "const" }, T("stała wartość…", "constant…")), el("option", { value: "none", selected: val === "none" }, k === 3 ? T("bez kanału A", "no A channel") : T("puste (0)", "empty (0)"))));
}

function chanRows() {
  const packHint = { orm: T("Godot, Unreal, glTF · R = AO · G = Roughness · B = Metallic", "Godot, Unreal, glTF · R = AO · G = Roughness · B = Metallic"), hdrp: T("Unity HDRP · R = Metallic · G = AO · B = maska · A = Smoothness", "Unity HDRP · R = Metallic · G = AO · B = mask · A = Smoothness"), urp: "Unity URP · RGB = Metallic · A = Smoothness", custom: T("W każdym kanale wybierasz mapę z listy.", "Pick a map for each channel from the list.") };
  return [
    { id: "mode", label: T("Tryb", "Mode"), ctl: () => segC("cMode", [["pack", T("połącz", "pack")], ["unpack", T("rozbij", "split")]]) },
    opt.cMode === "pack" ? { id: "pack", label: T("Układ kanałów", "Channel layout"), ctl: () => selC("cPack", [["orm", "ORM"], ["hdrp", "HDRP Mask Map"], ["urp", "URP Metallic"], ["custom", T("własny", "custom")]], () => { picks = new Map(); }), hint: packHint[opt.cPack] } : null,
    opt.cMode === "unpack" ? { id: "alpha", label: T("Zapisz też kanał A", "Also save channel A"), sub: T("przezroczystość → _A", "transparency → _A"), ctl: () => swC("cAlpha") } : null,
    { id: "fmt", label: T("Format", "Format"), ctl: () => segC("cFmt", [["png", "PNG"], ["tga", "TGA"], ["dds", "DDS"]]) },
    { id: "size", label: T("Rozmiar", "Size"), ctl: () => el("span", { class: "small muted", style: "text-align:right" }, T("jak największa mapa", "as the largest map")) },
  ];
}

// =====================================================================================================
// 5. Zrób normal mapę
// =====================================================================================================

const NMETHODS = ["sprite", "texture", "height", "combine"];
let normalCache = null; // { key, method, base, hn, albedo }
let lightPos = { x: 0.3, y: 0.25 };

/** Metoda dla pliku w trybie automatycznym. */
function autoMethod(p, im) {
  if (paths.length === 2 && paths.every(isNormalName)) return "combine";
  if (/(?:^|[_\-. ])(height|disp|displacement|bump|h)$/i.test(stemOf(p))) return "height";
  if (isNormalName(p)) return "combine";
  if (im && alphaRange(im).lo < 250) return "sprite";
  return "texture";
}
const normalDir = () => (opt.nDir === "auto" ? eng().normal : opt.nDir);

/** Normal mapa dla obrazu (opcjonalnie zmniejszonego do `maxSide` – podgląd). Zwraca { normal, height, albedo }. */
async function makeNormal(p, method, maxSide = 0) {
  let im = await load(p);
  let scale = 1;
  if (maxSide && Math.max(im.w, im.h) > maxSide) { scale = maxSide / Math.max(im.w, im.h); const src = im; im = memo(`ns|${p}|${maxSide}`, () => resize(src, Math.max(1, Math.round(src.w * scale)), Math.max(1, Math.round(src.h * scale)), true)); }
  const dir = normalDir();
  if (method === "combine") {
    const others = paths.filter((q) => q !== p);
    const det0 = others.length ? await load(others[0]) : null;
    if (!det0) return { normal: im, albedo: null };
    const det = memo(`nd|${others[0]}|${im.w}x${im.h}`, () => resize(det0, im.w, im.h, true));
    return { normal: combineNormals(im, det, (Number(opt.nAmount) || 100) / 100), albedo: null };
  }
  const o = { strength: Number(opt.nStrength), bevel: Math.max(1, (Number(opt.nBevel) || 1) * scale), detail: Number(opt.nDetail), profile: opt.nProfile, mix: Number(opt.nMix), smooth: Number(opt.nSmooth) || 0, invert: !!opt.nInvert };
  const H = method === "sprite" ? heightSprite(im, o) : method === "height" ? heightFromMap(im, o) : heightTexture(im, o);
  const mask = method === "sprite" ? new Uint8Array(im.w * im.h).map((_, i) => (im.d[i * 4 + 3] > 8 ? 1 : 0)) : null;
  return { normal: normalFromHeight(H, im.w, im.h, dir, mask), height: H, albedo: method === "height" ? null : im };
}

function viewNormal(g) {
  if (!paths.length) return { main: needFiles(), side: null };
  const p = paths[Math.min(focus, paths.length - 1)];
  const loaded = cache.has(p);
  const method = opt.nMethod === "auto" ? (normalCache && normalCache.path === p ? normalCache.autoM : null) || "sprite" : opt.nMethod;
  const card = (k, t, d) => el("button", { class: "mode" + (method === k ? " on" : ""), "aria-pressed": String(method === k), onclick: () => { opt.nMethod = k; save(); normalCache = null; draw(); } },
    el("b", {}, t), el("small", {}, d), method === k && opt.nMethod === "auto" ? el("span", { class: "why" }, T("Wybrane automatycznie", "Picked automatically")) : null);
  const main = [
    el("div", { class: "modes" },
      card("sprite", T("Sprite 2D", "2D sprite"), T("Wypukły kształt + detal rysunku – do świateł 2D", "Rounded shape + drawing detail – for 2D lights")),
      card("texture", T("Tekstura / zdjęcie", "Texture / photo"), T("Wypukłości z jasności, bez cieni ze zdjęcia", "Bumps from brightness, without photo shadows")),
      card("height", T("Z mapy wysokości", "From a height map"), T("Szara mapa: jasne = wysoko", "Grey map: bright = high")),
      card("combine", T("Połącz normal mapy", "Combine normal maps"), T("Bazowa + detal w jedną", "Base + detail in one"))),
    el("div", { class: "pair grow" },
      stageBox("n-orig", T("Oryginał", "Original")), stageBox("n-map", T("Normal mapa", "Normal map")),
      el("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1;min-height:0" }, el("div", { class: "small muted" }, T("Podgląd ze światłem · przeciągnij myszą", "Lit preview · drag with the mouse")), el("div", { class: "stage", id: "n-lit", style: "background:#101010;border-radius:12px;border:1px solid var(--border);cursor:crosshair" }))),
    method === "combine" ? el("div", { class: "row" }, slider("nAmount", T("Siła detalu", "Detail strength"), 0, 200)) :
      el("div", { class: "row", style: "gap:22px" }, slider("nStrength", T("Siła wypukłości", "Bump strength"), 5, 200),
        method === "sprite" ? slider("nBevel", T("Zaokrąglenie krawędzi", "Edge rounding"), 1, 64, " px") : null,
        method === "sprite" ? slider("nDetail", T("Detal z rysunku", "Drawing detail"), 0, 100) : method === "texture" ? slider("nMix", T("Drobne ↔ duże detale", "Fine ↔ large detail"), 0, 100) : slider("nSmooth", T("Wygładzenie", "Smoothing"), 0, 8, " px")),
    paths.length > 1 && method !== "combine" ? strip() : null,
  ];
  const outName = method === "combine" ? `${stemOf(paths[0])}_combined_N.${opt.nFmt}` : `${stemOf(p)}_N.${opt.nFmt}`;
  const count = method === "combine" ? 1 : paths.length;
  const side = [
    resCard(T("Wynik", "Result"), method === "combine" ? T("1 połączona normal mapa", "1 combined normal map") : T(`${count} ${plural(count, "normal mapa", "normal mapy", "normal map")}`, `${count} normal map${count === 1 ? "" : "s"}`),
      el("span", { style: "line-height:1.45" }, el("b", {}, outName), method === "combine" ? "" : T(" i kolejne – w tym samym rozmiarze co oryginał.", " and more – same size as the original.")),
      el("span", { class: "small muted" }, T(`Kierunek zielonego: ${normalDir() === "dx" ? "DirectX" : "OpenGL"} – tak czyta ${eng().name}`, `Green direction: ${normalDir() === "dx" ? "DirectX" : "OpenGL"} – as ${eng().name} reads it`))),
    mainBtn(method === "combine" ? T("Połącz normal mapy", "Combine normal maps") : T(`Zrób ${count} ${plural(count, "normal mapę", "normal mapy", "normal map")}`, `Make ${count} normal map${count === 1 ? "" : "s"}`), runNormal, method === "combine" && paths.length < 2),
    method === "combine" && paths.length < 2 ? el("span", { class: "small warn" }, T("Zaznacz dwie normal mapy: bazową i detal.", "Select two normal maps: base and detail.")) : null,
    tweaks(normalRows(method)),
  ];
  later(g, async () => {
    const im = await load(p);
    if (g !== gen) return;
    if (opt.nMethod === "auto" && (!normalCache || normalCache.path !== p || !normalCache.autoM)) {
      const autoM = autoMethod(p, im);
      normalCache = { path: p, autoM };
      if (autoM !== method) { draw(); return; }
    }
    put("n-orig", el("div", { style: "position:absolute;inset:8px;display:flex" }, canvasOf(im)));
    await renderNormalPreview(g, true);
  });
  return { main, side };
}

/** Przelicza podgląd (zmniejszony do 384 px) i rysuje normal mapę oraz oświetlenie. */
async function renderNormalPreview(g, full) {
  const p = paths[Math.min(focus, paths.length - 1)];
  const method = opt.nMethod === "auto" ? (normalCache && normalCache.autoM) || "sprite" : opt.nMethod;
  const key = JSON.stringify([p, method, opt.nStrength, opt.nBevel, opt.nDetail, opt.nProfile, opt.nMix, opt.nSmooth, opt.nInvert, opt.nAmount, normalDir()]);
  let r = normalCache && normalCache.key === key ? normalCache.res : null;
  if (!r) { r = await makeNormal(p, method, 384); normalCache = { ...(normalCache || {}), path: p, key, res: r, autoM: normalCache && normalCache.autoM }; }
  if (g !== gen && full) return;
  put("n-map", el("div", { style: "position:absolute;inset:8px;display:flex" }, canvasOf(r.normal)));
  drawLit(r);
}

function drawLit(r) {
  const box = document.getElementById("n-lit");
  if (!box) return;
  const lit = shade(r.normal, r.albedo, lightPos.x, lightPos.y, normalDir());
  const cv = canvasOf(lit);
  const wrap = el("div", { style: "position:absolute;inset:8px;display:flex" }, cv);
  const move = (e) => {
    const rc = cv.getBoundingClientRect();
    const sc = Math.min(rc.width / cv.width, rc.height / cv.height);
    const ox = (rc.width - cv.width * sc) / 2, oy = (rc.height - cv.height * sc) / 2;
    lightPos = { x: Math.max(-0.2, Math.min(1.2, (e.clientX - rc.left - ox) / (cv.width * sc))), y: Math.max(-0.2, Math.min(1.2, (e.clientY - rc.top - oy) / (cv.height * sc))) };
    const l2 = shade(r.normal, r.albedo, lightPos.x, lightPos.y, normalDir());
    const t = canvasOf(l2), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(t, 0, 0);
  };
  let down = false;
  cv.addEventListener("pointerdown", (e) => { down = true; cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener("pointermove", (e) => { if (down) move(e); });
  cv.addEventListener("pointerup", () => { down = false; });
  box.replaceChildren(wrap);
}

function normalRows(method) {
  const reset = () => { normalCache = null; };
  return [
    method === "sprite" ? { id: "profile", label: T("Kształt krawędzi", "Edge shape"), ctl: () => selC("nProfile", [["round", T("zaokrąglony", "rounded")], ["bevel", T("ścięty (fazka)", "bevel")], ["pillow", T("poduszka", "pillow")]], reset) } : null,
    method !== "combine" ? { id: "smooth", label: T("Wygładzenie", "Smoothing"), ctl: () => segC("nSmooth", [[0, T("brak", "none")], [1, "1"], [2, "2"], [4, "4"], [8, "8"]], reset) } : null,
    method !== "combine" ? { id: "invert", label: T("Odwróć", "Invert"), sub: T("wklęsłe ↔ wypukłe", "concave ↔ convex"), ctl: () => swC("nInvert", reset) } : null,
    { id: "dir", label: T("Kierunek zielonego", "Green direction"), sub: opt.nDir === "auto" ? T(`auto wg silnika: ${normalDir() === "dx" ? "DirectX" : "OpenGL"}`, `auto by engine: ${normalDir() === "dx" ? "DirectX" : "OpenGL"}`) : null, wide: true, ctl: () => segC("nDir", [["auto", "auto"], ["gl", "OpenGL"], ["dx", "DirectX"]], reset, true), hint: T("Godot, Unity, Blender: OpenGL. Unreal: DirectX.", "Godot, Unity, Blender: OpenGL. Unreal: DirectX.") },
    method !== "combine" ? { id: "hout", label: T("Zapisz też mapę wysokości", "Also save the height map"), sub: "_H", ctl: () => swC("nHeightOut") } : null,
    { id: "fmt", label: T("Format", "Format"), ctl: () => segC("nFmt", [["png", "PNG"], ["tga", "TGA"]]) },
  ];
}

async function runNormal() {
  const method0 = opt.nMethod;
  if (method0 === "combine" || (method0 === "auto" && normalCache && normalCache.autoM === "combine")) {
    await batch("normal", [paths[0]], async (list, res) => {
      const r = await makeNormal(paths[0], "combine");
      await writeImage(destDir(paths[0]), `${stemOf(paths[0])}_combined_N`, r.normal, { format: opt.nFmt, channels: 3 });
      res.done++;
      tick();
    });
    return;
  }
  await batch("normal", paths, async (list, res) => {
    for (const p of list) {
      try {
        const im = await load(p);
        const method = method0 === "auto" ? autoMethod(p, im) : method0;
        const r = await makeNormal(p, method === "combine" ? "texture" : method);
        await writeImage(destDir(p), `${stemOf(p)}_N`, r.normal, { format: opt.nFmt, channels: 3 });
        res.done++;
        if (opt.nHeightOut && r.height) {
          let lo = Infinity, hi = -Infinity;
          for (const v of r.height) { if (v < lo) lo = v; if (v > hi) hi = v; }
          const g = mk(im.w, im.h), span = hi - lo || 1;
          for (let i = 0; i < im.w * im.h; i++) { const v = ((r.height[i] - lo) / span) * 255; g.d[i * 4] = g.d[i * 4 + 1] = g.d[i * 4 + 2] = v; g.d[i * 4 + 3] = 255; }
          await writeImage(destDir(p), `${stemOf(p)}_H`, g, { format: opt.nFmt, channels: 1 });
          res.done++;
        }
      } catch (e) { res.errors.push(`${baseName(p)}: ${errText(e)}`); }
      tick();
    }
  });
}

// =====================================================================================================
// 6. Przygotuj do silnika
// =====================================================================================================

const FMTNAME = { png: "PNG", tga: "TGA", dds: "DDS", exr: "EXR", webp: "WebP", jpg: "JPG" };
function viewConvert(g) {
  if (!paths.length) return { main: needFiles(), side: null };
  const groups = { color: [], normal: [], data: [] };
  for (const p of paths) (isNormalName(p) ? groups.normal : isDataName(p) ? groups.data : groups.color).push(p);
  const fmt = opt.vFmt === "auto" ? eng().fmt : opt.vFmt;
  const dds = fmt === "dds";
  const thumbs3 = (list) => el("div", { class: "th" }, list.slice(0, 3).map((p) => thumb(p, 44)));
  const fmtLine = (kind) => {
    const o = groups[kind][0] ? convertOpts(groups[kind][0]) : null;
    if (!o) return "";
    if (dds) return { color: T("DDS, wysoka jakość z przezroczystością", "DDS, high quality with alpha"), normal: T("DDS dla normal map", "DDS for normal maps"), data: T("DDS bez korekty kolorów – to dane, nie kolor", "DDS without colour correction – data, not colour") }[kind];
    return T(`${FMTNAME[fmt]} – ${eng().name} skompresuje przy imporcie`, `${FMTNAME[fmt]} – ${eng().name} compresses on import`);
  };
  const tech = (kind) => { const o = groups[kind][0] ? convertOpts(groups[kind][0]) : null; return o ? ddsLabel(o) : ""; };
  const grp = (kind, title, extra, cls) => groups[kind].length ? el("div", { class: "grp" + (cls ? " " + cls : "") }, thumbs3(groups[kind]),
    el("div", { style: "flex:1;display:flex;flex-direction:column;gap:3px" }, el("b", {}, `${title} · ${groups[kind].length} ${plural(groups[kind].length, "plik", "pliki", "plików")}`), el("span", {}, "→ " + fmtLine(kind)), extra || null),
    el("span", { class: "small muted", style: "text-align:right" }, tech(kind))) : null;
  const flip = flipOn();
  const main = [
    el("div", {}, el("b", { style: "font-size:15px" }, T(`Rozpoznałem rodzaje tekstur – każdy dostanie to, czego oczekuje ${eng().name}`, `I sorted the textures by kind – each gets what ${eng().name} expects`)),
      el("div", { class: "small muted", style: "margin-top:2px" }, T("Po nazwach plików (_D, _N, _ORM, _ao…).", "From file names (_D, _N, _ORM, _ao…)."))),
    grp("color", T("Kolor", "Colour")),
    grp("normal", T("Normal mapy", "Normal maps"), el("div", { class: "col", style: "gap:4px;margin-top:2px" },
      el("label", {}, el("input", { type: "checkbox", checked: flip, onchange: (e) => set("vFlip", e.target.checked) }), T("Odwróć zielony kanał", "Flip the green channel"), opt.vFlip === "auto" ? el("span", { class: "tech" }, " · auto") : null),
      el("span", { class: "small muted", style: "line-height:1.4" }, eng().normal === "dx" ? T("Unreal używa DirectX, a Blender i Substance zapisują zwykle OpenGL. Jeśli światło wygląda „od spodu” – wyłącz.", "Unreal uses DirectX, while Blender and Substance usually save OpenGL. If lighting looks inside-out – turn it off.") : T(`${eng().name} używa OpenGL. Odwróć tylko mapy z Unreala lub 3ds Maxa (DirectX).`, `${eng().name} uses OpenGL. Flip only maps from Unreal or 3ds Max (DirectX).`))), flip ? "hl" : ""),
    grp("data", T("Maski i mapy danych", "Masks and data maps")),
    el("div", { id: "v-bad" }),
  ];
  const side = [
    el("div", { class: "res" }, el("span", { class: "small muted" }, T("Wynik", "Result")), el("span", { class: "big" }, T(`${nFiles(paths.length)} → ${FMTNAME[fmt]} dla ${eng().name}`, `${nFiles(paths.length)} → ${FMTNAME[fmt]} for ${eng().name}`)),
      el("span", { class: "small" }, T("Pamięć karty graficznej", "Graphics memory")), el("div", { id: "v-vram", class: "col", style: "gap:4px" }, el("span", { class: "small muted" }, "…"))),
    mainBtn(T(`Przygotuj ${nFiles(paths.length)}`, `Prepare ${nFiles(paths.length)}`), runConvert),
    tweaks(convertRows(fmt)),
  ];
  later(g, async () => {
    let now = 0, after = 0;
    const bad = [];
    for (const p of paths.slice(0, 400)) {
      const i = await infoOf(p);
      if (g !== gen) return;
      if (!i) continue;
      const o = convertOpts(p);
      now += vramBytes(i.width, i.height, "rgba8", true);
      after += vramBytes(i.width, i.height, isNormalName(p) ? "bc7" : vramFmt({ ...o, format: "dds" }), true);
      if (dds && o.dds !== "rgba" && (i.width % 4 || i.height % 4)) bad.push(`${baseName(p)} · ${i.width} × ${i.height}`);
    }
    put("v-vram", el("div", { class: "col", style: "gap:4px" },
      el("div", { class: "row" }, el("span", { class: "meter" }, el("i", { style: "width:100%;background:var(--muted)" })), el("span", { class: "small muted" }, T(`${mb(now)} bez kompresji`, `${mb(now)} uncompressed`))),
      el("div", { class: "row" }, el("span", { class: "meter" }, el("i", { style: `width:${Math.max(3, Math.round((100 * after) / Math.max(1, now)))}%` })), el("span", { class: "small ok" }, T(`≈ ${mb(after)} w grze`, `≈ ${mb(after)} in game`)))));
    if (bad.length) put("v-bad", el("div", { class: "grp bad" }, el("div", { style: "flex:1;display:flex;flex-direction:column;gap:3px" },
      el("b", {}, T(`${bad.length} ${plural(bad.length, "plik ma", "pliki mają", "plików ma")} rozmiar niepodzielny przez 4`, `${bad.length} file${bad.length === 1 ? " has" : "s have"} a size not divisible by 4`)),
      el("span", { class: "small muted" }, bad.slice(0, 4).join(", ")),
      el("span", { class: "small", style: "line-height:1.4" }, opt.vPad ? T("Kompresja tego wymaga – dopełnię je przezroczystością od prawej i od dołu.", "Compression requires it – I'll pad them with transparency on the right and bottom.") : T("Te pliki zostaną pominięte.", "These files will be skipped."))),
      el("button", { class: "btn small", onclick: () => set("vPad", !opt.vPad) }, opt.vPad ? T("Zamiast tego: pomiń", "Skip them instead") : T("Dopełnij", "Pad them"))));
  });
  return { main, side };
}

function convertRows(fmt) {
  return [
    { id: "fmt", label: T("Format", "Format"), ctl: () => selC("vFmt", [["auto", T(`auto · ${FMTNAME[eng().fmt]}`, `auto · ${FMTNAME[eng().fmt]}`)], ["png", "PNG"], ["tga", "TGA"], ["dds", "DDS"], ["webp", "WebP"], ["exr", "EXR"], ["jpg", "JPG"]]), hint: opt.vFmt === "auto" ? T(`Zalecany dla silnika: ${FMTNAME[fmt]}.`, `Recommended for the engine: ${FMTNAME[fmt]}.`) : null },
    fmt === "dds" ? { id: "dds", label: T("Kompresja", "Compression"), sub: "BC", ctl: () => selC("vDds", [["auto", T("auto wg rodzaju", "auto by kind")], ["bc7", "BC7"], ["bc1", "BC1"], ["bc3", "BC3"], ["bc4", "BC4"], ["bc5", "BC5"], ["rgba", T("bez kompresji", "uncompressed")]]) } : null,
    fmt === "dds" ? { id: "mips", label: T("Mniejsze kopie na odległość", "Smaller copies for distance"), sub: T("mipmapy", "mipmaps"), ctl: () => swC("vMips") } : null,
    fmt === "png" || fmt === "tga" ? { id: "ch", label: T("Kanały", "Channels"), ctl: () => segC("vCh", [["auto", "RGBA"], [3, "RGB"], [1, T("szary", "grey"), T("szary z kanału R", "grey from channel R")]]) } : null,
    fmt === "jpg" ? { id: "q", label: T("Jakość", "Quality"), ctl: () => stepC("vQuality", { min: 40, max: 100, step: 5 }) } : null,
    { id: "bleed", label: T("Ochrona krawędzi", "Edge protection"), sub: "alpha bleeding", ctl: () => swC("vBleed") },
    { id: "suffix", label: T("Dopisek do nazwy", "Name suffix"), ctl: () => txtC("vSuffix", T("np. _ue", "e.g. _ue"), 110) },
  ];
}

// =====================================================================================================
// 7. Sprawdź pliki
// =====================================================================================================

const KINDS = {
  big: { color: "--warn", title: T("Za duże do gry", "Too big for a game"), why: T("Większość silników nie wczyta tekstury ponad limit albo zmniejszy ją sama, gorzej.", "Most engines won't load a texture over the limit or will shrink it themselves, worse."), fix: "resize", fixL: T("Zmniejsz", "Shrink") },
  bits: { color: "--warn", title: T("16 bitów na kanał", "16 bits per channel"), why: T("Gry używają 8 bitów. „Przygotuj do silnika” zapisze je w 8 bitach.", "Games use 8 bits. “Prepare for engine” saves them as 8-bit."), fix: "convert", fixL: T("Przygotuj", "Prepare") },
  cmyk: { color: "--warn", title: T("Kolory w CMYK", "CMYK colours"), why: T("Silniki czytają tylko RGB. Zmień tryb w Photoshopie: Obraz › Tryb › RGB.", "Engines read RGB only. Change the mode in Photoshop: Image › Mode › RGB."), fix: null },
  empty: { color: "--warn", title: T("Całkowicie przezroczyste", "Fully transparent"), why: T("Obraz nic nie pokazuje – sprawdź eksport albo usuń plik.", "The image shows nothing – check the export or delete the file."), fix: null },
  size: { color: "--accent", title: T("Rozmiar nie pasuje do kompresji", "Size doesn't suit compression"), why: "", fix: "resize", fixL: T("Popraw rozmiar", "Fix size") },
  name: { color: "--accent", title: T("Spacje i polskie znaki w nazwach", "Spaces and special characters in names"), why: T("Silniki i Git mają z nimi problem. Zamienię je, np. „Ikona menu ł.png” → „Ikona_menu_l.png”.", "Engines and Git struggle with them. I'll replace them, e.g. “Icon menu ł.png” → “Icon_menu_l.png”."), fix: "name", fixL: T("Popraw nazwy", "Fix names") },
  opaque: { color: "--muted", title: T("Niepotrzebna przezroczystość", "Unneeded alpha"), why: T("Kanał przezroczystości jest pełny – zapis jako RGB zmniejszy plik. To tylko wskazówka.", "The alpha channel is full – saving as RGB makes the file smaller. Just a hint."), fix: null, info: true },
};

function viewCheck(g) {
  if (!paths.length) return { main: needFiles(T("Zaznacz obrazy albo foldery i wybierz „Game Assets: sprawdź pliki”.", "Select images or folders and choose “Game Assets: check files”.")), side: null, foot: el("span", {}, "") };
  const potReq = !!opt.kPot;
  KINDS.size.why = potReq ? T(`${eng().name} najlepiej działa z potęgą 2 (mipmapy, streaming).`, `${eng().name} works best with a power of 2 (mipmaps, streaming).`) : T("Bez boków podzielnych przez 4 kompresja nie zadziała – tekstura zajmie 4× więcej pamięci.", "Without sides divisible by 4 compression fails – the texture takes 4× more memory.");
  KINDS.size.title = potReq ? T("Rozmiar nie jest potęgą 2", "Size isn't a power of 2") : T("Rozmiar nie dzieli się przez 4", "Size isn't divisible by 4");
  KINDS.big.title = T(`Ponad ${opt.kMax} px`, `Over ${opt.kMax} px`);
  if (!report) {
    const main = el("div", { class: "empty" }, busy ? T(`Sprawdzam… ${busy.done}/${busy.total}`, `Checking… ${busy.done}/${busy.total}`) : el("button", { class: "btn primary", onclick: runCheck }, T(`Sprawdź ${nFiles(paths.length)}`, `Check ${nFiles(paths.length)}`)));
    return { main, side: [tweaks(checkRows())], foot: el("span", {}, T("Sprawdzanie tylko czyta pliki – nic nie zmienia.", "Checking only reads files – nothing changes.")) };
  }
  const byKind = new Map();
  for (const r of report) for (const i of r.issues) { if (!byKind.has(i.kind)) byKind.set(i.kind, []); byKind.get(i.kind).push(r); }
  const bad = report.filter((r) => r.issues.some((i) => !KINDS[i.kind].info));
  const okN = report.length - bad.length, ratio = okN / Math.max(1, report.length);
  const main = [
    el("div", { class: "row", style: "gap:16px;flex-wrap:nowrap" },
      el("div", { class: "ring", style: `background:conic-gradient(var(--ok) 0 ${Math.round(ratio * 100)}%, var(--warn) ${Math.round(ratio * 100)}% 100%)` }, el("div", {}, `${okN}/${report.length}`)),
      el("div", {}, el("div", { style: "font-size:17px;font-weight:600" }, T(`${okN} z ${report.length} plików jest gotowych do gry`, `${okN} of ${report.length} files are game-ready`)),
        el("div", { class: "muted" }, bad.length ? T(`${bad.length} ${plural(bad.length, "plik ma", "pliki mają", "plików ma")} problemy – poniżej, co z nimi zrobić.`, `${bad.length} file${bad.length === 1 ? " has" : "s have"} problems – below is what to do.`) : T("Wszystko w porządku.", "Everything is fine.")))),
    Object.keys(KINDS).filter((k) => byKind.has(k)).map((k) => {
      const K = KINDS[k], rows = byKind.get(k);
      return el("div", { class: "prob" },
        el("span", { class: "dot", style: `background:var(${K.color})` }),
        el("div", { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:3px" },
          el("b", {}, `${K.title} · ${rows.length} ${plural(rows.length, "plik", "pliki", "plików")}`),
          el("span", { class: "small muted", style: "line-height:1.4" }, K.why),
          el("div", {}, rows.slice(0, 6).map((r) => el("span", { class: "chip", style: "margin:2px 4px 0 0", title: r.path }, `${baseName(r.path)}${r.w ? ` · ${r.w} × ${r.h}` : ""}`)), rows.length > 6 ? el("span", { class: "small muted" }, ` +${rows.length - 6}`) : null)),
        K.fix ? el("button", { class: "btn small", onclick: () => (K.fix === "name" ? fixNames(rows.map((r) => r.path)) : openTab(K.fix, rows.map((r) => r.path))) }, K.fixL) : null);
    }),
    okN ? el("div", { class: "prob", style: "background:transparent" }, el("span", { class: "dot", style: "background:var(--ok)" }), el("span", { style: "flex:1" }, T(`${okN} ${plural(okN, "plik", "pliki", "plików")} bez problemów`, `${okN} file${okN === 1 ? "" : "s"} without problems`))) : null,
  ];
  const total = report.reduce((s, r) => s + (r.w ? vramBytes(r.w, r.h, opt.kVram, true) : 0), 0);
  const raw = report.reduce((s, r) => s + (r.w ? vramBytes(r.w, r.h, "rgba8", true) : 0), 0);
  const names = byKind.get("name") || [];
  const side = [
    names.length ? mainBtn(T(`Popraw nazwy automatycznie (${names.length})`, `Fix names automatically (${names.length})`), () => fixNames(names.map((r) => r.path))) : null,
    resCard(T("Pamięć karty graficznej", "Graphics memory"), `≈ ${mb(total)}`, el("span", { class: "small muted" }, T(`po kompresji w ${eng().name} · bez kompresji ≈ ${mb(raw)}`, `after ${eng().name} compression · uncompressed ≈ ${mb(raw)}`))),
    el("div", { class: "row" }, el("button", { class: "btn", onclick: runCheck }, T("Sprawdź ponownie", "Check again")), el("button", { class: "btn", onclick: saveCsv }, T("Zapisz raport (CSV)", "Save report (CSV)"))),
    tweaks(checkRows()),
  ];
  return { main, side, foot: el("span", {}, T("Sprawdzanie tylko czyta pliki – nic nie zmienia, dopóki nie klikniesz „Popraw”.", "Checking only reads files – nothing changes until you click “Fix”.")) };
}

function checkRows() {
  const reset = () => { report = null; };
  return [
    { id: "max", label: T("Maks. rozmiar w grze", "Max size in game"), ctl: () => selC("kMax", [[1024, "1024"], [2048, "2048"], [4096, "4096"], [8192, "8192"]], reset) },
    { id: "pot", label: T("Wymagaj potęgi 2", "Require power of 2"), sub: T(`ustawione wg silnika (${eng().name})`, `set by engine (${eng().name})`), ctl: () => swC("kPot") },
    { id: "alpha", label: T("Sprawdzaj przezroczystość", "Check transparency"), sub: T("czyta piksele – wolniej", "reads pixels – slower"), ctl: () => swC("kAlpha") },
  ];
}

async function runCheck() {
  report = null;
  busy = { done: 0, total: paths.length, label: T("Sprawdzam…", "Checking…") };
  draw();
  const out = [];
  for (const p of paths) {
    const r = { path: p, w: 0, h: 0, issues: [] };
    const add = (kind) => r.issues.push({ kind });
    try {
      let i = await infoOf(p);
      if (!i) { const im = await load(p); i = { width: im.w, height: im.h, channels: 4, bits: 8, cmyk: false }; }
      r.w = i.width; r.h = i.height;
      if (Math.max(i.width, i.height) > opt.kMax) add("big");
      if (opt.kPot ? !(isPot(i.width) && isPot(i.height)) : i.width % 4 || i.height % 4) add("size");
      if (i.bits > 8) add("bits");
      if (i.cmyk) add("cmyk");
      if (opt.kAlpha && (i.channels === 2 || i.channels === 4 || extOf(p) === "psd" || extOf(p) === "dds") && i.width * i.height <= 4096 * 4096) {
        const a = alphaRange(await load(p));
        if (a.hi === 0) add("empty");
        else if (a.lo === 255 && (i.channels === 2 || i.channels === 4)) add("opaque");
      }
    } catch (e) { r.err = errText(e); }
    if (/\s/.test(baseName(p)) || /[^\x20-\x7E]/.test(baseName(p))) add("name");
    out.push(r);
    busy.done++;
    if (busy.done % 4 === 0) draw();
  }
  report = out;
  busy = null;
  draw();
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
  opt = saved && typeof saved === "object" && saved.v === 2 ? { ...DEF, ...saved } : { ...DEF, ...(saved && saved.engine ? { engine: saved.engine } : {}) };
  const src = ctx && ctx.paths && ctx.paths.length ? ctx.paths : ctx && ctx.folder ? [ctx.folder] : [];
  paths = (await collect(src, tab === "check")).sort((a, b) => natural(baseName(a), baseName(b)));
  opt.tab = tab || "start";
  resizeAuto = null;
  sliceAuto = new Map();
  normalCache = null;
  dismissed = new Set();
  editDest = false;
  focus = 0;
  result = null;
  report = null;
  atlasCache = null;
  infos = new Map();
  picks = new Map();
  folderLists.clear();
  aSel = new Set();
  baseCache = null;
  atlasCfg = (await wayfolder.storage.get("atlasCfg").catch(() => null)) || {};
  draw();
  await wayfolder.ui.panel.open({ title: "Game Assets", width: 1180, height: 780 });
  if (opt.tab === "check" && paths.length) runCheck();
}

if (typeof document !== "undefined" && document.head) document.head.append(el("style", {}, STYLE));
wayfolder.ui.panel.onClose(() => { memoMap.clear(); cache.clear(); cacheBytes = 0; atlasCache = null; baseCache = null; spriteImgs.clear(); });

wayfolder.menu.add({ id: "open", label: T("Game Assets…", "Game Assets…"), when: { files: true, ext: IMAGE_EXT }, run: (ctx) => open(null, ctx) });
wayfolder.menu.add({ id: "atlas", label: T("Game Assets: atlas z zaznaczonych…", "Game Assets: atlas from selection…"), when: { files: true, min: 2, ext: IMAGE_EXT }, run: (ctx) => open("atlas", ctx) });
wayfolder.menu.add({ id: "channels", label: T("Game Assets: pakuj kanały PBR…", "Game Assets: pack PBR channels…"), when: { files: true, min: 2, ext: IMAGE_EXT }, run: (ctx) => open("channels", ctx) });
wayfolder.menu.add({ id: "normal", label: T("Game Assets: zrób normal mapę…", "Game Assets: make a normal map…"), when: { files: true, ext: IMAGE_EXT }, run: (ctx) => open("normal", ctx) });
wayfolder.menu.add({ id: "check", label: T("Game Assets: sprawdź pliki…", "Game Assets: check files…"), when: { files: true, folders: true, background: true }, run: (ctx) => open("check", ctx) });
wayfolder.commands.add({ id: "open-cmd", label: "Game Assets…", run: (ctx) => open(null, ctx) });
