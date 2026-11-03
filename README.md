# Wayfolder

**A file explorer and organizer for Windows, made for graphic artists and game developers.**

> **Early build (beta) – v0.2.4.** Wayfolder works and is used daily, but expect rough edges. Every move, copy, rename and delete can be undone from the journal, but keep backups of important work.

**[Download Wayfolder 0.2.4 for Windows](https://github.com/Crimyan/wayfolder/releases/download/v0.2.4-beta/Wayfolder_0.2.4_x64-setup.exe)**

[Polska wersja opisu](README.pl.md)

## What it does

**Browse like Explorer, but built for creative files**

- Tabs, path bar, tree, grid and list, drag and drop to and from Explorer and other apps, Windows clipboard and context menu.
- Thumbnails for PSD/PSB, AI, EPS, INDD, AEP, Blender, DDS, EXR/HDR, TGA, TIFF, WebP, video and PDF – plus everything Windows can show.
- Preview panel: images, PDF/AI pages, 3D models (FBX, OBJ, GLB/glTF, STL, PLY, DAE, 3MF, 3DS), video, audio, fonts, text and code, ZIP contents.
- Journal with undo for every operation.

**Find anything**

- Global search over all your drives (Ctrl+Space), with filters by type, drive and date. Program and system folders are skipped automatically.
- Filter the current folder with patterns like `BG*` or words in any order.

**Organize**

- Your own statuses (e.g. *Final*, *To fix*) and tags. They follow files that you move, even with Explorer.
- **Projects** – a layer over normal folders: color, structure templates (Game, Client job, Illustration or your own), input folders.
- **Sorting queue** – new files from your Desktop, Downloads or render output show up in the project queue. *“What is it?”* asks step by step through the project's real folders, learns from your choices and can also guess from image content (optional CLIP model, runs locally).
- **New folder from existing** – copy a folder structure and rename its files in one table.
- **Clean-up** – duplicates, copies (“- Copy”, “(1)”), forgotten desktop folders and old temp files, with an archive that keeps the original paths.

**Second desktop and widget**

- An infinite board with groups of shortcuts, notes, reference panels with free zoom (PureRef-style, paste images from the clipboard), queue counters and a sorting tile.
- A floating widget (from the tray) that opens the same board, with search on top.

**Windows integration (optional, in Settings)**

- Start with Windows, open Wayfolder with Win+E, open folders from the desktop and other apps in Wayfolder. Turning these off – or uninstalling – restores File Explorer.
- Updates itself: asks GitHub for the latest version and installs it with one click. Nothing about your files is sent.

## Install

1. Download **[Wayfolder_0.2.4_x64-setup.exe](https://github.com/Crimyan/wayfolder/releases/download/v0.2.4-beta/Wayfolder_0.2.4_x64-setup.exe)**. You can also click *Code → Download ZIP* at the top of this page – the installer is inside the ZIP. All versions: [Releases](../../releases).
2. Run it. It installs for your user only (no administrator rights) into `%LOCALAPPDATA%\Wayfolder` and adds a Start menu shortcut. The installer asks for the language (English or Polski); you can change it later in Settings.
3. Windows SmartScreen may warn about an unknown publisher (the beta is not code-signed) – choose *More info → Run anyway*.

Requirements: Windows 10 or 11 (x64). WebView2 is installed automatically if missing.

To uninstall, use *Settings → Apps* in Windows. You can choose to delete Wayfolder's data (projects, tags, board, thumbnails) as well.

## Your data stays on your computer

Wayfolder does not send your files or file names anywhere. Thumbnails, the search index, tags, projects and the board are stored in your user profile (`%APPDATA%` / `%LOCALAPPDATA%\app.wayfolder.desktop`). The optional image recognition (CLIP) downloads its model once and runs locally.

## Status

Beta. Planned: Office document previews, more languages, code signing, auto-update.

Found a bug or have an idea? Open an [issue](../../issues) – a screenshot and the steps to reproduce help a lot.

## License

Wayfolder is free to download and use during the beta. The source code is not public.
© 2026 Crimyan. All rights reserved.
