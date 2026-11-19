CoreMX 1.0.42

- Optional Cloudflare R2 storage lets shared paint and model files upload and download without passing through the online service PC for every transfer.
- The v16 service checks each uploaded file before accepting it, moves existing synced files to R2 after configuration, and removes R2 files that are no longer equipped after a day.
- Older app versions can still download shared files through the service's short-lived R2 links. Without R2 configuration, file storage continues on the service PC.

The v16 online service is included as CoreMX-server-v16.zip. To enable R2, replace the service files, then follow server/README.md to create a private bucket and an r2.json next to your service data. Keep your existing mxbm-data.json, admin.key, and mxbm-files folder. No R2 credentials are included in this release.
