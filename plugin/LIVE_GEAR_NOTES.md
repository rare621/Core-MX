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

## Still to find

- Object ids for suit, helmet and boots paints (finish §7).
- How the game frees a vehicle's objects, for a full rebuild when a gear *model* changes.
- A paint-only re-apply that works while riding (or how to rebuild safely).
- What else holds list indexes that a reload would invalidate (menu choosers).
- Where player names live when +0x10 is empty.
