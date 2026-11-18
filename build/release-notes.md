CoreMX 1.0.35

- A rider's game-reported endpoint now takes priority over an estimated home-host address while the same host session is active.
- Live servers label home-host addresses as observed or estimated, so a direct Join timeout is easier to understand.
- Joining from CoreMX passes the selected server name to the game launch handler, helping recent-server tracking match the intended server.

This update does not add a PiBoSo master-server relay. Direct Join still depends on the host being reachable.

Server operators: replace mxbm-server.js from the included mxbm-online-service.zip in your existing online-service folder, then restart it. Keep mxbm-data.json, admin.key, and mxbm-files. The service reports version 12 after the update.
