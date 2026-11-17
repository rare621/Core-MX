# CoreMX online service

Powers **Live servers** (every server an app user rides on, with its track and riders) and **Friends**
(where your friends are riding, one-click join). One file, no dependencies, needs Node.js 18+.

## Set up on the server PC

1. Install **Node.js** (the LTS version) from https://nodejs.org if it isn't installed.
2. Unzip this folder anywhere (for example `C:\mxbm-online`).
3. Right-click **open-firewall.cmd** â†’ **Run as administrator** (opens TCP port 60000 in Windows Firewall).
4. On your router, forward **TCP 60000** to this PC. Giving this PC a fixed local IP in the router helps, so the forward keeps working.
5. Double-click **start-server.cmd** and leave the window open. Close it to stop the service.

State is saved next to the script (`mxbm-data.json`, plus paint files in `mxbm-files\`), so it survives restarts.
On first start, the server also creates `admin.key` next to `mxbm-data.json`. Keep it private and back it up; it is needed to unlock the Admin tab in the app. You can alternatively supply `MXBM_ADMIN_KEY` as a server environment variable.
Run it by hand with `node mxbm-server.js --port 60000` if you prefer; `--data <file>` and `--maxstore <MB>` change where data lives and the paint storage cap (default 4096 MB).

## Update an existing server

Stop the server window, then copy **mxbm-server.js** and **cache-cleanup.js** from the new release ZIP into your existing server folder. Start **start-server.cmd** again. Keep **mxbm-data.json**, **admin.key** (if present), and **mxbm-files** where they are: those contain the accounts, admin credential, and shared files. No account reset or port-forwarding change is needed.

## Announcements

The Admin settings tab appears only when Steam is signed in as `76561198098586128`. To publish, enter the key from `admin.key` on the server PC. The service also verifies the registered account token and the key; a changed local app cannot grant itself admin access. The key stays in app memory for that session and is never included in a release.

Publishing adds an announcement to each registered account's inbox. The app checks while open, shows a new announcement once as a popup, and keeps it in Notifications until that person deletes it. Accounts registered later also see recent announcements. The Admin tab reports the number of accounts currently registered with the online service, not a lifetime total after account deletion.

The server checks its cache every 30 seconds. Files no longer referenced by any shared outfit are deleted after two minutes unused. This also clears old unused files after an upgrade. A file stays while any rider still shares it, including offline riders, and active downloads are protected. Turning outfit sharing off or unregistering releases that user's references. Only hash-named server cache files are removed; accounts and installed mods on players' PCs are untouched. Deleted cache copies can be uploaded again from a rider's installed files.

The health page reports the service version. Announcement delivery and notification deletion require version 9 or later.

Signed-in riders have separate request allowances, including when they share one public IP. A busy service returns a `Retry-After` delay; the manager pauses requests and retries later instead of repeatedly refreshing. Anonymous requests remain limited by address.

## Connecting the app

The official CoreMX app connects to **https://coremx.app**. The website forwards `/v1/` to the existing sync server on localhost port 60000 through its Cloudflare-proxied HTTPS address.

Check `https://coremx.app/v1/health`; it must return JSON with `ok: true`. Existing user IDs and tokens migrate through the known aliases in `online.config.json`; the app does not use those aliases as network fallbacks.

For deployment instructions, verification, and Cloudflare upload limits, see [Online HTTPS](../docs/online-https.md). Keep existing direct access until older clients have migrated, and leave shared website/game-server port forwards alone.

## How it works

- The game plugin (`plugin/mxbm_presence.dlo`, installed from the app) writes the server name, track and
  rider list to `Documents\PiBoSo\MX Bikes\mxbm_presence.json`. The app reports that here every 30 s while the game is open.
- A server stays on the list for 20 minutes after anyone last reported it.
- Join addresses: the game doesn't tell plugins a server's IP, so a server becomes joinable from the list
  once an app user has joined it through the app.
- Friends see each other only when both have added each other. "Let friends see which server I'm on" off
  hides you from friends but still updates the server's track.
- Accounts are Steam IDs claimed first-come. If someone needs a reset, stop the service and delete their
  entry under `users` in `mxbm-data.json`.
- The manager sends a heartbeat while it is open, including when MX Bikes is closed. Presence distinguishes an active manager from a running game and a riding session.
- Only the active outfit is shared: the selected gear models, their selected paints, and the current bike livery. Model packages omit unused paint variants. Original paint files remain intact. Each file is content-checked, and recipients keep different existing files instead of silently replacing them.
