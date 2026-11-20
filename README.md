# CoreMX

**Content manager for MX Bikes** · [coremx.app](https://coremx.app/)

**Your bikes, tracks, gear, and downloads in one place.**

CoreMX is a Windows desktop app for organizing your MX Bikes mods, finding new content, building rider outfits, and getting ready to ride. Browse your installed collection with pictures, preview your bike and gear in 3D, and install downloads into the right folders.

[**Download the Windows installer**](https://github.com/rare621/Core-MX/releases/latest) · [Report a problem](https://github.com/rare621/Core-MX/issues) · [Build from source](#build-from-source)

![Installed bike library with brand, engine size, and class filters](docs/screenshots/library.png)

## Install and get started

1. Open [Releases](https://github.com/rare621/Core-MX/releases/latest) and download the latest **CoreMX-Setup-…-x64.exe**.
2. Run the setup and choose where to install it. The setup adds desktop and Start menu shortcuts.
3. Open **CoreMX**. It looks for your Steam game install and your `Documents\PiBoSo\MX Bikes` folder. You can choose the folders yourself if needed.
4. Browse **My Mods**, build an outfit under **Rider**, or find something new in **Get Mods**.

You need 64-bit Windows and your own copy of MX Bikes. The installed app includes its runtime, so you do **not** need Node.js, npm, or the source code. Game and mod assets shown in the screenshots are installed separately.

The installed app checks the public [Core-MX GitHub releases](https://github.com/rare621/Core-MX/releases) at startup and offers an update dialog. It downloads only after you choose Install, then restarts to apply it. **Settings → General → App updates** also has Check now. Updates preserve the manager's settings and installed mods.

This first release is unsigned, so Windows may show an unknown-publisher warning. Each release includes `SHA256SUMS.txt` for checking the installer download. Uninstalling the manager keeps your game mods and manager settings.

## Keep your mods organized

**My Mods** brings bikes, tracks, tyres, and other installed content into a visual library.

- Search your collection and filter bikes by **brand, engine size, and class**.
- Favorite mods, see what's installed, and switch between grid and list views.
- Enable or disable content without permanently deleting it.
- Delete individual mods or paints through the Windows Recycle Bin.
- Set your own preview images, or search supported mod sites for a matching picture.

## Build your rider outfit

Choose your helmet, goggles, kit, gloves, boots, and protection with searchable, brand-filtered pickers. The 3D preview shows supported installed models and paints, with drag-to-rotate and scroll-to-zoom controls.

![Rider outfit selection and interactive 3D preview](docs/screenshots/outfit.png)

Save a different outfit for each bike, copy an outfit across your bikes, or create multiple **game profiles** for different gear setups. **My gear** also lets you manage rider models and individual bike paints, including brand and cc filtering for bike paints.

Choices are previews until you press **Apply** on the Outfit or Bike tab. Close MX Bikes, choose your setup, press Apply, then launch the game. Apply saves and activates the selected game profile and bike, and checks the saved values. **Revert** discards the current preview; **Refresh** reads the game files again. Profiles can be created or deleted, and profile changes made in the game are detected by the manager. Profile backups are kept beside the originals.

Helmets, boots, protection, and their paints belong in the shared `mods/rider/` accessory folders. Rider bodies go in `mods/rider/riders/`; kit paints and glove paints go inside the selected body's `paints/` and `gloves/` folders. The installer, previews and sync use this layout. **Settings → Fix & clean** repairs misplaced gear without replacing different existing files; identical extra copies go to the Recycle Bin.

## Preview your bike and livery

The **Bike** tab shows the installed model with your selected paint and tyres. Turn it around, zoom in, and use the picture-grid picker to change bikes. Livery choices use their recorded download-page images. Press **Apply** to save the previewed setup to the game.

![Interactive bike preview with the selected livery](docs/screenshots/bike.png)

Preview support depends on the installed asset format. Some creator-specific, account-bound, missing, or unsupported assets may not produce a preview.

## Find and install new content

**Get Mods** combines browsing for **mxb-mods.com**, **MXB Hub**, and **MX Bikes Shop**. Search for tracks, bikes, liveries, rider kits, helmets, gloves, and more.

![Mod browser showing free content and supported store tabs](docs/screenshots/get-mods.png)

- Open listings to see their description, pictures, and download choices.
- **MXB Mods** and **Addons** use the same live website listings. Bike liveries, gloves and standard rider kits stay in MXB Mods. Addons contains gear paints and kits that require another model. Separate Mod Instructions are checked for rider-model requirements; browsing does not download mod archives or build a disk index.
- Sign in on a supported shop's own page to access **your purchases**.
- Install downloaded archives or drag files into the app.
- Review the destination when a download needs help finding the right model.
- Follow download progress directly on a listing. Cancelling an unfinished install rolls back its written files and restores overwritten files.
- **Downloads → Recent installs** lists the last ten installs and reopens their previous location choices so files can be moved without downloading again. Completed download history keeps ten items; clearing it leaves installed files intact.
- Filter target bikes by **brand and cc** when installing paints.
- Use **OEM Packs** to compare supported packs with what you already have and install missing or changed files.

Paid content still requires a purchase and your own store account. Some download hosts need you to complete a step in the built-in browser. Compressed downloads require 7-Zip, WinRAR, or a supported Windows extraction tool.

## Get ready to ride

**Game** lets you choose a bike and track, launch MX Bikes, and edit supported game settings. **Settings → Fix & clean** checks for common folder problems, misplaced gear, duplicate downloads, and archives left zipped in your mods folder, and shows a storage breakdown.

Install jobs clean up temporary staging files after completion, failure, or cancellation. Generated thumbnails are pruned over time, while images you've assigned to mods are preserved.

## Play online

Join or save a server address, use shareable join links, and configure a session under **Online → Host**. Host setup walks through choosing a track, naming the server, and picking a practice or race preset, with more settings available underneath.

![Online page with saved servers and joining by address](docs/screenshots/online.png)

Live presence, friends, and gear sharing use a **separately hosted online service**, and some of it the optional game plugin. Without the plugin: on first launch, while Steam is signed in on the PC, the app registers your Steam ID and Steam name with the service; then it reports every 30 seconds whether the game is running and your rider and profile names, and (with outfit sync on) uploads your equipped gear every minute for friends and riders on your server. **Go offline** stops all of it. With the plugin installed, reports also include your server, track, bike and the server's rider list; see [plugin/README.md](plugin/README.md) for everything the plugin does. The server list reflects participating app users; it is not the game's complete public server browser. Installers include the server address configured in `online.config.json`, so these shared features need that service running and reachable from the user's network. Local mod management, previews, profiles, and store browsing work independently.

Use the bottom-left Steam account's **Friends & status** button to search friends, see their status, and open their equipped gear, selected paints, bike livery, tyres, server and track. Five friends are shown initially, with Show all for the rest. **Online → Sync** contains sharing settings. Automatic equipped-file sync checks for changes each minute and skips identical files already installed. Progress floats over the page. Your own outfit stays selected. Synced files nobody has needed for a month (adjustable) go to the Recycle Bin. **Get track & join** searches the creator's download pages and waits for the matching track to be installed before joining. A server address must be available through shared presence, a saved server, or the game's own server list, which the CoreMX plugin reads.

Servers refresh every five minutes while the Online page is open, with a manual Refresh button. Population and network-ping filters are available. Capacity remains unknown when the service has no maximum-player count; network ping can be unavailable if a host blocks ICMP.

Online hosts updating to 1.0.8 must also update **mxbm-server.js** from the release's **mxbm-online-service.zip** (health version 5). Keep the existing account database and shared-file folder; see [server update instructions](server/README.md#update-an-existing-server).

To change the service address in an installed copy, close the manager and edit `%LOCALAPPDATA%\Programs\CoreMX\resources\online.config.json` in Notepad, then reopen the manager. If you chose another install folder, open its `resources\online.config.json` instead.

## Build from source

Use Node.js 24 or later:

```powershell
npm ci
npm start
```

Run the checks or build a Windows setup:

```powershell
npm test
npm run build:win
```

The setup EXE and checksum are written to `dist/`. [Release instructions](docs/RELEASING.md) explain the GitHub Actions workflow and optional online-service configuration. The online service is deployed separately; see [server setup](server/README.md).

## Feedback and credits

Found a problem? [Open an issue](https://github.com/rare621/Core-MX/issues) with the app version, what you clicked, and a screenshot if possible. Do not include account tokens or passwords.

An independent community project, not affiliated with PiBoSo or the supported mod stores. Game assets, mod content, and screenshots of installed content belong to their respective creators. Third-party format work and library notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Website links

[coremx.app](https://coremx.app/#/) is the main CoreMX website. The Windows setup registers these links:

- `mxbm://install/local/123` opens a community upload on CoreMX.
- `mxbm://install/mxbmods/123` opens the matching MXB Mods listing. A single available download starts through the normal install/review flow; multiple downloads stay available to choose.
- `mxbm://install/mxbmods/123?file=1` selects the second download (zero-based index). Invalid indexes never select a different file.
- `mxbm://install/hub/123` opens MXB Hub and its product popup.
- `mxbm://install/mxbs/123` opens MX Bikes Shop and its product popup.
- `mxbm://oem/mx` opens and installs or updates the MX OEM pack. Also supported: `enduro`, `sm`, `freeride`.
- `mxbm://join/1.2.3.4:54210` asks to join that server.

Free mods combines CoreMX community uploads with MXB Mods listings. The Upload mod button opens `https://coremx.app/#/new`. Community downloads use the CoreMX `/dl/local-<id>` route and the usual install review.

Links are queued until app startup finishes. Purchase/login, dependency checks and install reviews still use the normal app flows. Finish first-run setup before installing through a website link.

### Upgrading from MX Bikes Manager

CoreMX keeps the original Windows application ID, internal package ID, `mxbm://` protocol, data directory and disabled-mod folder so upgrades preserve user data and installed files. The Windows display name, executable, shortcuts and primary setup filename are CoreMX.

Versions through 1.0.27 still check Google Drive. To deliver the first GitHub-updater release to them automatically, upload that release's `latest.yml` and matching **CoreMX-Setup-…-x64.exe** to the shared Drive folder once. The 1.0.27 updater accepts the CoreMX filename. After they install it, updates come from GitHub. Users on much older builds may need to run the CoreMX installer manually.

## Licence

CoreMX is released under the [MIT License](LICENSE). Bundled third-party code and programs keep their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
