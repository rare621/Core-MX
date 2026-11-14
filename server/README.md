# MX Bikes Manager online service

Powers **Live servers** (every server an app user rides on, with its track and riders) and **Friends**
(where your friends are riding, one-click join). One file, no dependencies, needs Node.js 18+.

## Set up on the server PC

1. Install **Node.js** (the LTS version) from https://nodejs.org if it isn't installed.
2. Unzip this folder anywhere (for example `C:\mxbm-online`).
3. Right-click **open-firewall.cmd** → **Run as administrator** (opens TCP port 60000 in Windows Firewall).
4. On your router, forward **TCP 60000** to this PC. Giving this PC a fixed local IP in the router helps, so the forward keeps working.
5. Double-click **start-server.cmd** and leave the window open. Close it to stop the service.

State is saved next to the script (`mxbm-data.json`, plus paint files in `mxbm-files\`), so it survives restarts.
Run it by hand with `node mxbm-server.js --port 60000` if you prefer; `--data <file>` and `--maxstore <MB>` change where data lives and the paint storage cap (default 4096 MB).

## Connecting the app

In the app's `online.config.json` put `{ "serviceUrl": "http://<server PC public IP>:60000" }` — every copy of the app
then connects automatically with the user's Steam account. On the server PC itself `http://127.0.0.1:60000` works.
Check it from another PC by opening `http://<ip>:60000/v1/health` in a browser — it should show `"ok":true`.

Plain HTTP is fine for a group of friends, but the sign-in token travels unencrypted. For anything wider,
put it behind HTTPS (for example a Cloudflare Tunnel or a reverse proxy) and give people the `https://` address.

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
