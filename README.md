# Logo Swap Tool

A small Mac desktop app for batch-swapping a logo into multiple Photoshop (.psd)
and Illustrator (.ai) templates, then exporting PNG + WebP.

## How it works

- Photoshop templates: the logo must live in a **Smart Object layer**. The tool
  replaces that Smart Object's contents (so any Warp/Perspective/Puppet Warp
  already applied to it carries over automatically), then exports PNG.
- Illustrator templates: works with **placed (linked) images**, and also as a
  safety net with leftover pasted/grouped SVG artwork. Either way, the tool
  measures the old logo's bounding box, removes it, places the new logo fresh,
  and refits it — see below.
- Both engines export PNG only. The app then converts that PNG to WebP itself
  using `sharp` — this is more reliable across app/OS versions than depending
  on each app's native WebP export.
- Original template files are **never overwritten** — they're opened, used,
  and closed without saving, so they stay reusable templates. (Exception: the
  rename step, which intentionally saves the renamed layer back into the file.)

## Handling different logo aspect ratios

Photoshop's "Replace Contents" already fits new content into the Smart
Object's existing box on its own -- the tool relies on that native behavior
directly rather than adding extra resize steps, which avoids any conflict
with Warp/Perspective effects already applied to the layer.

If a template has **linked/duplicated Smart Object instances across multiple
artboards** (edit one, all update), you only need to point the tool at the
one master layer -- Photoshop's own linking handles propagating the new
content to the other artboards automatically; nothing extra to configure.

## Preview thumbnails

Click **"Update Preview"** to see how the current logo + scale looks on every
artboard before committing to a real export. This runs the same pipeline as
a real swap, but writes to a temporary folder instead of your chosen output
folder, so it never touches your real files. It's not instant -- Photoshop
still has to actually do the swap to show you an accurate result -- so
expect a few seconds per template, same as a real export. Adjust the Logo
Scale slider, click Update Preview again, repeat until it looks right, then
use "Swap + Export" for the final files.

## Multi-artboard exports

If a Photoshop template has artboards, the tool automatically exports **one
PNG + WebP per artboard** (named `basename_ArtboardName.png`) instead of one
combined image. Templates without artboards export as a single file, same
as before.

## Packaging as a real .app (optional)

If you'd rather not use Terminal every time, you can build this into an
actual double-clickable app:

```
npm install
npm run dist
```

This produces `dist/mac/Logo Swap Tool.app` (or `dist/mac-arm64/...` on
Apple Silicon). Drag that into `/Applications`.

**First launch:** since this isn't signed with an Apple Developer
certificate, macOS will block it the first time. Right-click the app icon,
choose **Open**, then click **Open** again in the dialog that appears --
after that it opens normally like any other app. If you instead see a
"malware blocked" message (a known false-positive some Electron apps have
hit in 2026), clear it the same way we did before:
```
xattr -cr "/Applications/Logo Swap Tool.app"
```
then try opening it again.

You'll still need Photoshop/Illustrator to grant this app permission to
control them via Automation the first time you run a scan or swap, same as
before.

If you change any of the script files later, re-run `npm run dist` to
rebuild the app with the changes.

## One-time setup: GitHub (for fully automatic builds, no Terminal ever)

The app checks GitHub for new versions, and a GitHub Action (an automated
recipe GitHub runs for you) builds the actual DMG on Apple's own cloud Macs
whenever the project changes -- so building and publishing a new version
never requires opening Terminal on your own machine. This repo is **public**:
anyone could view the source code or download a built release, but your
actual client template files, logos, and configured profiles never get
pushed to GitHub either way -- those stay entirely on your own machine's
local app storage, regardless of the repo's visibility.

**What you do (all clicking in a browser, no commands):**

1. **Create a GitHub account** (free): https://github.com/join
2. **Create a new repository**: the "+" top-right > "New repository".
   - Name it exactly `logo-swap-tool`
   - Leave it **Public**
   - Leave it empty -- no README, no license
3. **Create a Personal Access Token** (a one-time credential that lets the
   initial project upload happen -- ongoing builds use GitHub's own
   automatic token and don't need this): your profile photo (top-right) >
   Settings > Developer settings > Personal access tokens > Tokens
   (classic) > Generate new token (classic). Tick the **repo** scope, set
   whatever expiry you're comfortable with, and copy the token -- GitHub
   only shows it once.
4. **Share that token with me in chat**, along with your GitHub username.
   I'll push the project to your new repo and it'll build automatically
   from there. Once I confirm it's pushed, revoke/delete the token
   immediately from that same GitHub settings page -- it's no longer
   needed after that one push.

**What happens after that, forever:**

- Whenever the app needs a change, I update the code and push it
- GitHub automatically builds a new DMG and publishes it as a release --
  nobody runs any build command, on any machine
- Everyone's copy of the app notices the new release on launch and prompts
  to restart and install it

The very first time, you (and anyone else on the team) still download the
DMG from the repo's Releases page once and drag it into Applications --
same as installing any other Mac app. After that, it's self-updating.

## Export folder structure

When running a real export, you now also enter a **Job/Export Name**. The
tool creates:
```
<chosen output folder>/<job name>/PSD/       (a copy of each source template used)
<chosen output folder>/<job name>/Exports/   (the actual output images)
```

## Sharing profiles with your team

Every profile and every template file attached to it lives entirely inside
the app's own data folder (not referencing files at their original location
on your machine) -- this makes a profile fully self-contained and shareable.

- **Share:** click "Reveal Profiles Folder" to open it in Finder, then zip
  the whole `profiles` folder and send it to a teammate.
- **Receive:** they click "Import Shared Profiles Folder," pick the unzipped
  folder you sent, and it merges those profiles (and their files) straight
  into their own copy of the app -- no manual file re-linking needed.

## One-time setup

1. Install Node.js (from nodejs.org) if you don't already have it.
2. In this folder, run:
   ```
   npm install
   ```
3. Open `src/config.js` and make sure `PHOTOSHOP_APP_NAME` and
   `ILLUSTRATOR_APP_NAME` exactly match your installed app names (check
   `/Applications` — e.g. "Adobe Photoshop 2025").
4. **macOS permissions:** the first time you run this, macOS will ask for
   permission to let Terminal/Electron control Photoshop and Illustrator via
   Apple Events. Approve these in
   **System Settings > Privacy & Security > Automation**.

## Running the app

```
npm start
```

## The cleanup pass (do this once per template)

Since your existing templates don't have consistently named logo layers yet:

1. Select one or more templates with **"Choose Templates"**.
2. Click **"Scan Selected Templates for Layer Names"**. This opens each file,
   lists every Smart Object (Photoshop) or placed item (Illustrator), and
   shows you the names.
3. For whichever one is the actual logo slot, click **"Rename to LOGO"** next
   to it. This renames it in the file and saves.
   - If a template has more than one logo slot (e.g. sponsor + league logo),
     rename them `LOGO_1`, `LOGO_2`, etc., and run the swap once per slot
     name (change the "Logo Layer/Slot Name" field between runs).
4. You only need to do this once per template — after that, every future swap
   on that file just works.

## Running a swap

1. Choose templates (can select many at once — mix of .psd and .ai is fine).
2. Choose the logo file.
3. Confirm/edit the "Logo Layer/Slot Name" field (defaults to `LOGO`).
4. Choose an output folder.
5. Click **"Swap + Export"**.

For each template you'll get `<template-name>.png` and `<template-name>.webp`
in the output folder.

## Notes / things you may need to tweak

- **Illustrator `relink()`**: this method exists in Illustrator 2018 (CC v22)
  and later. If you're on an older version, let me know and I'll swap in an
  embed/replace-based approach instead.
- **Multiple logo slots per template**: currently the app runs one slot name
  per pass. If you want a single run that fills multiple slots at once (e.g.
  sponsor logo into `LOGO_1` and league logo into `LOGO_2` simultaneously),
  I can extend the UI to let you assign a different logo file per slot.
- **Batch logo × template matrix**: if you ever need "these 5 logos into
  these 10 templates = 50 exports" in one run, that's a small extension to
  the run loop — happy to add a "cartesian batch mode" button.
- **App names/versions**: if you have multiple Photoshop/Illustrator versions
  installed, make sure `src/config.js` points at the one you actually use.

## Project structure

```
logo-swap-tool/
  index.html            UI
  src/
    main.js             Electron main process, orchestrates everything
    preload.js           Safe bridge between UI and main process
    renderer.js          UI logic
    config.js             App names + settings you may need to edit
  scripts/
    photoshop-scan.jsx           lists Smart Object layer names
    photoshop-rename.jsx         renames a Smart Object layer
    photoshop-swap-export.jsx    swaps logo + exports PNG
    illustrator-scan.jsx         lists placed item names
    illustrator-rename.jsx       renames a placed item
    illustrator-swap-export.jsx  relinks logo + exports PNG
```
