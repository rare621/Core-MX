# Presence plugin session reporting, 2026-11-14

Investigated friends remaining at “In MX Bikes” instead of receiving a session/server name.

Queries: `site:mx-bikes.com output plugin EventInit GetModDataVersion interface 9`, `site:docs.piboso.com MX Bikes plugins EventInit RaceEvent`, `"m_szServerName" "SPluginsBikeEvent_t"`, `"MX Bikes" "Startup" "-1" plugin`. The local Universal Modder knowledge base had no MX Bikes entry.

Primary sources: [PiBoSo output-plugin announcement](https://forum.mx-bikes.com/index.php?topic=96.0), [official downloads](https://www.mx-bikes.com/?page=downloads), and [official output example](https://www.mx-bikes.com/downloads/mxb_example.c). The example declares data version 8/interface 9, documents Startup `-1` as disabled and `3` as 10 Hz, and exposes separate RaceEvent and EventInit callbacks. Its published bike-event definition lacks the newer optional server-name fields, so the plugin retains packet-size checks for those fields rather than requiring them.

The existing plugin returned `-1`. Rebuilt it with return value 3 and a no-op telemetry callback. RaceEvent now sets session presence independently of EventInit; teardown and loaded replays clear live presence. Optional server-name data no longer requires a GUID to be present.

Verification: loaded the actual rebuilt Windows DLO using Python ctypes; exercised Startup, RaceEvent, EventInit with full/partial/older packets, RaceDeinit, EventDeinit, replay, and Shutdown. Separately tested plugin-file upgrades with the game closed, blocked updates with it open, immediate client presence changes, and a two-client service session update. These checks do not establish a live join between two real game clients. No game screenshot or live server-session verification was captured.

## Rider folder routing correction

The earlier manager incorrectly assumed every gear category belonged under a rider body. Verified the installed stock `rider.pkz` directly: model configuration entries are at `rider/helmets/default/gfx.cfg`, `rider/boots/default/gfx.cfg`, `rider/protections/full/gfx.cfg` and `rider/protections/neck/gfx.cfg`; body models, kits and glove paints are under `rider/riders/default_mx/`. This local shipped archive is the primary evidence. It agrees with the [helmet creator's installation instructions](https://mxb-mods.com/default-helmet-replacement-mod/) and the [glove creator's instructions](https://mxb-mods.com/swedish-gloves/). The user's supplied third-party explanation was correct about accessories but incorrectly placed gloves at the shared root.

Research queries included `site.docs.piboso.com MX Bikes mods rider helmets riders default_mx`, `site.forum.mx-bikes.com mods rider riders default_mx helmets folder`, and `site.mx-bikes.com "kit and gloves" "rider"`. Changed installation, catalog/preview lookup, sync destinations, equip detection, scanner labels and maintenance together. Removed the inference that shared accessory folders were obsolete. Repair merges unique files, recycles byte-identical extra copies and leaves conflicts untouched. No automatic restoration of intentionally disabled mods is performed.

With both the game and manager closed and the user's authorization, repaired six local accessory folders: 1,033 file mappings, one identical copy recycled, zero conflicts and zero remaining misplaced accessory folders. Updated install/sync/image records and retained a local metadata backup beside AppData data.json. The local catalog then found 33 helmets; the selected helmet's model preview loaded without unreadable parts. This is asset-reader verification, not a live in-game screenshot. Synthetic repair tests exercise collision preservation and repeated repair. The hidden Settings UI capture was read back to verify the maintenance-tab placement.

## Preview responsiveness and bike-specific tyres

Corrected a renderer request that keyed itself on draft values but fetched the saved loadout without passing those draft values. Added stale-response guards to loadout reads as well as model reads. Decode/build work now runs in separate Node worker lanes for the foreground preview and thumbnail preparation; thumbnail GPU rendering runs in a browser worker with OffscreenCanvas. The full preview pauses when hidden or covered by a modal. Verified a packaged app.asar build: its draft helmet mesh changed while the saved profile stayed unchanged, and its thumbnail worker returned a WebP. Hidden-window checks also confirmed UI timers ran during rendering. These checks do not establish that every reported intermittent interaction stall had the same cause.

Read the installed KX250 graphics and physics configuration. Both declare oem_mx; unrelated installed pit-bike and supermoto folders do not establish availability for that bike. Tyre options now follow declared references, incompatible previous selections are ignored for previews/sync and cleared on Apply. No bike physics files were modified.

## Separate website instructions

The [I <3 MY GF/BF HOODIES listing](https://mxb-mods.com/i-3-my-gf-bf-hoodies-2/) has an empty WordPress API description, while its rendered `#instructions` field specifies the ABDesigns hoodie requirement. That omission caused the missing paint-only warning. Parse this separate field for full details and bounded rider-kit listing enrichment, caching only metadata in memory. The live listing now yields paint-only, a required-model warning, two downloads and the ABDesigns model-page link. Standard rider kits, bike liveries and gloves remain in MXB Mods. Cursor tests verify that filtering does not skip matching rows between pages.

## 2026-11-14: installed ABDesigns hoodie

- The installed `Rider Hoodie-ABDesigns.pkz` has a nonzero KCOL binding marker. The previous reader rejected it before attempting its directory.
- In a read-only local preview, the existing container decoder successfully verified the directory checksum and each asset CRC without additional keys. The archive contains `gfx.cfg`, `rider.hrc`, and `rider.edf` under its named root.
- The hoodie body uses `abhoodie`, `rider`, `gloves`, and `face_parts` textures. The user's Dropsize paint applied to `abhoodie` and `rider`, with no missing-texture warnings.
- The hoodie flattens several independent objects into one mesh. Applying the first object's transform to every sibling lays the body sideways. The existing bounds-based transform selection reproduces the EDF's recorded bounds (within float precision); the stock rider is unchanged. Enabled this selection for rider bodies and visually checked the upright hoodie with its Dropsize paint.
- Only preview workers opt into this read path. Archive caches are separated by read mode; ordinary sync/export readers retain their existing restriction. No decoded package files or purchased assets are distributed with the app.
- This confirms this package format, not support for every encrypted or owner-specific package.

## 2026-11-14: automatic server address export

- The official presence callback reports server name and session stage, but no address. Match names only against saved or freshly observed addresses; reject ambiguous matches.
- The installed official FrostMod 0.52.0 logged server-browser rows but produced no masterlist. At upstream commit `fe1614ddbc294faba93e914697ae98bd89f494db`, `MasterListPublish` and the decoder existed but the browser callback called neither. Another manual Refresh could not fix this.
- `plugin/frostmod/automatic-discovery.patch` connects the bounded row decoder to a background atomic writer. Opening Multiplayer should suffice. One replaceable list is cleared at startup and normal shutdown; the app clears expired/interrupted discovery outputs and clears all discovery lists after game exit. No user settings or mods are cleanup targets.
- Built the explicitly labeled `0.52.0-mxbm.1` using Zig 0.17.1 and pinned MinHook 1.3.4. The upstream decoder tests and 103 app tests passed. A hidden Electron check verified Settings → Plugins and the address dialog, including its Close button. Installed the binary only after confirming MX Bikes was closed. Actual game/browser verification is pending the user's restart.
- The service now drops an address when the reporting client no longer supplies it, rather than retaining expired discovery indefinitely. Session-stage transport and clearing are covered by two real clients against the local service fixture.

### Live verification and batch retention

- Opening Multiplayer without Refresh produced real public IPv4/port entries. Closing the game removed the masterlist without app cleanup.
- The browser callback restarts its row index for small batches; treating each reset as the whole list lost earlier entries. `0.52.0-mxbm.2` accumulates observations in a bounded map, updates duplicate addresses, expires each observation individually after six hours, and evicts the oldest at capacity. The native cache test verifies these cases.
- After installing this fix with the game closed, opening Multiplayer automatically accumulated 547 addresses. The presence packet's current CBRSERVERS Motopark server matched one captured public IP/port exactly, and session 5 reported Warmup. No manual browser Refresh was used. Friend presence transport is covered by the local two-client integration test; a second real player's direct connection was not exercised here.
