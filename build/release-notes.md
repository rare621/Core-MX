CoreMX 1.0.43

- Friends now checks shared gear when the page refreshes. A changed helmet or other file shows as an update queued instead of leaving an old "all files synced" count on the card.
- The Friends Refresh button checks new shared files immediately and starts a sync, without waiting for the one-minute automatic check.
- Free encrypted gear uses normal CoreMX file sync, including larger sealed assets. Files tied to an account are identified separately from paid shop mods. CoreMX no longer starts an MXB Mods download in the background for unavailable gear.
- The online service v17 supports synced files up to 512 MB with R2 and keeps an MXB Mods page link available when a file cannot be shared directly.

The release includes CoreMX-server-v17.zip. If your server is still on v16, stop it and copy mxbm-server.js, cache-cleanup.js, and r2.js from the ZIP into the existing server folder, then restart it. Keep mxbm-data.json, admin.key, mxbm-files, and your private r2.json where they are. See server/README.md for the update steps.
