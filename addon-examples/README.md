# Add-on examples

Full source of the add-ons that ship with Wayfolder, plus two small ones. To try one, zip its `manifest.json` and `main.js` and install the ZIP in **Settings › Add-ons › Install from ZIP…**. The guide is in [ADDONS.md](../ADDONS.md).

| Folder | Shows |
|---|---|
| [hello-wayfolder](hello-wayfolder) | The smallest add-on: menu items, prompt, writing a file |
| [md-links](md-links) | A menu item for some file types, clipboard, no permissions |
| [batch-rename](batch-rename) | Own window with live preview, `files.renameMany`, `storage` |
| [image-export](image-export) | `images.export`, image previews, options saved in `storage` |
| [compare-images](compare-images) | `files.imageUrl` plus a canvas: slider, fade, difference |
| [photoshop-actions](photoshop-actions) | `run` and `files.tempDir`: runs a Photoshop action through an ExtendScript file |
| [game-assets](game-assets) | `images.read` / `images.info` / `images.write`: trim, power of 2, atlas packing, PBR channel packing, DDS export |

The built-in add-ons start with a small shared block of helpers (`el`, `seg`, `T` for translations). Copy it as well if you reuse their code.
