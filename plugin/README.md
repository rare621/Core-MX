# Game plugin

`mxbm_presence.c` is the CoreMX game plugin, `mxbm_presence.dlo`. It is optional. The app installs it
only when you choose **Install** (Online → Servers), copying it to `<MX Bikes>\plugins\`, and
**Remove plugin** or uninstalling CoreMX takes it out again. MX Bikes loads it through PiBoSo's
official plugin interface (interface 9, data 8).

## What it does

It does more than listen. This is everything it does, with where to find it in `mxbm_presence.c`.

**Reports your session to the app.** It writes what the game reports through the plugin interface
(server name, track, your bike, race number and the server's rider list) to
`Documents\PiBoSo\MX Bikes\mxbm_presence.json`. The app reads that file, and, when you are online,
reports it to the CoreMX service.

**Changes the game, on your screen only, while it runs.**
- It swaps one game UI function pointer for its own small function, which runs the plugin's work on
  the game's thread (`hookStart`). It swaps the game's `recvfrom` import for its own, which picks
  out the STUN replies below from the game's network traffic (`stunStart`). Both happen only when 43
  bytes of the game match the build the plugin knows. Otherwise the plugin pauses itself, and says so
  in `mxbm_hook.json`.
- **Live looks:** it writes other CoreMX riders' gear names into their vehicle records and has the
  game repaint or rebuild them. It also calls the game's own model builder to rebuild your rider after
  you change gear in the overlay. Only your own screen changes; nothing is sent to the server.
- These run on online servers too.

**Reads the game's memory.** It reads the server name and address, your race number, and the game's
server list (`mxbm_servers.txt`, so the app knows each server's real address).

**Uses the network.** Every 2 minutes in a session, it sends a STUN request to
`stun.cloudflare.com:3478` from the game's own socket, to learn the public address and port other
players reach you on (`mxbm_stun.json`). This is how hosting and joining work through routers.

**Draws an overlay.** Press F8 (you can change the key) for the CoreMX overlay: your gear, the riders
on your server and their gear. It draws through the plugin interface. It reads keys only while the
game window is in front, and frees the mouse from the game window while the overlay is open; the
game still gets your keys. It uses the game's font, `ui\main.fnt`, copied to `plugins\mxbm_data\`.

**Handles its own crashes.** It adds an exception handler for the whole game that acts only on a
crash inside the plugin: it switches the plugin's hooks off and lets the game carry on.

**Files it writes** (in `Documents\PiBoSo\MX Bikes`): `mxbm_presence.json`, `mxbm_hook.json`,
`mxbm_servers.txt`, `mxbm_stun.json`, `mxbm_public.json`, `mxbm_missing.json`,
`mxbm_looks_result.json` and `mxbm_overlay_save.json`. It reads `mxbm_looks.txt`, `mxbm_synced.txt`
and `mxbm_overlay_key.txt`, which the app writes. Any program on your PC can read these files.

It injects nothing into the game from another program, starts nothing next to the game, and doesn't
get around any of the game's checks.

## Building

The released `mxbm_presence.dlo` is built with Microsoft's compiler:

```
cl /LD /O2 mxbm_presence.c /Fe:mxbm_presence.dlo
```

It also builds with `zig cc -target x86_64-windows-gnu -shared -O2 -o mxbm_presence.dlo mxbm_presence.c`
or `x86_64-w64-mingw32-gcc -shared -O2 -s -o mxbm_presence.dlo mxbm_presence.c`. Those builds work
the same but are not byte-for-byte identical to the released file.

`Startup` must return `3` (10 Hz), not `-1`, which disables the plugin.

On app upgrades, an existing outdated plugin is replaced when MX Bikes is closed. If the game is
running, Online shows **Update plugin** and asks you to close and restart the game. Installing a
plugin while the game is already open cannot activate it for that session.

The Windows test suite uses Python 3's standard `ctypes` module to load the bundled DLO and exercise
its exported callbacks in a temporary folder. No game install or running game is needed for that
check.
