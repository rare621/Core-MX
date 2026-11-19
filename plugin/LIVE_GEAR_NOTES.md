# Live liveries and rider gear — research notes

Goal: while in a server, CoreMX downloads the free liveries and gear of other CoreMX users on that
server; the plugin makes the game pick up the new files without a restart. Liveries (paints) apply
right away, even on track; rider gear models (helmet, boots, rider, protection) apply when you go
to the pits and back out (the game builds riders only in the pits).

Our own reverse-engineering of the Steam build of 2026-11-15 (`mxbikes.exe`, base 0x140000000,
RVAs below). Code read from the running game (`.text` is SteamStub-encrypted on disk).

## 1. Content lists and their loaders

MX Bikes scans the content folders once, in its start-up routine (RVA 0xEF210). Each content type
is one block in that routine:

```
mov [countA], 0 ; mov [countB], 0 ; mov [listPtr], 0     (edi = 0)
call loader(rcx = game folder)                            (r13)
if (byte [0xE54B44] != 0) call loader(rcx = &modsFolder)  (0xE54B44 = mods folder string)
```

| loader   | content                     | zeroed before (countA, countB, list ptr) |
|----------|-----------------------------|------------------------------------------|
| 0x17320  | bike paints                 | 0x109DE88, 0xF3DC40, 0xF4EDF8            |
| 0x17950  | fonts                       | 0xF3DB9C, 0xF3DC9C, 0xF4EDA0             |
| 0x17F80  | helmets (self-contained: calls 0x17BD0 twice) | —                      |
| 0x18360  | helmet paints               | 0xF48620, 0xF3DB64, 0x109E090            |
| 0x189C0  | goggles paints              | 0x10A30F4, 0xF4EDDC, 0xF3DC28            |
| 0x19060  | helmet cams                 | 0xF4EE00, 0x109DE90, 0xF48610            |
| 0x1BDD0  | rider models (self-contained: calls 0x1B960 twice) | —                 |
| 0x19330  | suit (rider) paints         | 0xF3DB50, 0x109DEA8, 0xF3DC90            |
| 0x1AE10  | rider fonts                 | 0x109DEA4, 0xF3DC8C, 0xF48658            |
| 0x1B420, 0x19DA0 | animations?, boots (0x19DA0 calls 0x199D0 twice) | —            |
| 0x1A110  | boots paints                | 0xF48660, 0xF4EDE0, 0xF432A0             |
| 0x1A770  | gloves paints               | 0xF3DC58, 0xF432B4, 0xF48208             |
| 0x1C140  | protections                 | 0x106BB28, 0x109DEB0, 0xF432A8           |
| 0x1C450  | protection paints           | 0xF432C0, 0xF48608, 0xF4EDD0             |

(Mapping by the folder strings each loader formats; the self-contained wrappers and the
animations/boots rows still need a closer look.) Bike paint list: count 0x109DE88, pointer
0xF4EDF8, stride 0x18C, +0x04 bike folder, +0x88 paint name.

## 2. Building a rider's look — by name

RVA 0x4D8C0 builds a vehicle's look: `rcx` = the object, `edx` = bike index (bike list 0xF4EDE8,
stride 0x4334, +0x4C0 bike cfg name), then the bike paint name and, on the stack, the names of the
helmet, goggles, suit, boots, gloves, protection and their paints. It finds each paint in the lists
above by name (`_stricmp` loop), and RVA 0x4CE00 (called from it) loads the rider/helmet/boots
`.pnt` files. Because selection travels by name, reloading a list and rebuilding picks up a newly
downloaded file.

Callers of 0x4D8C0: 0x5CC5B, 0x5E744, 0x6E22F (sibling 0x4DC50 is called next to it each time).
In 0x5E744 the names come from a per-rider record (`r15`): bike paint +0x90, +0xB0, +0x150,
+0x170, +0x190, +0x1F0, +0x210, +0x230, object at +0x274 — likely the game's entry for each player
on the server. To confirm in a live server session.

## 3. Vehicle records (confirmed live, server "67", Farm14, 4 riders)

Static array at RVA 0xF4EE20, stride 0x5B24, one record per vehicle on the server. Own vehicle:
int at RVA 0xE62710 = index + 1. 0x5E744 builds every vehicle from its record
(`r15 = 0xF4EE20 + i * 0x5B24`).

| offset | field (32-byte strings unless noted) |
|--------|---------------------------------------|
| +0x00  | int, 1 = slot in use                  |
| +0x0C  | int, race number                      |
| +0x10  | name (often empty; "Mmax" seen)       |
| +0x30  | bike id                               |
| +0x70  | tyres? ("oem_mx")                     |
| +0x90  | bike paint                            |
| +0xD0  | rider model                           |
| +0xF0  | helmet                                |
| +0x110 | helmet paint                          |
| +0x130 | goggles paint                         |
| +0x150 | helmet cam                            |
| +0x170 | suit paint                            |
| +0x190 | suit font                             |
| +0x1B0 | boots                                 |
| +0x1D0 | boots paint                           |
| +0x1F0 | gloves paint                          |
| +0x210 | protection                            |
| +0x230 | protection paint                      |
| +0x274 | int, the 3D object's id (small numbers, e.g. 0x35, 0x4E, 0x5F, 0x70) |
| +0x4EE8| int, build state                      |

The same layout (minus the vehicle part) is the local selection at RVA 0xE4BA7C.

Note: the presence plugin's rider list (RaceAddEntry) only had the local rider in this practice
session; the vehicle array had all four.

## 4. Pits vs riding

The PiBoSo plugin interface has RunInit / RunDeinit (leaving the pits / back in the pits) and
RunStart / RunStop; the presence plugin does not export them yet. No reverse-engineering needed.

## 5. Pit-out / pit-in does not rebuild riders

Test: rode out and back to the pits. Every vehicle kept the same object id (+0x274: 0x35, 0x4E,
0x5F, 0x70) and nothing else in the records changed. So the game does not rebuild other riders
when you (or they) go through the pits; it builds a rider when they join. To show new gear the
plugin has to rebuild a rider itself (free its objects, call the builder), and only while you are
in the pits (the game holds off building while you ride).

## 6a. CONFIRMED: live bike livery swap (2026-11-18, offline Testing, KX250 2023)

The plugin test (`mxbm_test_livery.txt` → `mxbm_test_result.json`) formatted
`<root>bikes\<bike>\paints\<livery>.pnt` (root = livery entry +0x88) and sent engine command 0x9E
through the game's UI pointer to each bike part model: record + 0x274 + {0x00, 0x10, 0x14, 0x50,
0x60, 0x70} (ids 37, 38, 39, 44, 45, 46 in the test). The bike changed from Teal to "retro" on
screen, in the pits, with no rebuild and no crash. Run on the game's main thread from the UI stub.

The first attempt used 0x4DC50 with record + 0x5B0C: that id is the **pit stand** (built by
RVA 0x455C0 from `misc\stand\gfx.cfg`, which also takes the bike livery), so the stand was
repainted instead of the bike.

Rider part ids in the same block (from 0x4CE00): gloves +0x1D4, goggles +0x1E0; ids 47–55 sit at
+0x1D4..+0x214 in the test. Suit, helmet and boots still to map.

## 6b. CONFIRMED: live rider paints, outside view (2026-11-18, offline Testing, on track)

Same engine command 0x9E, one per rider model (all in the block at record + 0x274):

| model        | block offset   | paint text sent                                              |
|--------------|----------------|--------------------------------------------------------------|
| rider body   | +0x1D4         | `<root>rider\riders\<rider>\paints\<suit>.pnt` `|` `<root>rider\riders\<rider>\gloves\<gloves>.pnt` |
| boots (L, R) | +0x1D8, +0x1DC | `<root>rider\boots\<boots>\paints\<paint>.pnt`               |
| helmet       | +0x1E0         | `<root>rider\helmets\<helmet>\paints\<paint>.pnt` `|` `<root>rider\helmets\<helmet>\goggles\<goggles>.pnt` |

(Separator `|` is the word at RVA 0x337CB0.) Lists: rider models 0xF3DC68 (count 0xF3DC60, stride
0x1224); boots models 0xF4EDB0 (count 0xF3DB58, stride 0x208); helmets 0xF3DC70 (count 0xF3DC64,
stride 0x268); paints (stride 0x18C, +0x00 owner index, +0x04 name, +0x88 root): suit 0xF3DC90
(count 0xF3DB50), gloves 0xF48208 (0xF3DC58), boots 0xF432A0 (0xF48660), helmet 0x109E090
(0xF48620), goggles 0xF3DC28 (0x10A30F4).

Result: suit, gloves, boots, helmet and goggles all turned red in the external and replay cameras
while on track; the change survived riding out of the pits. First person still showed the old gear.

**First person:** your own vehicle is built twice by RVA 0x45020: the second call to RVA 0x419C0
passes the block + 0x3C4 with the prefix `cockpit/`. That second set holds the first-person model
ids, confirmed in game on track in first person (bike 52, 53, 54, 55 at +0x3C4 + {0x00, 0x10, 0x50, 0x60}; body 56, boots 57/58,
helmet 59 at +0x3C4 + {0x1D4, 0x1D8, 0x1DC, 0x1E0}). With both sets painted, the livery and every
rider paint changed in first person and in the outside cameras, on track (2026-11-18).

In RVA 0x4CE00, `[block + 0x1D0] == 0` means the rider has no model yet: the game then builds it
(0x3F070, model + paints); otherwise it only repaints (the path the plugin copies).

## 6. Re-applying a bike livery without rebuilding (first idea, superseded by 6a)

RVA 0x4DC50 `(int bikeIndex, const char *paintName, int *bikeObject)`: finds `paintName` for that
bike in the bike-paint list (0xF4EDF8, by `_stricmp` on +0x04), formats
`%sbikes\%s\paints\%s.pnt`, and sends engine command 0x9E through the dispatcher at RVA 0x566C48:
`dispatch(0x9E, *bikeObject, path)` — put this paint on this existing model. No model is created.
The vehicle setup in 0x5E744 calls it as `0x4DC50(bikeIndex, rec + 0x90, rec + 0x5B0C)`, so the
bike's model id is at record +0x5B0C (+0x5B14 is a state the same code sets to 0 or 2).

Plan for liveries: after CoreMX downloads a bike paint, (1) re-run the bike-paint list loader
(block in §1), (2) for each vehicle whose `rec+0x90` names that paint, call 0x4DC50 with its bike
index (bike id at rec+0x30 looked up in the bike list 0xF4EDE8, stride 0x4334, +0x00) — on the
game's own thread (a plugin callback), never from a background thread.

## 7. Rider gear paints

RVA 0x4CE00 applies every paint of a freshly built vehicle (the builder 0x4D8C0 is its only
caller). It is not paint-only: its helpers 0x3E460 (helmet cam) and 0x3E6E0 (protection) send
engine commands 0x2C / 0x2D that load models (`gfx.cfg`, `%smodel`), so re-running it on a built
rider could duplicate parts. Inside it, paints go out as `dispatch(0x9E, objectId, path)`; gloves
use object id at block+0x1D4 and goggles block+0x1E0 (block = the object-id block it is given).
Suit, helmet and boots paths are formatted (`%srider\riders\%s\paints\%s.pnt`,
`%srider\helmets\%s\paints\%s.pnt`, `%srider\boots\%s\paints\%s.pnt`); which object ids they go
to is still to map. Plan: send 0x9E ourselves per part, once the ids are mapped.

## 8. Gear model swaps (in progress)

- RVA 0x4CE00 checks `[block + 0x1D0]`: 0 means the rider has no model yet, and it builds one
  through RVA 0x3F070 (chunk 0x3F225), which sets `[block + 0x1D0] = 1` at the end. Non-zero means
  the rider exists, and it only repaints (§6b).
- Engine commands seen while building: 0x2C (open a `gfx.cfg`), 0x2D (load a model part), 0x51
  (create the rider model, id written to block + 0x1D4), 0x52 / 0x53 / 0x55 (create further models,
  ids written to the given slot, e.g. 0x53 → block + 0x1E0 helmet), 0x82 / 0x87 (bone setup),
  0x2E / 0x30 (close the cfg).
- 0x44950 / 0x44AA0 / 0x44C10 / 0x44D90 / 0x44EC0 / 0x4DE80 and 0x4DD80 send one command (0x5C,
  0x5D, 0x5E, 0x5F, 0x60 with a value) to every model of a vehicle: visibility / state flags, not
  deletion. 0x4E090 calls 0x4DE80 for both model sets.
- Plugin exports are looked up at RVA 0x12A5DA (EventInit → plugin+0x20, EventDeinit +0x28,
  RunDeinit +0x38, …); following the EventDeinit call should lead to the session-end teardown,
  which removes every vehicle's models (FrostMod's changelog says it removes riders "the way the
  game removes them at session end" — to be found and verified here independently).

## 9. Engine commands, delete, and the game's own rebuild (found 2026-11-18)

- The UI/engine pointer (RVA 0x566C48 → RVA 0x120CC0) is one switch over command ids 0..0x3CA;
  jump table at RVA 0x1280B0 (int32 offsets from the image base). Command → handler, for example:
  0x2C → 0x1569F0, 0x2D → 0x156EB0, 0x51 → 0x226910, 0x52 → 0x226860, 0x53 → 0x226C10,
  0x55 → 0x2198F0, 0x5C → 0x219590, 0x9E → 0x2190D0, 0x3B0 → 0x12AA80 (calls every plugin's
  EventDeinit). Plugins: array pointer RVA 0x565CC0, count RVA 0x565CB8, stride 0x118
  (EventInit +0x20, EventDeinit +0x28).
- **0x5C deletes a model.** The create handler 0x226860 (command 0x52) calls the 0x5C handler
  0x219590 to clean up when creating fails; 0x219590 is the only user of the object manager's
  remove helper 0x15C3F0 (object manager at RVA 0x584870).
- **RVA 0x44950(block)** sends 0x5C to every model of one model set: bike parts (+0x00 … +0x70)
  and rider parts (+0x1D4, +0x1D8, +0x1DC, +0x1E0, +0x1E4, +0x1F4, +0x1F8).
- **RVA 0x4E0D0(block = record + 0x274)** removes a vehicle's whole look: extra models
  (+0x4C54 … +0x4C70, 0x5C), the first-person set (block + 0x3C4) and the outside set (0x44950),
  plus other resources (+0x780 … +0x78C). Ten callers, including session-end paths.
- **The game rebuilds by itself.** Vehicle build state at record + 0x4EE8: 0 = built, 2 / 3 =
  build pending (set by the vehicle setup 0x5E744 when a build is postponed, e.g. while riding).
  RVA 0x6E22F walks all 50 slots (r12 = 0xF53D08 + i * 0x5B24 = &state): for a slot in use with
  state ≠ 0 it builds; with state 2 it first calls 0x4E0D0(record + 0x274) and then the builder
  0x4D8C0 with the names from the record (rider model, helmet, boots resolved through 0x1C000,
  0x18220, 0x19FD0 with defaults for missing ones). 0x6E22F is reached from the page callback
  dispatcher 0x275A0 (via 0x6E1D0), i.e. it runs for some game screen, likely the pits.

**Rebuild plan (to test):** on the game's thread, while in the pits, write the new gear names into
another rider's record (helmet +0xF0, boots +0x1B0, rider +0xD0 and their paints), set its
state +0x4EE8 = 2, and let the game remove and rebuild it. Nothing is sent; it only changes what
your game draws.

## 9a. CONFIRMED: live gear model swap on another rider (2026-11-18, server "Balls", 42 riders)

The plugin test wrote helmet `2021_6D_ATR-2_ARMEGA` / paint `6datr2 FXR whiteblue` into rider
#526's record (+0xF0, +0x110) and set its state +0x4EE8 = 2 while we sat in the pits. The game
picked it up within 3 seconds (state back to 0) and #526 was seen riding on track with a 6D
helmet instead of their Alpinestars SM10. No crash. Their own goggles (+0x130) stayed.
The paint looked white/grey rather than clearly white/blue: either that is the paint, or the game
used the helmet's default paint; check when building the real feature (the resolver 0x18220 can
clear the paints).

So 0x6E22F runs while we are in the pits, and a rebuild does not need the rider to pit.

## Still to find

- Whether the rebuild also runs while *we* ride (FrostMod's notes say rider builds are postponed
  while riding; the vehicle setup sets state 2/3 in that case).
- Whether the own vehicle uses the same path (it is built with the first-person set via 0x45020).
- The helmet paint question above.
- A paint-only re-apply that works while riding (or how to rebuild safely).
- What else holds list indexes that a reload would invalidate (menu choosers).
- Where player names live when +0x10 is empty.

## 10. Your own rider: rebuild with the first-person set (2026-11-18)

First attempt: remove the look (0x4E0D0) and set build state 3. The game's loop then calls the full
builder RVA 0x45020 with **flags 4** (stack argument at caller rsp+0xA0; `test bl,4` at 0x45412
skips the first-person build and the `+0x3BC = 1` flag at 0x45529). Result: new helmet visible in
third person, but first person broken (outside helmet shell and protector chain in view, second
first-person camera behind the neck): the per-frame camera code (around RVA 0x5934D) only hides the
outside set (0x44D90 → command 0x5E per part) and poses the first-person set when +0x3BC is set.

Flags per caller of 0x45020: network setup 0x5CC5B / 0x5E744, rebuild loop 0x6E22F, 0xBC076 → 4;
0x1FD74, 0x2016E, 0xE4BD9 → 5; replay/menu 0xE87B1 → 0x2D; **your own vehicle's setup 0x66A27
(call at 0x66F74) → 0**.

0x45020 arguments (rcx, edx, r8d, r9, then stack +0x20 … +0xA0): block (record + 0x274), bike
index, tyre index (record +0x70 name in the tyre list: pointer 0xF48618, stride 0x608, count
0x109DECC), bike paint +0x90, +0xB0, rider +0xD0, helmet +0xF0, helmet paint +0x110, goggles +0x130,
helmet cam +0x150, suit +0x170, suit font +0x190, boots +0x1B0, boots paint +0x1D0, gloves +0x1F0,
protection +0x210, protection paint +0x230, +0x250 (resolved by 0x1B650), race number as text,
name +0x10, flags. (0x66A27 resolves rider, helmet, boots and +0x250 through 0x1C000, 0x18220,
0x19FD0, 0x1B650 first, which swap in defaults for missing ones; the overlay only offers installed
models.)

Second attempt (current): in the pits, 0x4E0D0 then 0x45020 called directly with flags 0 and the
record's names; build state left at 0. **Confirmed in game (offline Testing): new helmet shown
after a pits visit, both first-person cameras and the external view correct, no crash.**

## 11. Changing bike on a server (research, 2026-11-18)

The game has its own bike change on a server; it is not shown unless needed.

- Network messages (names in a table for logging, RVA 0x3310F4 …): `CHANGE`, `CHANGEINFO`,
  `CHANGEREQUEST`, `CHANGEANSWER`, `CHANGECOMPLETE`. Server settings include `allowed_bikes` and a
  category (`CC_wrongcategory`, `cc_classmismatch`, `cc_missingclass`).
- Pages (registered with engine command 0x104): `idd_multi_pit` → handler RVA 0xB98D0 (the
  multiplayer pits page), `idd_bikechoose` / `idd_bikechoose2` → handler RVA 0x91570 (the bike
  chooser). Pages are opened with RVA 0xEC330(path, mode), e.g. `chat/pit/settings`,
  `chat/pit/setup` (ID_GARAGE), `chat/replay`, `mtrackm` (ID_TOTRACK).
- **ID_JOIN on the multiplayer pits page** (around RVA 0xBA93E): finds your selected bike
  (name at RVA 0xE55520, the local selection, same layout as a vehicle record from +0x30) in the
  bike list and checks it with RVA 0x4730(bike index, 0xE62840, 0xE628A4) (the server's rules). If
  it is not allowed, the game opens its own chooser: `0xEC330("chat/home/bike_choose", 5)`. If it
  is, it copies the selection (0xE627E0 …) and joins, which sends the change to the server.
- The chooser filters by the server's rules itself (FrostMod's notes describe its filtered list:
  count 0x4C2F18), so allowed classes come for free.

Plan to test: from the pits on a server, have the plugin open the game's own chooser
(`0xEC330("chat/home/bike_choose", 5)`) on a key or from CoreMX, pick a bike there, then Join,
and check that the bike (physics, sound) changes and that other riders see it. Risk: opening the
chooser in a state the game does not expect.
