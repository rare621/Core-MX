# Notes on Codex's changes (reviewed 2026-11-13)

Files changed after ~20:35 on 2026-11-13 (when Claude's last edit landed). Read-only review; nothing was changed or reverted.

## ⚠️ Decrypts creator-protected files — decide whether to keep this

- **New `src/lib/assetread.js`** reads PiBoSo **KCOL** containers: the encryption on creator-protected bike `.pkz` packs (e.g. the OEM pack, all 53 of your mod bikes) and on sealed `.pnt` paints. The per-file key is recovered from each file's own footer (XOR with a fixed 6-byte salt), then RC4 with a drop is applied. No key is bundled, but it is the same protection Claude declined to break earlier.
- It refuses "account-bound" containers (a GUID in the footer), so Steam-locked paid content is still left alone. Creator-sealed content with no account binding is opened.
- **Wired in everywhere:** `pnt.js` (`decode`/`names` unwrap sealed paints), `rider3d.js` (archive sources, models), `bike3d.js` (bike models), `zipread.js` (general `.pkz` reading, so scanning and installs too).
- **`scripts/read-asset.js`** is a command-line tool that lists a package's contents and **exports a decrypted file to disk** (`--entry … --output …`). That's an extraction tool, not just a previewer. It's the part most likely to upset creators if the app is shared.
- `MODDING_PLAN.md` mentions a "private loaded-code inspection dump" (since deleted), so the method came from inspecting the running game's code.
- Effect on things already built: the "Protected" tiles in the gear picker and the "kit couldn't be read" warnings will mostly stop appearing, because sealed paints now decode. Paint sync still refuses them (its own `readable()` check runs on the raw file; worth re-checking, since `pnt.names` now decrypts first).

Options: keep as is (private use), keep preview-only but delete `scripts/read-asset.js`, or remove the KCOL path entirely and go back to "Protected".

## New features

- **3D bike** (`src/lib/bike3d.js`, ~170 lines): assembles bike parts at `.geom` mount points (fork, swingarm, wheels from the tyres mod), poses suspension so both tyres touch the ground, applies the livery `.pnt`. Follows MXB App's conventions. IPC `bike:model`.
- **`edf.js` / `rider3d.js` reworked:**
  - `fitBounds` option; independent object frames for helmets exported with a camera root (the "2020FOXV1 face + teeth" case).
  - Extra texture-coordinate channel for Fly/6D exports, and glove thumbnails isolated from the body.
  - Bounded caches and cache invalidation.
- **`mesh-util.js`:** `compactMesh` drops unused vertices per part (smaller IPC payloads).
- **Profiles:** create a new game profile and switch the active one (`rider:createProfile`, `rider:activateProfile`).
- **Rider model management:** `rider:previewModel`, `rider:deleteModel`.
- **Library:** per-mod paint list/delete (`library:paints`, `library:trashFile`, `library:showFile`), local install (`library:installLocal`), and image candidates from search (`library:imageCandidates` + new `image-match.js`, which ranks images by year/round/pro-am).
- **Installs:** `installs:checkUpdates`, `installs:uninstall`, `jobs:startFiles`. New `file-verify.js` compares SHA-256 so "already installed" isn't decided on size alone.
- **`cache-cleanup.js`:** prunes old generated thumbnails (256 MB / 90-day cap, keeps chosen images).
- **Shops** (`shops.js`): purchases read from the downloads page with caching, descriptions filled from the product page, bounded concurrency, and HTTP errors not cached.
- **Host:** presets (per `MODDING_PLAN.md`); `host.js` renderer grew to ~29 KB.
- **Get Mods / scanner / installer / health / detect:** touched at 22:07–22:13; details not reviewed line by line.

## Tests (new)

- `npm test` (Node's built-in runner) → **30/30 passing**.
- Covers: container integrity, sources, transform hierarchy, suspension mounts, image ranking, profiles, store loading, content verification, cache cleanup, storage.
- Fixtures are synthetic (`test/helpers/assets.js`), not real game files.

## Housekeeping

- `package.json`: added `"test"` script. `three` is now `^0.170.0` (was pinned `0.170.0`).
- `README.md` and `THIRD_PARTY_NOTICES.md` updated (22:13).
- `MODDING_PLAN.md` claims your game files and profiles were not modified; write paths were tested in throwaway folders.
- Untouched by Codex: the online service (`server/` predates its run), the plugin, paint sync and the Friends page. `live.js` and `online.js` timestamps are from Claude's edits.
