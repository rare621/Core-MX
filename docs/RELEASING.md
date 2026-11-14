# Windows setup releases

On Windows with Node.js 24 or later:

```powershell
npm ci
npm test
npm run build:win
```

The shareable setup, `latest.yml` update manifest, server ZIP and SHA-256 checksums are in `dist/`. Publish all four files together in a GitHub release; the updater verifies the EXE against the SHA-512 digest in `latest.yml`. Do not upload `node_modules`, `win-unpacked`, local settings, or temporary build folders. Users install the EXE; they do not need Node.js or this source folder.

The updater checks on each installed-app start, downloads in the background, and installs on a normal quit or explicit restart. It uses the GitHub provider configured in `electron-builder.config.cjs`; do not embed GitHub credentials. The current source repository is private. Anonymous updates for friends require an approved public release feed, or each user must have access to the private feed. Changing repository visibility or creating a public distribution repository requires the owner's choice first.

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
