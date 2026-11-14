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
