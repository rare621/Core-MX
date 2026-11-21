CoreMX 1.0.49

- Steam sign-in now returns to `https://coremx.app` when the online service runs behind the website proxy.
- Existing online accounts get a clear **Verify with Steam** option at startup, in onboarding, and on the Friends page.
- Service v25 requires Steam verification for online features. The app explains what is paused and lets riders verify or come back later. Announcements remain available and appear only once per PC.

Includes **CoreMX-server-v25.zip**. The live service was v24 when this release was prepared. **Publish the app first, then update and restart the online service**; version 1.0.48 does not show the verification prompt required by v25. Stop the server, replace its code from the ZIP, and restart it. Keep `mxbm-data.json`, `admin.key`, `mxbm-files`, and your private `r2.json`; see `server/README.md`. Existing account owners should update CoreMX to 1.0.49 and choose **Verify with Steam** to keep using online features.
