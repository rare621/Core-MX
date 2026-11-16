# Missing track / content mismatch detection — research notes

Goal: when MX Bikes refuses to join a server because content is missing or different
(track, bike, rider, tyres, class), the presence plugin reports it so MX Bikes Manager can
search MXB Mods, MXB Hub and MX Bikes Shop and have an install/buy pop-up ready.

Findings from the running game (Steam build of 2026-11-15, `mxbikes.exe` image base
0x140000000; addresses below are RVAs — add the module base at runtime). The exe on disk
is SteamStub-wrapped (`.text` entropy 8.0, `.bind` section), so code is read from the
running process; the string table (`.rdata`) is plain on disk.

## What the game does

- Joining a server compares local content with the server's. Differences are collected in
  a list and shown in the `idd_datamismatch` dialog (`connection_dialog`).
- The function filling that dialog starts around RVA 0x962DE. It walks the list and picks a
  message key per record type via a jump table at 0x96A44:

  | type | message key        |
  |------|--------------------|
  | 1    | cc_trackmismatch   |
  | 2    | cc_bikemismatch    |
  | 3    | cc_missingbike     |
  | 4    | cc_ridermismatch   |
  | 5    | cc_missingrider    |
  | 6    | cc_tyresmismatch   |
  | 7    | cc_missingtyres    |
  | 8    | cc_classmismatch   |
  | 9    | cc_missingclass    |

  (There is no separate "missing track" key; see the open question below.)

## The data (read-only access is enough — no code patching)

- `RVA 0xE626C8`: pointer to the record array.
- `RVA 0xE626D8`: record count (int32).
- Record stride 0x28 (40 bytes):
  - +0x00 int32 type (1..9 above)
  - +0x04 char[32] name (bike/rider/tyre/class id; for type 1 presumably the track id)
  - +0x24 int32 version, shown as `%d.%d` (major = value >> 8, minor = value & 0xFF)

## Safety plan for the plugin

1. Before reading, verify a byte signature of the dialog code (e.g. the
   `lea rdx,[cc_trackmismatch]` sequence at 0x96345) matches; if not, the game was updated:
   do nothing and report "paused until MX Bikes Manager is updated".
2. Read memory only, inside SEH guards; never write to the game.
3. If a crash is ever attributed to the plugin, it disables itself and the app shows a
   pop-up until MX Bikes Manager is updated.

## The Missing Track window (what the hook uses)

A server whose track you lack opens `idd_trackerror` ("Missing Track" + the track id), not the
mismatch dialog above (the mismatch list stays empty). It is registered twice:

- handler 0xAB150 (World server list): sets its text with `ui(0x112, ctl, text)` returning to 0xAB2AC
- handler 0xAFCD0 (other list): same call, returning to 0xAFE1E

Both build the text from the selected server row as "%s" or "%s - %s" (track - layout). The
plugin wraps the UI pointer at 0x566C48 and copies the text for those two return addresses only.
The first in-game test missed the World list because only 0xAFCD0 was known.

## Server address for auto-rejoin

The Missing Track handler copies the selected server's record into its stack frame (row at
frame+0x50). Record layout (same as the game's server array):

- +0x0B: IPv4-mapped IPv6 address (`ff ff a b c d`), +0x11: port, big-endian
- +0x26: server name

The full list: pointer at RVA 0x5985D8 (stride 0x1D8), count at RVA 0x5985E0. Verified in game:
address, name and the app's restart-and-join all worked.

## Open questions (need an in-game test)

- What a record looks like when the track is not installed at all (type 1 with the track
  id in `name`?).
- How long the list survives after the dialog closes.

Tools used (not part of the app): a disassembler (iced-x86) and a read-only memory reader,
kept outside the project.
