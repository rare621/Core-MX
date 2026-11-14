## Restore the configured online server

The installer now includes the server address from `online.config.json` again: **http://192.168.0.38:60000**.

Earlier installers generated an empty server address. This update restores the configured server for live presence, friends, and paint sharing. An explicit `MXB_SERVICE_URL` build override is still supported.

The Husqvarna viewer fix from 1.0.1 is included. Download **MX-Bikes-Manager-Setup-1.0.2-x64.exe** and install it over your current version; manager settings and game mods are preserved.

The configured address is on a local network. The online service must be running and reachable from the PC using the manager.
