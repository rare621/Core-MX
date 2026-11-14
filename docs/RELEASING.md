# Windows setup releases

On Windows with Node.js 24 or later:

```powershell
npm ci
npm test
npm run build:win
```

The shareable setup and its SHA-256 checksum are in `dist/`. Upload the setup EXE and `SHA256SUMS.txt` to a GitHub release. Do not upload `node_modules`, `win-unpacked`, local settings, or temporary build folders. Users install the EXE; they do not need Node.js or this source folder.

The setup uses an assisted per-user install, offers a destination folder, adds shortcuts, registers `mxbm://` join links, and supports uninstall/reinstall. The app stores settings in the user's AppData folder and locates that user's game folders on first launch.

## GitHub Actions

Push these source changes, then create a version tag matching `package.json`, for example `v1.0.0`. The **Windows installer** workflow tests the app, builds the installer, uploads a downloadable Actions artifact, and creates a **draft** GitHub release with the EXE and checksum. Review the draft before publishing it. A manual workflow run builds an artifact without creating a release.

For another release, update the package version and lockfile with `npm version patch --no-git-tag-version`, update `docs/RELEASE_NOTES.md`, commit, and push the matching tag.

## Optional online service

Local development continues to use the root `online.config.json`. Release builds generate a separate configuration with an empty server address, so the developer's LAN address is never bundled.

To enable your hosted service, set the GitHub repository variable `MXB_SERVICE_URL` to its public HTTP(S) origin before building. Locally, set `$env:MXB_SERVICE_URL = 'https://your-server.example'` before `npm run build:win`. No server passwords or account tokens belong in this value. The service is deployed separately; see `server/README.md`.

## Code signing

This initial build is unsigned. Windows may show an unknown-publisher or SmartScreen warning. A future signed build requires your own Windows code-signing certificate and a change to `win.signExecutable` in `electron-builder.config.cjs`; never commit signing credentials.
