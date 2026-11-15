# Bundled address discovery

This is a modified FrostMod build, **0.52.0-mxbm.2**, not an official upstream release.

- FrostMod: https://github.com/Frostn1/frostmod/tree/fe1614ddbc294faba93e914697ae98bd89f494db (MIT).
- MinHook: https://github.com/TsudaKageyu/minhook/tree/c3fcafdc10146beb5919319d0683e44e3c30d537 (BSD 2-Clause; included disassembler notices).
- Compiler: Zig 0.17.1, Windows x64.
- Build: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-frostmod.ps1` from the repository root. Output is `.tmp/frostmod-fixed.dll`; the script also runs upstream masterlist decoder tests.

`automatic-discovery.patch` connects the existing read-only server-browser row decoder to a background exporter. It does not request another browser refresh. The game sends small batches, so observations accumulate in a process-local address book capped at 1,000 rows, each expiring six hours after its last observation. Oldest entries are evicted at capacity. Rows are copied under a mutex and written atomically at most twice per second when changed. Unchanged active lists renew their timestamp once a minute. One list is replaced, rather than appending file history. Startup and normal shutdown delete old discovery outputs; the app additionally removes expired lists and interrupted temporary files, and clears discovery files once the game is closed. `masterlist-cache.test.cpp` covers successive batches, duplicate updates, eviction and individual expiry.

The patch also adds the explicit function-pointer conversions and `share.h` include needed to build upstream code with Clang. Automatic replacement is limited to checksums of the previously bundled official 0.52.0 and manager-patched binaries. Other installed versions are preserved. `release.json` pins the shipped binary's size and SHA-256.

FrostMod retains its other upstream features. The app exposes install/removal in Settings → Plugins. No game models, purchased assets, account information or user configuration are included.

The custom build also includes runtime license texts for libc++, libc++abi, libunwind, MinGW and Zig in the bundled plugin directory.
