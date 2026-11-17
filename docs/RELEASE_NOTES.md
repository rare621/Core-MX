## 1.0.23 — Get Mods rankings and CoreMX activity

- Popular filters now use MXB Mods' ranked lists and stop filling the results with newly posted mods. A failed ranking request shows an error instead of a misleading list.
- Mod cards and details show post views when the source provides them.
- The top bar links to coremx.app and shows the number of recently active CoreMX users when the online service reports it.
- The online service reports active users from current presence heartbeats. Deploy the included server ZIP to enable the count.

## 1.0.21 — CoreMX mod details fix

- Fixed a popup spinner that remained after opening a CoreMX upload. The website's numeric timestamps are converted before the details render.
- Detail rendering errors now appear inside the popup rather than leaving it loading indefinitely.

## 1.0.20 — HTTPS online sync and community uploads

- The app now sends online sync traffic to `https://coremx.app/v1/`. The website proxies those calls to the local sync service. Existing tokens and friends are retained when moving from the old service address.
- CoreMX community uploads now use the website's alphanumeric IDs, so published mods appear in Get Mods with their images, detail pages, download links, and website install links.
- The release workflow builds the CoreMX installer and legacy-named update copy, then publishes the release automatically after tests and packaging pass.

## 1.0.10 — Hoodie previews, gear defaults, and Drive updates

- Local preview workers can read installed KCOL models carrying a binding marker, including the purchased ABDesigns hoodie tested with the Dropsize paint. Rider bodies use their recorded bounds to select the correct transform. Missing custom bodies no longer silently show the stock rider. This does not change paid-mod sync restrictions.
- Changing rider models resets the rider kit and gloves to that model's defaults in the preview. Apply still controls writes to the game profile.
- Blank per-bike protection now reflects the profile-wide chest protector fallback. Applying None clears the fallback too, and applying a bike writes its chosen protection to the startup setting.
- Friend sync identifies protected models before attempting to package them. Missing paid items say "Paid mod — not installing." An installed recipient model is recognized locally so compatible free paints can sync without transferring or replacing the paid model. Paint-only folders do not count as installed models.
- A session without a reported server name no longer incorrectly says "Offline session." Direct joining still requires a known server address.
- Setup bundles the checksum-verified FrostMod v0.52.0-mxbm.2 plugin (v0.52.0 with an included address-export fix) and its licenses. The app installs the helper when MX Bikes is closed and the game folder is configured. Settings → Plugins shows both plugins with Install / Remove controls; removing FrostMod disables automatic reinstallation. The previously bundled official binary is upgraded; other user-installed versions are preserved.
- Online has an Automatic addresses panel. Unique recent server-name matches from FrostMod's browser list are included in outgoing presence so friends can join; stale or ambiguous discovery entries are not persisted. Restart MX Bikes after installing the helper, then open its Multiplayer browser; no extra Refresh click is needed. Discovery writes one replaceable list in the background, clears it on normal game shutdown, and removes expired/interrupted files. Removing the helper clears its discovery outputs and bundled license files. Direct Join launches a closed game; it does not switch sessions inside a running game.
- Server rows, server details and friend status now include the reported session stage (Practice, Qualifying, Warmup, Race 1 or Race 2). Update the online service script too to carry these fields.
- Add-on requirements come from creator descriptions and instructions; website categories, login prompts and recommendations are excluded. Recognize an installed ABDesigns hoodie package when checking its paints.
- App updates check the shared Google Drive folder on startup. Upload this release's setup EXE and `latest.yml`; users on older versions need this installer once to switch from the private GitHub feed.
- The online server removes unreferenced shared cache files after a two-minute grace period. It retains every user's current shared outfit, including offline users, and files being downloaded. Copy the updated server script **and cache-cleanup.js** from the server ZIP; retain the account database and shared-file folder.

Validation: 103 automated app tests; native decoder and batch-cache tests; live Multiplayer discovery of 547 addresses without a manual Refresh; a unique current-server IP/port match and Warmup status; cleanup on game exit; hidden Electron plugin-settings/dialog checks; live Dropsize requirement parsing; and an Electron render of the installed hoodie with its selected paint. A second player's direct join was not exercised. Google Drive downloading through the app still requires the EXE and manifest to be uploaded to the shared folder. In-game protection behavior needs a game launch after applying None.

## Previous release — Live outfit previews and smoother mod management

Close MX Bikes Manager before running **MX-Bikes-Manager-Setup-1.0.8-x64.exe**. Both friends should update. The existing version-4 online server remains compatible; no account reset is needed.

- Outfit previews now use pending gear and paint choices before Apply. Older loadout/model responses cannot overwrite a newer preview. The top-right badge changes from Active in game to Preview changes while editing either the outfit or bike.
- Bottom-left account controls show the signed-in Steam avatar.
- Tyres are restricted to sets declared by the selected bike. Incompatible saved choices no longer appear as valid options or get used for preview/sync; Apply resets them to the bike default. Copying an outfit does not copy a tyre set to unrelated bikes.
- Model parsing/building and thumbnail rendering use background workers. Hidden or covered previews pause rendering, and closed pickers stop requesting more thumbnails.
- MXB Mods keeps bike liveries, gloves and standard rider kits. Addons contains dependent gear paints and rider kits that require another model. Separate Mod Instructions are read, including the ABDesigns hoodie requirement omitted from the site's API description. No mod archives or local catalog files are downloaded to build these categories.
- Category switching drops stale responses. Loading more cards preserves existing images and scroll position. Filtered browsing carries a cursor so skipped source listings cannot cause repeated or missing matches. Failed loads wait for Retry instead of looping.
- Deleting an installed mod clears its completed job state, updates library/card badges, and restores Install on its download choices. Completed progress bars are hidden. Download/extraction wording is clearer.
- Post-install item selection is a button with a 3D preview where supported, or the download image. Multiple items open a visual chooser. Equip now, Customize first and Skip remain available.
- Friend cards separate status, readable bike name, file-sync state and actions. Friend-panel actions no longer replace the underlying Rider or library page with Sync settings.
- Graphics disabling/re-enabling/uninstall works across separate drives, using a verified copy before removing the source when rename reports EXDEV. Originals are restored as before.
- Added GitHub startup-update checks, background download progress, installation on quit, Restart to update and Check now in Settings. Unsaved Rider previews and active mod jobs must be handled before an explicit restart. Updates use electron-updater's installer checksum verification. The configured GitHub feed must be accessible to the user; private-repository access is a separate distribution requirement.

Validation: automated coverage includes live draft requests, stale-response handling, bike-specific tyre filtering, worker builds, cross-drive graphics transitions, separate instruction-field detection and filtered pagination. Hidden Electron checks exercised the Steam avatar, Preview changes badge, real OffscreenCanvas thumbnails, friend-card layout, visual equip selection and deletion reset. A packaged app.asar check verified draft helmet selection without saving the game profile and both kinds of worker loading. Full in-game tyre selection and every third-party asset/layout have not been verified.
