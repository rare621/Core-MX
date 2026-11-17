# Windows setup releases

On Windows with Node.js 24 or later:

```powershell
npm ci
npm test
npm run build:win
```

The shareable setup, `latest.yml` update manifest, server ZIP and SHA-256 checksums are in `dist/`. Publish all four files together in a GitHub release; the updater verifies the EXE against the SHA-512 digest in `latest.yml`. Do not upload `node_modules`, `win-unpacked`, local settings, or temporary build folders. Users install the EXE; they do not need Node.js or this source folder.

The updater checks the public Core-MX GitHub releases at startup. It downloads only after the user chooses Install update, then restarts to apply the update. Publish the CoreMX setup EXE and matching `latest.yml` in the same release.

## One-time Google Drive bridge for older installs

Versions through 1.0.27 still look in [the old update folder](https://drive.google.com/drive/folders/1giNr8lC7cCLE_L62fSCIfRR-vfiwbMVk). To move them to GitHub automatically, upload these two files from the first GitHub-updater release once:

- `CoreMX-Setup-<version>-x64.exe`.
- `latest.yml` from that same release.

Upload the EXE first, then replace `latest.yml` last. Keep exactly one file named `latest.yml`; Drive permits duplicate names and the old updater rejects ambiguous updates. Folder and files must allow **Anyone with the link → Viewer**. The 1.0.27 updater accepts the CoreMX filename and checks its SHA-512 digest. No legacy-named EXE is built from this release onward.

`SHA256SUMS.txt` is optional for manual verification. The server ZIP is separate and is not installed by the app updater. Do not upload source code, `win-unpacked`, user data, or mod assets. Older clients that do not recognize the CoreMX filename must run the installer manually.

The setup uses an assisted per-user install, offers a destination folder, adds shortcuts, registers `mxbm://` join links, and supports uninstall/reinstall. The app stores settings in the user's AppData folder and locates that user's game folders on first launch.

## GitHub Actions

Push these source changes, then create a version tag matching `package.json`, for example `v1.0.28`. The **Windows installer** workflow tests the app, builds the installer, uploads a downloadable Actions artifact, and publishes a GitHub release with the CoreMX setup, update manifest, server ZIP, and checksums. A manual workflow run builds an artifact without creating a release.

For another release, update the package version and lockfile with `npm version patch --no-git-tag-version`, update `docs/RELEASE_NOTES.md`, commit, and push the matching tag.

## Optional online service

Local development and release builds use the server address in the root `online.config.json`. The installer copies that address into its bundled configuration.

When the same backend moves to a new address, `previousServiceUrls` can list its old origins so existing accounts keep their sign-in. Only list addresses sharing the same account database. An override to a different service does not inherit these aliases.

To override that address for a particular build, set the GitHub repository variable `MXB_SERVICE_URL` to an HTTP(S) origin. Locally, set `$env:MXB_SERVICE_URL = 'https://your-server.example'` before `npm run build:win`. A blank override keeps the configured project address. LAN addresses are reachable only within that network; users elsewhere need a reachable public service address. No server passwords or account tokens belong in this value. The service is deployed separately; see `server/README.md`.

## Code signing

This initial build is unsigned. Windows may show an unknown-publisher or SmartScreen warning. A future signed build requires your own Windows code-signing certificate and a change to `win.signExecutable` in `electron-builder.config.cjs`; never commit signing credentials.
