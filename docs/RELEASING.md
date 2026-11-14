# Windows setup releases

On Windows with Node.js 24 or later:

```powershell
npm ci
npm test
npm run build:win
```

The shareable setup, `latest.yml` update manifest, server ZIP and SHA-256 checksums are in `dist/`. Publish all four files together in a GitHub release; the updater verifies the EXE against the SHA-512 digest in `latest.yml`. Do not upload `node_modules`, `win-unpacked`, local settings, or temporary build folders. Users install the EXE; they do not need Node.js or this source folder.

The updater checks on each installed-app start, downloads in the background, and installs on a normal quit or explicit restart. Version 1.0.10 and later override the build's GitHub provider with the shared Google Drive folder below. GitHub releases remain a separate archive for repository members; friends do not need repository access.

## Google Drive updates

Upload these two files from the same build to [the update folder](https://drive.google.com/drive/folders/1giNr8lC7cCLE_L62fSCIfRR-vfiwbMVk):

- `MX-Bikes-Manager-Setup-1.0.10-x64.exe` (use the version you just built).
- `latest.yml` (keep its original filename and contents).

Upload the EXE first, then replace `latest.yml` last. Keep exactly one file named `latest.yml`; Drive permits duplicate names and the app rejects ambiguous updates. Folder and file sharing must allow **Anyone with the link → Viewer**. The manifest must refer to an EXE present in this same folder. Its SHA-512 checksum is checked before installation. Google Drive download quotas can temporarily prevent updates.

`SHA256SUMS.txt` is optional for manual verification. The server ZIP is separate and is not installed by the app updater. Do not upload source code, `win-unpacked`, user data, or mod assets. Users on 1.0.9 or earlier must run the 1.0.10 installer once; their previous private GitHub update feed cannot deliver this switch automatically.

The setup uses an assisted per-user install, offers a destination folder, adds shortcuts, registers `mxbm://` join links, and supports uninstall/reinstall. The app stores settings in the user's AppData folder and locates that user's game folders on first launch.

## GitHub Actions

Push these source changes, then create a version tag matching `package.json`, for example `v1.0.0`. The **Windows installer** workflow tests the app, builds the installer, uploads a downloadable Actions artifact, and creates a **draft** GitHub release with the EXE and checksum. Review the draft before publishing it. A manual workflow run builds an artifact without creating a release.

For another release, update the package version and lockfile with `npm version patch --no-git-tag-version`, update `docs/RELEASE_NOTES.md`, commit, and push the matching tag.

## Optional online service

Local development and release builds use the server address in the root `online.config.json`. The installer copies that address into its bundled configuration.

When the same backend moves to a new address, `previousServiceUrls` can list its old origins so existing accounts keep their sign-in. Only list addresses sharing the same account database. An override to a different service does not inherit these aliases.

To override that address for a particular build, set the GitHub repository variable `MXB_SERVICE_URL` to an HTTP(S) origin. Locally, set `$env:MXB_SERVICE_URL = 'https://your-server.example'` before `npm run build:win`. A blank override keeps the configured project address. LAN addresses are reachable only within that network; users elsewhere need a reachable public service address. No server passwords or account tokens belong in this value. The service is deployed separately; see `server/README.md`.

## Code signing

This initial build is unsigned. Windows may show an unknown-publisher or SmartScreen warning. A future signed build requires your own Windows code-signing certificate and a change to `win.signExecutable` in `electron-builder.config.cjs`; never commit signing credentials.
