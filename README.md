# MX Bikes Manager

Desktop app to manage your installed MX Bikes mods and browse and install mods from mxb-mods.com.

## Run it

Double-click **MX Bikes Manager.lnk** in this folder, or run:

```
npm start
```

## Screens

- **My Mods**: Bikes / Tracks / Tyres & other, with Brand, Size (cc) and Class filters for bikes.
- **Rider**: separate **Outfit**, **Bike**, and **My gear** tabs. Interactive previews show your rider and selected bike/livery. Create or copy real game profiles for multiple gear setups.
- **Get Mods**: free mods from mxb-mods.com (Popular today, week, month or all time, and Newest), plus the **MXB Hub** and **MX Bikes Shop** stores. Sign in to a shop to see **My purchases** and install them. Anything you already have shows **Installed** instead of an Install button.
- **OEM Packs**: MX, Enduro, Supermoto and Freeride OEM packs, compared file by file with your mods folder. Only missing or changed bikes are downloaded (read straight out of the pack's zip), not the whole multi-GB pack.
- **Online**:
  - **Servers**: **Live servers** — every server an app user is riding on, with its track (checked against yours, with "Get track"), riders and classes; join addresses, saved servers, and shareable `mxbm://join/ip:port` links. Live data needs the game plugin (`plugin/`) and an online service (`server/`, which you can run on your own PC).
  - **Friends**: pick friends from your Steam friends list (or paste a Steam ID); once you've both added each other you see which server and track they're on and can join them in one click. Your Steam name and Steam ID are used automatically.
  - **Paint sync**: shares the paints of the outfit you ride (bike livery, kit, gloves, helmet, goggles, boots, protector) with mutual friends and downloads theirs into the right folders so you see them in game. Only readable `.pnt` paints travel — never models, never protected paints; your own files are never overwritten, and downloaded paints can be removed in one click. If a friend's paint needs a helmet or bike you don't have, it says which and offers to find it.
  - **Built-in service address**: the service address lives in `online.config.json` (currently `http://192.168.0.38:60000`). Every copy of the app signs in to it automatically with the user's Steam account; users never pick an address, and the app retries every minute if the service is down.
  - **Ranked**: a native view of mxb-ranked.com, read from its public pages in the background. Your profile is found automatically from your Steam ID, with no login.
    - **Your profile**: rating, EXP, wins, podiums, average finish, MXP, and every recent race.
    - **Servers**: filters for "Ones I can join" (based on your rating and rank), riders online now, category and bikes.
    - **Server details**: click a server to see its live lobbies (region, status, track, players), the track rotation with installed or missing marked, and Join. Join copies the lobby name and opens the game; the site says ranked servers are joined in game.
    - **Other sections**: Results, Lap records, Tracks (with Get track), News, and Season standings.
  - The live public server list isn't built yet. The game's master server uses a private, undocumented protocol.
- **Graphics** (also a tab in My Mods): ReShade, add-ons, presets and shader packs in the game folder, with on/off switches. You can browse graphics mods from mxb-mods.com (overhauls, ReShade presets, tweaks) and install them into the game folder. Any game file they replace is backed up as `.mxbm-bak`.
- **Game**:
  - **Ride**: pick a bike and track, and the game opens with them selected.
  - **Settings**: graphics, sound, riding aids, camera and HUD, and controls, saved straight to `profile.ini`. Refuses to save while the game is running, and keeps a backup.
  - **Fix & clean**: ReShade or stray DLLs, empty tyre folders, zipped downloads, misplaced tracks, duplicates, old rider-gear folders, plus a storage breakdown. Fixes are reversible (Recycle Bin or rename).
- **Downloads**: progress, review, and an **Updates** tab.
- **Settings**: folders, accounts (Steam is detected locally, and you sign in to shops on their own pages), install and picture options, and re-running the setup.
- First launch shows a short setup: find the game, link accounts, preferences.

## What it does

**Library (your installed mods)**
- Finds your game folders automatically: `Documents\PiBoSo\MX Bikes\mods` and the Steam install (any Steam library drive).
- Lists every bike, track, helmet, boot, glove, rider kit, protection, tyre and misc mod, grouped by category with counts and disk usage.
- Track preview images are read from inside each track's `.pkz` (or folder). Track author, location and layout count come from the track's `.ini`.
- Bikes use image grids with brand, cc, and class filters. Clicking a bike opens its interactive installed model. Track pictures can come from local packages, mxb-mods, MX Bikes Shop, or MXB Hub; results are ranked by name, year, round, and variant.
- Search, sort (name, recently added, size, most paints), grid or list view, favorites.
- **Enable / Disable**: moves a mod (its `.pkz` plus the matching folder) into `MX Bikes\mods_disabled (MX Bikes Manager)` and back. Nothing is deleted.
- **Delete** sends files to the Recycle Bin.
- Bulk select (Ctrl+click or the checkbox) to enable, disable or delete many mods at once.
- Bikes and helmets show their paint list, and you can delete single paints.
- Detects duplicate downloads like `Track (1).pkz`. Exact duplicates (same size) can be selected and removed in one click.
- Flags archives left unextracted in the mods folder (e.g. `khanyland.zip`). After successful installation and content verification, the original archive moves to the Recycle Bin and the warning clears.
- Handles both the current rider gear layout (`rider/riders/default_mx/...`) and the old one (`rider/...`).

**Browse (mxb-mods.com)**
- Search and filter by category: tracks, new bikes, liveries, rider kits, helmets, boots, gloves, protection, goggles, sounds, wheels, modpacks, tools.
- Mod pages with an image gallery, description, and all download links.
- **Install** downloads, unpacks, and puts files in the right folder:
  - Hosts handled automatically: mxb-mods.com, Google Drive, MediaFire, Mega (decrypted locally), Dropbox.
  - Folder links, GitHub, and Drive files that need a sign-in open in a built-in browser window. Click the download button there and it installs automatically.
  - If the destination is certain, it installs straight away. Otherwise a review screen lets you pick the mod type, track type (motocross/supercross/...), or which bike/helmet a paint goes on (it guesses from the name).
- Drag `.pkz` / `.pnt` / `.zip` / `.rar` / `.7z` files onto the window to install them.

**Rider (outfit per bike)**
- Shows and edits the outfit saved in your game profile for each bike: livery, rider model, helmet and paint, goggles, kit, chest protector and paint, gloves, boots and paint.
- 3D preview: the rider body, helmet, boots and chest protector / neck brace, wearing your chosen paints (kit, gloves, helmet, goggles, boots, protector). Drag to turn, scroll to zoom. Models and paints come from your mods folder, falling back to the game's own `rider.pkz`. Ordinary ZIP and unbound KCOL assets are supported. Account-bound or unsupported assets show an unavailable preview.
- Gear pickers include brand filters and show a 3D render of readable options (helmets, helmet paints, goggles, kits, gloves, boots, boot paints, protectors) on your rider with your other gear, rendered as you scroll. Missing, unsupported or protected assets are marked "Preview unavailable" instead of showing a wrong look.
- Loose gear files override files in the matching `.pkz`; a separate paints folder does not hide the packaged model. An unreadable gear model is skipped so it does not fail the entire outfit preview.
- Opens on the bike the game will actually put you on (it remembers one per class), not the stale `bikeid` line in your profile.
- My gear includes individual bike paints with brand/cc filters and deletion, plus rider models with add/delete and preview controls. Click a slot, pick from a searchable grid, and it saves instantly. "Use this outfit on all bikes" copies the outfit to every bike.
- Refuses to save while MX Bikes is running. A backup of `profile.ini` is kept next to it.

**Add mod from PC**
- The button in the Library (or drag and drop). The app looks inside the file to work out what it is (track, helmet, boots, chest protector, tyres...). If it can't tell, it asks with a simple "What did you upload?" picker.

**Pictures**
- Missing pictures are searched across mxb-mods, MX Bikes Shop, and MXB Hub. The best reliable match is used, and unsuccessful searches are retried. You can choose any result manually. Bike livery choices use their recorded download-page image; the Bike tab previews the actual paint in 3D.

**Updates**
- Tracks everything installed through the app. **Check for updates** compares against the site, offers one-click updates, and does clean uninstalls.

Extraction uses 7-Zip if installed, otherwise WinRAR or Windows' built-in `tar`.

Third-party code and licences: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Maintenance and checks

- Temporary staging folders are removed after successful, failed, or cancelled jobs. Abandoned staging is cleared before the next app window opens.
- Generated thumbnails are pruned by age and a 256 MB target; images assigned to mods are preserved. Selected images can exceed the generated-cache target. 3D previews do not leave extracted model copies on disk.
- Host offers a three-step setup with practice, quick race, and custom event presets, followed by optional settings.
- Run `npm test`. For format inspection, run `node scripts/read-asset.js INPUT` (use `--entry PATH --output NEWFILE` to export a selected archive entry).
