CoreMX 1.0.20 — HTTPS online sync and community uploads

Online sync now connects through https://coremx.app/v1/ instead of the direct server address. Existing account tokens are retained when migrating from the previous service address. The website forwards sync requests to the local service, including authenticated requests and file transfers.

CoreMX community uploads with alphanumeric IDs now appear in Get Mods. Their detail pages, images, download links, and website install links use the IDs returned by the live website API.

The update manifest still points to the identical legacy-named setup copy so existing Google Drive updaters can install CoreMX. Upload latest.yml and MX-Bikes-Manager-Setup-1.0.20-x64.exe together to the shared Drive folder to make this version available there.
