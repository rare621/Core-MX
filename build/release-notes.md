CoreMX 1.0.50

- Friend gear sync now tries the shared file first. If that is unavailable, it can use the owner's MXB Mods page, a shared gear catalog, and a careful name search before asking you to choose a file. The new Missing gear window covers friends and other CoreMX riders on your server.
- Service v27 keeps a shared catalog of MXB Mods pages and downloads that actually installed gear, so other riders can find compatible free files more reliably.
- Online and Friends show clearer status when Steam sign-in, verification, or the game plugin needs attention. The in-game overlay also shows CoreMX riders found in the server's player list when their plugin is not reporting.
- Get Mods search handles different dash characters in track names. Plugin installs ignore files meant for other PiBoSo games, and app downloads explain that a program was saved to Downloads rather than installed into MX Bikes.
- The online count includes connected app users even before Steam verification. Deleted announcements stay dismissed on this PC.

Includes **CoreMX-server-v27.zip**. The live service was v26 when this release was prepared. **Update and restart the online service** for the shared gear catalog and sync improvements. Stop the server, replace its code from the ZIP, and restart it. Keep `mxbm-data.json`, `admin.key`, `mxbm-files`, and your private `r2.json`; see `server/README.md`. Users should update CoreMX to 1.0.50 as well.
