## Connect to the public online server

The installer now connects to **http://67.84.130.214:60000**, so friends outside the host's home network can reach the port-forwarded online service.

Existing accounts using the previous LAN address keep their sign-in when updating to this address. The service's account database stays on the same server.

The Husqvarna viewer fix is included. Download **MX-Bikes-Manager-Setup-1.0.3-x64.exe** and install it over your current version; manager settings and game mods are preserved.

For a manual address change, close the app and edit `resources/online.config.json` in its install folder. The default Windows location is `%LOCALAPPDATA%\Programs\MX Bikes Manager\resources\online.config.json`. Keep the online server running and TCP port 60000 forwarded to that server PC.
