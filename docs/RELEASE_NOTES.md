## Live outfit previews and smoother mod management

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
