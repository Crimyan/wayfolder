// Example add-on. Edit it, then Settings › Add-ons › Reload add-ons.
// Full API: see README.md in this folder.

wayfolder.menu.add({
  id: "copy-names",
  label: "Copy file names",
  when: { files: true, folders: true },
  run: async (ctx) => {
    const names = ctx.paths.map((p) => p.split("\\").pop()).join("\n");
    await wayfolder.clipboard.writeText(names);
    wayfolder.toast(`Copied ${ctx.paths.length} names`);
  },
});

wayfolder.menu.add({
  id: "make-list",
  label: "Save list of files…",
  when: { background: true },
  run: async (ctx) => {
    const v = await wayfolder.ui.prompt({ title: "Save list of files", fields: [{ id: "name", label: "File name", value: "files.txt" }] });
    if (!v) return;
    const files = await wayfolder.files.list(ctx.folder);
    await wayfolder.files.writeText(ctx.folder + "\\" + v.name, files.map((f) => f.name).join("\n"));
    wayfolder.toast("Saved " + v.name);
  },
});
