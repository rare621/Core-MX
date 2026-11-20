CoreMX 1.0.46

- Joining a live server now checks its current address just before MX Bikes launches. Joining a friend checks their session again after gear sync, so an old address is less likely to cause a timeout.
- Game hosting now checks Windows Firewall and can open UDP 54210 through UPnP. Settings > Plugins shows the host's port and firewall status, including a warning for a router behind another router.
- The online service can give riders on the host's own network its local address. The host reports that address on its first heartbeat.
- The server list identifies CoreMX riders by their app names. Track/version matching and installs from Get Mods have also been improved.
- Setup installs for menus, loading screens, and menu backgrounds are supported.

Includes CoreMX-server-v20.zip. **Update and restart the online service** to enable its new hosting behavior. Replace the server code from the ZIP, but keep mxbm-data.json, admin.key, mxbm-files, and your private r2.json. See server/README.md for the update steps.

Game-hosted sessions still require the host's UDP endpoint to be reachable for CoreMX's direct Join. The game's Multiplayer browser may connect through a different path, so a router or firewall that blocks direct traffic can still cause timeouts.
