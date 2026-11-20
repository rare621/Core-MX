CoreMX 1.0.45

- Friends now shows Steam profile photos on friend cards and stops redrawing the page every few seconds.
- Gear received through friend sync has its own "Synced from friends" area in My Gear. It stays out of ordinary Rider gear choices and the in-game overlay until you install that mod yourself.
- CoreMX now bundles 7-Zip, so ZIP, RAR and 7z mod downloads can unpack without a separate extractor installation.
- The game plugin and online service have been updated to support the synced-gear changes.

Includes CoreMX-server-v18.zip. The live service was on v17 when this release was prepared, so update the server code and restart the service. Preserve mxbm-data.json, admin.key, mxbm-files, and your private r2.json. Version 18 removes unused synced files after two minutes and stops retaining files for accounts inactive for five days; returning riders upload their equipped files again. See server/README.md for update steps.
