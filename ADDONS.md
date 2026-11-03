# Making a Wayfolder add-on

[Polska wersja](ADDONS.pl.md) · [Back to Wayfolder](README.md)

An add-on is a small JavaScript file plus a `manifest.json`. It can add items to the right-click menu, open its own window inside Wayfolder and work on files – rename them in batches, export images, start a program and so on. Wayfolder ships five add-ons built this way (Batch rename, Export images, Compare images, Photoshop actions, Game Assets). Their full source is in [`addon-examples`](addon-examples), so you can copy one and change it.

You only need a text editor. There is no build step and nothing to install.

---

## 1. Start in 2 minutes

1. In Wayfolder open **☰ › Settings › Add-ons** and click **Guide & template…**.
   This creates the example add-on *Hello Wayfolder* and opens its folder.
2. Turn *Hello Wayfolder* on with its switch.
3. Right-click a file. There is a new **Add-ons** section with **Copy file names**.
4. Edit `main.js` in that folder, save, and click **Reload add-ons**. Your change is live.

When it works, put `manifest.json` and `main.js` in a ZIP. Anyone can install it with **Settings › Add-ons › Install from ZIP…**.

---

## 2. Files

```
my-addon/
├─ manifest.json
└─ main.js
```

You can zip the files directly or zip the `my-addon` folder. Both work.

### manifest.json

```json
{
  "id": "my-addon",
  "name": "My add-on",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What it does, in one sentence.",
  "main": "main.js",
  "permissions": ["read", "write"]
}
```

| Field | Notes |
|---|---|
| `id` | Lower-case letters, digits and `-` `_` `.`. Must be unique. The add-on folder gets this name. |
| `name` | Shown in Settings and in the right-click menu. |
| `version` | Installing a ZIP with the same `id` replaces the old version. |
| `main` | The script file (default `main.js`). |
| `permissions` | Any of `read`, `write` and `run`; see below. Ask only for what you use. |

### Permissions

The user sees these before installing. A call that needs a permission the add-on didn't ask for fails with an error, and Wayfolder checks this twice: once in the window and once in the app core.

| Permission | Allows |
|---|---|
| *(none)* | Menu items, commands, toasts, prompts, own window, own settings (`storage`), clipboard (write), temp folder |
| `read` | List folders, read text files, file info, image previews |
| `write` | Create text files, rename, copy, move, make folders, batch rename. Everything except `writeText` is recorded in the **Journal** and can be undone. |
| `run` | Start programs, e.g. Photoshop with a script |

`images.export` needs both `read` and `write`. `images.read` and `images.info` need `read`; `images.write` needs `write`.

---

## 3. How it runs

- Each enabled add-on runs in its own isolated frame (a sandbox). It has no access to Wayfolder's internals or to the disk. Everything goes through the global `wayfolder` object described below.
- The script runs once, when Wayfolder starts or when you click **Reload add-ons**. Register your menu items at the top level of the script. Their `run` functions are called later.
- Every function except `menu.add`, `commands.add` and `toast` returns a **Promise**, so use `await`.
- An uncaught error shows a red toast with the add-on's name. It doesn't break Wayfolder.
- Paths are normal Windows paths (`D:\Projects\Art\hero.psd`). In JavaScript strings, write each backslash twice: `"D:\\Projects"`.

---

## 4. API reference

### Menu items and commands

```js
wayfolder.menu.add({
  id: "copy-names",                // unique within your add-on
  label: "Copy file names",
  when: { files: true, folders: true, multi: true },
  run: async (ctx) => { /* ctx.paths, ctx.folder */ },
});

wayfolder.commands.add({           // shows in ☰ › Add-ons
  id: "tidy",
  label: "Tidy this folder…",
  run: async (ctx) => { /* ctx.paths (selection), ctx.folder */ },
});
```

`when` decides where a menu item appears. If you leave it out, the item shows for files and folders.

| Key | Meaning |
|---|---|
| `files: true` | Right-click on a file |
| `folders: true` | Right-click on a folder |
| `background: true` | Right-click on empty space in a folder (`ctx.paths` is empty) |
| `multi: false` | Hide when several items are selected |
| `min: 2` | Show only when at least 2 items are selected |
| `ext: ["psd", "png"]` | Show only when **all** selected files have one of these extensions |

`ctx` is `{ paths: string[], folder: string }`. `paths` holds the selected items, or the clicked one. `folder` is the open folder, or `""` in search results and other views.

Users can move, hide or put your item under **More ›** in **Settings › Right-click menu**, just like built-in items.

### Messages and simple dialogs

```js
wayfolder.toast("Done!");

const v = await wayfolder.ui.prompt({
  title: "Save list of files",
  ok: "Save",
  fields: [{ id: "name", label: "File name", value: "files.txt" }],
});
if (v) console.log(v.name);            // null when cancelled

if (await wayfolder.ui.confirm("Overwrite 12 files?")) { /* … */ }

await wayfolder.clipboard.writeText("copied text");
```

### Your own window (panel)

For anything bigger than a prompt, build a page with normal HTML in `document.body` and show it as a window:

```js
document.body.innerHTML = `
  <h2>Hello</h2>
  <div class="row"><input id="n" value="42"> <button class="btn primary" id="go">Go</button></div>`;
document.getElementById("go").onclick = () => wayfolder.ui.panel.close();

await wayfolder.ui.panel.open({ title: "My add-on", width: 640, height: 420 });
wayfolder.ui.panel.onClose(() => { /* user closed it (✕, Esc or click outside) */ });
```

The page uses the app's colours automatically, in light and dark theme, and they update live when the theme changes. Use these CSS variables and ready classes:

- **Variables:** `--bg`, `--side`, `--hover`, `--text`, `--muted`, `--border`, `--accent`, `--accent-soft`, `--ok`, `--warn`, `--tile`
- **Buttons:** `btn`, `btn primary`, `btn ghost`
- **Segmented choice:** `seg` with `<button class="on">`
- **Layout:** `row`, `col`, `grid` (label | control), `spacer`, `actions` (buttons on the right), `card`
- **Text:** `muted`, `small`, `ok`, `warn`
- Inputs, selects, checkboxes and tables are styled already.

`wayfolder.lang` is `"pl"` or `"en"`, so you can translate your labels.

### Settings for your add-on

```js
await wayfolder.storage.set("options", { format: "png", size: 1024 });
const opt = (await wayfolder.storage.get("options")) ?? { format: "png" };
```

Each add-on has its own storage, up to 200 KB of JSON. Browser `localStorage` is not available inside the sandbox, so use this instead.

### Files

```js
const items = await wayfolder.files.list("D:\\Art");          // read
// → [{ name, path, isDir, size, modified, ext }]
const info = await wayfolder.files.info("D:\\Art\\a.psd");     // read · same fields, or null if missing
const text = await wayfolder.files.readText("D:\\notes.txt");  // read · up to 20 MB
const url  = await wayfolder.files.imageUrl("D:\\a.psd", 512); // read · preview as data URL (max 2048 px) or null

await wayfolder.files.writeText("D:\\list.txt", "hello");     // write · creates or overwrites
await wayfolder.files.rename("D:\\a.png", "b.png");           // write · Journal
await wayfolder.files.copy(["D:\\a.png"], "E:\\Backup");      // write · Journal
await wayfolder.files.move(["D:\\a.png"], "D:\\Done");        // write · Journal
await wayfolder.files.mkdir("D:\\Art", "Exports");            // write · Journal

const r = await wayfolder.files.renameMany([                   // write · ONE Journal entry
  ["D:\\Art\\a.png", "01.png"],
  ["D:\\Art\\b.png", "02.png"],
]);
// → { done: 2, errors: [] }  ·  errors look like "b.png: exists"

const tmp = await wayfolder.files.tempDir();                   // private temp folder of your add-on
```

`renameMany` puts chains in the right order by itself, for example `01→02, 02→03`. It refuses names that swap in a circle (`a↔b`) and reports them as `name_cycle`.

### Images

```js
const r = await wayfolder.images.export(
  ["D:\\Art\\hero.psd", "D:\\Art\\bg.exr"],   // PSD, PSB, PNG, JPG, TGA, TIFF, EXR, HDR, DDS, WebP…
  "D:\\Art\\export",                          // created if missing
  { format: "webp", maxSize: 2048, quality: 90, suffix: "_web" },
);
// → { done, files: [new paths], errors }
```

- `format`: `png`, `jpg` or `webp` (WebP is lossless). JPG has no transparency, so it gets a white background.
- `maxSize` limits the longest side. Smaller images are never enlarged.
- Existing files are never overwritten. A free name like `hero (2).png` is used instead.
- The exported files go to the **Journal**, so **Undo** moves them to the trash.
- A PSD saved without *Maximize Compatibility* has no flattened image. It fails with `psd_no_composite` rather than giving you a tiny preview.

### Pixels: read and write (since 0.3)

```js
const img = await wayfolder.images.read("D:\\Art\\hero.psd");          // read · { width, height, data } – data is a Uint8ClampedArray (RGBA)
const small = await wayfolder.images.read(path, { maxSize: 512 });     // read · scaled down (longest side up to 512)
const info = await wayfolder.images.info("D:\\Art\\rock_N.png");        // read · { width, height, channels, bits, cmyk, format } from the header, or null

// change the pixels in img.data, then save:
const saved = await wayfolder.images.write("D:\\Art\\game\\hero.png", img, { format: "png" });   // write · returns the path
await wayfolder.images.write("D:\\Art\\game\\rock_N.dds", img, { format: "dds", dds: "bc5", mipmaps: true, srgb: false });
```

- `format`: `png`, `tga`, `dds`, `exr`, `webp` (lossless) or `jpg` (`quality` 1–100). The extension in the path is corrected to match.
- `channels` (PNG and TGA): `4` RGBA (default), `3` RGB or `1` grey from the R channel.
- `dds`: `bc7`, `bc1`, `bc3`, `bc4` (one channel), `bc5` (two channels, normal maps) or `rgba` (uncompressed). BC compression needs both sides to be a multiple of 4, otherwise you get `dds_not_multiple_of_4`.
- `srgb`: for DDS the sRGB variant (default true; set `false` for data maps); for EXR converts colours from sRGB to linear.
- The folder is created when missing. Existing files are never overwritten – a free name such as `hero (2).png` is used. Every write goes to the **Journal**.
- Images up to 16384 px per side. Pixels are passed as binary data, so even 4K textures are quick.

### Running programs

```js
await wayfolder.run("C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe", ["D:\\tmp\\script.jsx"]); // run
```

See [`addon-examples/photoshop-actions`](addon-examples/photoshop-actions/main.js). It writes an ExtendScript file to `tempDir()`, starts Photoshop with it, then waits for a result file.

---

## 5. A complete example

Right-click images and choose **Copy as Markdown links**:

```js
const IMG = ["png", "jpg", "jpeg", "psd", "webp"];

wayfolder.menu.add({
  id: "md-links",
  label: wayfolder.lang === "pl" ? "Kopiuj jako linki Markdown" : "Copy as Markdown links",
  when: { files: true, ext: IMG },
  run: async (ctx) => {
    const lines = ctx.paths.map((p) => {
      const name = p.split("\\").pop();
      return `![${name}](${p.replace(/\\/g, "/")})`;
    });
    await wayfolder.clipboard.writeText(lines.join("\n"));
    wayfolder.toast(`Copied ${lines.length} links`);
  },
});
```

```json
{ "id": "md-links", "name": "Markdown links", "version": "1.0.0", "author": "you",
  "description": "Copies selected images as Markdown image links.", "main": "main.js", "permissions": [] }
```

This one needs no permissions, because it only uses the paths you clicked.

---

## 6. Tips

- **Bigger examples:** [`addon-examples`](addon-examples) holds the built-in add-ons. *Batch rename* shows a panel with live preview and `renameMany`. *Export images* shows `images.export` and `storage`. *Compare images* works with `imageUrl` and a canvas. *Photoshop actions* uses `run` and `tempDir`. *Game Assets* shows `images.read` / `images.write`: pixel processing in JavaScript (trim, atlas, channels) and saving to DDS.
- **Reload often:** edit the file in the add-ons folder (**Settings › Add-ons › Open add-ons folder**), then click **Reload add-ons**.
- **Errors** show up as red toasts. Wrap risky code in `try { … } catch (e) { wayfolder.toast(String(e)) }` for friendlier messages.
- **Be kind to the user:** ask for the fewest permissions you can, put file changes through the API so they land in the Journal, and say what will happen before overwriting anything.

Questions or an add-on to share? Open an [issue](../../issues).
