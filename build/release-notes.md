CoreMX 1.0.53

- Service v28 records gear file fingerprints in the shared catalog. When a matching free download can be installed directly from MXB Mods, other riders can get that exact file there instead of uploading it to R2. Other files continue through normal sync.
- Gear installed to show another rider's outfit stays separate from your own Rider gear and liveries until you install it for yourself.
- Removing downloads keeps synced gear worn by any of your profiles and mods you installed yourself; removable files go to the Recycle Bin.
- Gloves inside kit packs install under gloves, and Fix & clean can move gloves previously placed in the kits folder. Modpack paints and bike swaps are classified more accurately, and stock wheels render in the 3D viewer.
- Game hosting writes the selected bike classes to the setting MX Bikes reads, including classes for mod bikes.

Includes **CoreMX-server-v28.zip**, packaged from the current server source. The live service was v27 when this release was prepared, so **update and restart the online service** after publishing the app. Stop the server, replace its code from the ZIP, and restart it. Keep `mxbm-data.json`, `admin.key`, `mxbm-files`, and your private `r2.json`; see `server/README.md`. Users should update CoreMX to 1.0.53 as well.
