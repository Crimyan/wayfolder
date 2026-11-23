// Prawy klik na obrazach › Kopiuj jako linki Markdown. Bez uprawnień – używa tylko klikniętych ścieżek.
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
    wayfolder.toast((wayfolder.lang === "pl" ? "Skopiowano linki: " : "Copied links: ") + lines.length);
  },
});
