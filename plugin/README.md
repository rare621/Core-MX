# Game plugin

`mxbm_presence.c` is a plugin for MX Bikes' official plugin interface (interface 9, data 8). It only
listens: it writes the session (server name, track, your bike, the rider list) to
`Documents\PiBoSo\MX Bikes\mxbm_presence.json` for the app. No drawing, no game changes, no network.

Build a 64-bit DLL named `mxbm_presence.dlo` next to this file, then install it from the app
(Online → Servers → Install), which copies it to `<MX Bikes>\plugins\`:

```
zig cc -target x86_64-windows-gnu -shared -O2 -o mxbm_presence.dlo mxbm_presence.c
```
(or `x86_64-w64-mingw32-gcc -shared -O2 -s -o mxbm_presence.dlo mxbm_presence.c`)

`Startup` must return `3` (10 Hz), not `-1`, which disables the plugin. The telemetry callback is a no-op; only session/rider events write the status file. Race events also report a session before the local bike goes on track. Server fields are optional and checked independently against the packet size.

On app upgrades, an existing outdated plugin is replaced when MX Bikes is closed. If the game is running, Online shows **Update plugin** and asks you to close and restart the game. Installing a plugin while the game is already open cannot activate it for that session.

The Windows test suite uses Python 3's standard `ctypes` module to load the bundled DLO and exercise its exported callbacks in a temporary folder. No game install or running game is needed for that check.
