# Jak zrobić dodatek do Wayfoldera

[English](ADDONS.md) · [Wróć do opisu Wayfoldera](README.pl.md)

Dodatek to mały plik JavaScript i `manifest.json`. Może dodać pozycje do menu pod prawym przyciskiem, otworzyć własne okno w Wayfolderze i pracować na plikach: zmieniać nazwy wielu plików, eksportować obrazy, uruchamiać programy itd. Tak samo zbudowanych jest pięć dodatków dołączonych do Wayfoldera (Zmiana nazw wielu plików, Eksport obrazów, Porównanie obrazów, Akcje Photoshopa, Game Assets). Ich pełne źródła są w [`addon-examples`](addon-examples), więc możesz skopiować któryś i przerobić.

Wystarczy edytor tekstu. Nie trzeba niczego budować ani instalować.

---

## 1. Start w 2 minuty

1. W Wayfolderze otwórz **☰ › Ustawienia › Dodatki** i kliknij **Poradnik i szablon…**.
   Powstanie przykładowy dodatek *Hello Wayfolder* i otworzy się jego folder.
2. Włącz *Hello Wayfolder* przełącznikiem.
3. Kliknij plik prawym przyciskiem. Pojawi się nowa sekcja **Dodatki** z pozycją **Copy file names**.
4. Zmień `main.js` w tym folderze, zapisz i kliknij **Wczytaj dodatki ponownie**. Zmiana od razu działa.

Gdy dodatek działa, spakuj `manifest.json` i `main.js` do ZIP-a. Każdy zainstaluje go przez **Ustawienia › Dodatki › Instaluj z ZIP…**.

---

## 2. Pliki

```
moj-dodatek/
├─ manifest.json
└─ main.js
```

Możesz spakować same pliki albo cały folder `moj-dodatek`. Oba sposoby działają.

### manifest.json

```json
{
  "id": "moj-dodatek",
  "name": "Mój dodatek",
  "version": "1.0.0",
  "author": "Twoje imię",
  "description": "Co robi, w jednym zdaniu.",
  "main": "main.js",
  "permissions": ["read", "write"]
}
```

| Pole | Uwagi |
|---|---|
| `id` | Małe litery, cyfry oraz `-` `_` `.`. Musi być unikalne. Tak nazwie się folder dodatku. |
| `name` | Widoczna w Ustawieniach i w menu pod prawym przyciskiem. |
| `version` | Instalacja ZIP-a z tym samym `id` zastępuje starą wersję. |
| `main` | Plik ze skryptem (domyślnie `main.js`). |
| `permissions` | Dowolne z `read`, `write` i `run`; opis niżej. Proś tylko o to, czego używasz. |

### Uprawnienia

Użytkownik widzi je przed instalacją. Wywołanie, które wymaga uprawnienia, o które dodatek nie poprosił, kończy się błędem. Wayfolder sprawdza to dwa razy: raz w oknie i raz w rdzeniu aplikacji.

| Uprawnienie | Pozwala |
|---|---|
| *(brak)* | Pozycje menu, polecenia, komunikaty, okienka z pytaniem, własne okno, własne ustawienia (`storage`), zapis do schowka, folder tymczasowy |
| `read` | Listowanie folderów, czytanie plików tekstowych, informacje o pliku, podglądy obrazów |
| `write` | Tworzenie plików tekstowych, zmiana nazw, kopiowanie, przenoszenie, nowe foldery, zmiana nazw wielu plików. Wszystko poza `writeText` trafia do **Dziennika** i da się cofnąć. |
| `run` | Uruchamianie programów, np. Photoshopa ze skryptem |

`images.export` wymaga i `read`, i `write`. `images.read` i `images.info` wymagają `read`, a `images.write` – `write`.

---

## 3. Jak to działa

- Każdy włączony dodatek działa we własnej, odizolowanej ramce (piaskownicy). Nie ma dostępu do wnętrza Wayfoldera ani do dysku. Wszystko idzie przez globalny obiekt `wayfolder` opisany niżej.
- Skrypt uruchamia się raz: przy starcie Wayfoldera albo po kliknięciu **Wczytaj dodatki ponownie**. Pozycje menu rejestruj na najwyższym poziomie skryptu. Ich funkcje `run` wywołują się później.
- Wszystkie funkcje oprócz `menu.add`, `commands.add` i `toast` zwracają **Promise**, więc używaj `await`.
- Nieobsłużony błąd pokazuje czerwony komunikat z nazwą dodatku. Nie psuje Wayfoldera.
- Ścieżki to zwykłe ścieżki Windows (`D:\Projekty\Grafika\hero.psd`). W napisach JavaScript każdy ukośnik piszesz podwójnie: `"D:\\Projekty"`.

---

## 4. Opis API

### Pozycje menu i polecenia

```js
wayfolder.menu.add({
  id: "copy-names",                // unikalne w obrębie dodatku
  label: "Kopiuj nazwy plików",
  when: { files: true, folders: true, multi: true },
  run: async (ctx) => { /* ctx.paths, ctx.folder */ },
});

wayfolder.commands.add({           // pojawia się w ☰ › Dodatki
  id: "tidy",
  label: "Uporządkuj ten folder…",
  run: async (ctx) => { /* ctx.paths (zaznaczenie), ctx.folder */ },
});
```

`when` decyduje, gdzie widać pozycję. Bez niego pozycja pokazuje się dla plików i folderów.

| Klucz | Znaczenie |
|---|---|
| `files: true` | Prawy klik na pliku |
| `folders: true` | Prawy klik na folderze |
| `background: true` | Prawy klik na pustym miejscu w folderze (`ctx.paths` jest puste) |
| `multi: false` | Ukryj, gdy zaznaczono kilka elementów |
| `min: 2` | Pokaż dopiero przy co najmniej 2 zaznaczonych |
| `ext: ["psd", "png"]` | Pokaż tylko, gdy **wszystkie** zaznaczone pliki mają jedno z tych rozszerzeń |

`ctx` to `{ paths: string[], folder: string }`. `paths` to zaznaczone elementy albo ten kliknięty. `folder` to otwarty folder, a w wynikach wyszukiwania i innych widokach `""`.

W **Ustawieniach › Menu prawego przycisku** użytkownik może przesunąć Twoją pozycję, ukryć ją albo przenieść do **Więcej ›**, tak samo jak wbudowane.

### Komunikaty i proste okienka

```js
wayfolder.toast("Gotowe!");

const v = await wayfolder.ui.prompt({
  title: "Zapisz listę plików",
  ok: "Zapisz",
  fields: [{ id: "name", label: "Nazwa pliku", value: "pliki.txt" }],
});
if (v) console.log(v.name);            // null po anulowaniu

if (await wayfolder.ui.confirm("Nadpisać 12 plików?")) { /* … */ }

await wayfolder.clipboard.writeText("skopiowany tekst");
```

### Własne okno (panel)

Do wszystkiego większego niż okienko z pytaniem zbuduj stronę zwykłym HTML-em w `document.body` i pokaż ją jako okno:

```js
document.body.innerHTML = `
  <h2>Cześć</h2>
  <div class="row"><input id="n" value="42"> <button class="btn primary" id="go">Dalej</button></div>`;
document.getElementById("go").onclick = () => wayfolder.ui.panel.close();

await wayfolder.ui.panel.open({ title: "Mój dodatek", width: 640, height: 420 });
wayfolder.ui.panel.onClose(() => { /* użytkownik zamknął (✕, Esc albo klik obok) */ });
```

Strona sama dostaje kolory aplikacji, w jasnym i ciemnym motywie, i zmienia je od razu po zmianie motywu. Masz do dyspozycji zmienne CSS i gotowe klasy:

- **Zmienne:** `--bg`, `--side`, `--hover`, `--text`, `--muted`, `--border`, `--accent`, `--accent-soft`, `--ok`, `--warn`, `--tile`
- **Przyciski:** `btn`, `btn primary`, `btn ghost`
- **Przełącznik opcji:** `seg` z `<button class="on">`
- **Układ:** `row`, `col`, `grid` (etykieta | pole), `spacer`, `actions` (przyciski po prawej), `card`
- **Tekst:** `muted`, `small`, `ok`, `warn`
- Pola, listy wyboru, pola wyboru i tabele mają już styl.

`wayfolder.lang` to `"pl"` albo `"en"`, więc możesz tłumaczyć napisy.

### Ustawienia dodatku

```js
await wayfolder.storage.set("options", { format: "png", size: 1024 });
const opt = (await wayfolder.storage.get("options")) ?? { format: "png" };
```

Każdy dodatek ma własne miejsce na ustawienia, do 200 KB w JSON. `localStorage` przeglądarki nie działa w piaskownicy, więc używaj tego.

### Pliki

```js
const items = await wayfolder.files.list("D:\\Grafika");          // read
// → [{ name, path, isDir, size, modified, ext }]
const info = await wayfolder.files.info("D:\\Grafika\\a.psd");     // read · te same pola albo null, gdy pliku nie ma
const text = await wayfolder.files.readText("D:\\notatki.txt");   // read · do 20 MB
const url  = await wayfolder.files.imageUrl("D:\\a.psd", 512);     // read · podgląd jako data URL (maks. 2048 px) albo null

await wayfolder.files.writeText("D:\\lista.txt", "cześć");        // write · tworzy albo nadpisuje
await wayfolder.files.rename("D:\\a.png", "b.png");               // write · Dziennik
await wayfolder.files.copy(["D:\\a.png"], "E:\\Kopia");           // write · Dziennik
await wayfolder.files.move(["D:\\a.png"], "D:\\Gotowe");          // write · Dziennik
await wayfolder.files.mkdir("D:\\Grafika", "Eksport");            // write · Dziennik

const r = await wayfolder.files.renameMany([                       // write · JEDNA pozycja w Dzienniku
  ["D:\\Grafika\\a.png", "01.png"],
  ["D:\\Grafika\\b.png", "02.png"],
]);
// → { done: 2, errors: [] }  ·  błędy wyglądają tak: "b.png: exists"

const tmp = await wayfolder.files.tempDir();                       // prywatny folder tymczasowy dodatku
```

`renameMany` sam ustawia łańcuchy we właściwej kolejności, np. `01→02, 02→03`. Odrzuca zamiany w kółko (`a↔b`) i zgłasza je jako `name_cycle`.

### Obrazy

```js
const r = await wayfolder.images.export(
  ["D:\\Grafika\\hero.psd", "D:\\Grafika\\bg.exr"],  // PSD, PSB, PNG, JPG, TGA, TIFF, EXR, HDR, DDS, WebP…
  "D:\\Grafika\\eksport",                            // powstanie, jeśli go nie ma
  { format: "webp", maxSize: 2048, quality: 90, suffix: "_web" },
);
// → { done, files: [nowe ścieżki], errors }
```

- `format`: `png`, `jpg` albo `webp` (WebP bez strat). JPG nie ma przezroczystości, więc dostaje białe tło.
- `maxSize` ogranicza dłuższy bok. Mniejszych obrazów nie powiększa.
- Istniejących plików nigdy nie nadpisuje. Zamiast tego używa wolnej nazwy, np. `hero (2).png`.
- Wyeksportowane pliki trafiają do **Dziennika**, więc **Cofnij** odkłada je do kosza.
- PSD zapisany bez opcji *Maksymalizuj zgodność* nie ma spłaszczonego obrazu. Kończy się błędem `psd_no_composite` zamiast małej miniatury.

### Piksele: odczyt i zapis (od wersji 0.3)

```js
const img = await wayfolder.images.read("D:\\Grafika\\hero.psd");      // read · { width, height, data } – data to Uint8ClampedArray RGBA
const small = await wayfolder.images.read(path, { maxSize: 512 });     // read · zmniejszony (dłuższy bok najwyżej 512)
const info = await wayfolder.images.info("D:\\Grafika\\rock_N.png");    // read · { width, height, channels, bits, cmyk, format } z nagłówka albo null

// zmień piksele w img.data, a potem zapisz:
const saved = await wayfolder.images.write("D:\\Grafika\\game\\hero.png", img, { format: "png" });   // write · zwraca ścieżkę
await wayfolder.images.write("D:\\Grafika\\game\\rock_N.dds", img, { format: "dds", dds: "bc5", mipmaps: true, srgb: false });
```

- `format`: `png`, `tga`, `dds`, `exr`, `webp` (bez strat) albo `jpg` (`quality` 1–100). Rozszerzenie w ścieżce jest poprawiane do formatu.
- `channels` (PNG i TGA): `4` RGBA (domyślnie), `3` RGB albo `1` szary z kanału R.
- `dds`: `bc7`, `bc1`, `bc3`, `bc4` (jeden kanał), `bc5` (dwa kanały, normal mapy) albo `rgba` (bez kompresji). Kompresja BC wymaga wymiarów będących wielokrotnością 4, inaczej błąd `dds_not_multiple_of_4`.
- `srgb`: przy DDS wariant sRGB (domyślnie tak, dla map danych ustaw `false`); przy EXR zamiana kolorów z sRGB na liniowe.
- Folder powstaje, jeśli go nie ma. Istniejących plików nigdy nie nadpisuje – wybiera wolną nazwę, np. `hero (2).png`. Każdy zapis trafia do **Dziennika**.
- Obraz najwyżej 16384 px na bok. Piksele idą bez kopiowania do tekstu, więc nawet tekstury 4K przechodzą szybko.

### Uruchamianie programów

```js
await wayfolder.run("C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe", ["D:\\tmp\\skrypt.jsx"]); // run
```

Zobacz [`addon-examples/photoshop-actions`](addon-examples/photoshop-actions/main.js). Ten dodatek zapisuje skrypt ExtendScript w `tempDir()`, uruchamia z nim Photoshopa i czeka na plik z wynikiem.

---

## 5. Pełny przykład

Prawy klik na obrazach i **Kopiuj jako linki Markdown**:

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
    wayfolder.toast(`Skopiowano linki: ${lines.length}`);
  },
});
```

```json
{ "id": "md-links", "name": "Linki Markdown", "version": "1.0.0", "author": "ty",
  "description": "Kopiuje zaznaczone obrazy jako linki Markdown.", "main": "main.js", "permissions": [] }
```

Ten dodatek nie potrzebuje żadnych uprawnień, bo używa tylko ścieżek, które kliknąłeś.

---

## 6. Wskazówki

- **Większe przykłady:** w [`addon-examples`](addon-examples) są dodatki wbudowane w Wayfoldera. *Zmiana nazw* pokazuje okno z podglądem na żywo i `renameMany`. *Eksport obrazów* pokazuje `images.export` i `storage`. *Porównanie obrazów* korzysta z `imageUrl` i canvasa. *Akcje Photoshopa* używają `run` i `tempDir`. *Game Assets* pokazuje `images.read` / `images.write`: przetwarzanie pikseli w JavaScripcie (trim, atlas, kanały) i zapis do DDS.
- **Często przeładowuj:** zmieniaj plik w folderze dodatków (**Ustawienia › Dodatki › Otwórz folder dodatków**), potem kliknij **Wczytaj dodatki ponownie**.
- **Błędy** widać jako czerwone komunikaty. Ryzykowny kod owiń w `try { … } catch (e) { wayfolder.toast(String(e)) }`, żeby komunikaty były czytelniejsze.
- **Dbaj o użytkownika:** proś o jak najmniej uprawnień, zmieniaj pliki przez API, żeby trafiały do Dziennika, i mów, co się stanie, zanim coś nadpiszesz.

Pytania albo dodatek do pokazania? Załóż [zgłoszenie (issue)](../../issues).
