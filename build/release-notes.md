CoreMX 1.0.48

- Sign in with Steam now confirms account ownership through Steam. Existing accounts keep their friends and settings when their owners sign in. Older app versions cannot create new accounts on service v24 by default.
- Gear sync sends creators' original files, never decrypted copies. Sync keeps needed files available, removes unused uploads sooner, and offers clearer cleanup and waiting states.
- Online servers with the same name stay separate; stale hosted sessions disappear when the host leaves. Join warns when other riders use bikes you do not have.
- First-time setup now has a guided tour and tips. Friends has a leaderboard tab, and the in-game overlay has refreshed panels and rider details.
- Installer categories, update checks, and several setup and documentation details have been improved.

Includes **CoreMX-server-v24.zip**. The live service was v22 when this release was prepared. **Update and restart the online service** to enable Steam-verified sign-in and the new online and sync behavior. Stop the server, replace its code from the ZIP, and restart it. Keep `mxbm-data.json`, `admin.key`, `mxbm-files`, and your private `r2.json`; see `server/README.md`. Users should update the app to 1.0.48, then sign in with Steam to verify existing accounts.
