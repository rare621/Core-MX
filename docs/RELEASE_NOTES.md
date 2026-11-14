## Equipped gear sync, helmet fixes, and reliable online presence

Install **MX-Bikes-Manager-Setup-1.0.4-x64.exe** on both riders' PCs.

**Online server update required:** stop the server, copy **mxbm-server.js** from **mxbm-online-service.zip** over the existing script, then restart **start-server.cmd**. Keep **mxbm-data.json** and **mxbm-files**. The health page should report `"version":2`. The configured public address remains **http://67.84.130.214:60000**.

- The manager keeps reporting presence while MX Bikes is closed. Friends see “Online in the manager” separately from playing or riding.
- Click a friend or **Gear & sync** to review their equipped models, selected paints, bike livery, and session. Sync shows a progress bar and installs missing files into your mods folder. Identical existing files, including paints inside model packages, are skipped. Different existing versions are kept and reported.
- Only equipped gear and the selected bike livery transfer. Model packages exclude unused paint variants. Account-bound or unreadable files are reported as unavailable.
- Friends' sessions have Join and Get track & join actions when an address is available. Track lookup searches the original mod/store pages and checks the installed track before joining.
- Helmet and paint lists combine both gear layouts and packaged paints. The 2021 6D ATR-2 package's built-in variants are now listed. Paint-only folders no longer hide sibling model packages.
- Get Mods separates helmet, boot and protection models from paints, with clear paint-only labels.
- New helmet models are valid paint targets before installation. Old archive gear paths are translated into `rider/riders/default_mx`, including on a fresh install. Missing model requirements and creator-linked model pages appear during review.
- Rider paint pickers have Delete paint controls. Downloads have Show in folder and Delete files actions. Packaged paint deletion preserves the other contents and recycles the original package.
- Browser-download popup cleanup no longer reads a destroyed window. Mixed gear bundles report their actual file categories and destination folders.
- Fix & clean stays available. Removing old-layout gear sends it to the Recycle Bin rather than the disabled folder, including copies saved there by earlier cleanup. Regular mod disabling remains available.

Validation: 52 automated checks passed, including a two-client sync against an isolated service; hidden Electron UI checks covered the friend dialog, progress bar, paint deletion controls, Downloads actions, and browser-window cleanup. The installed 6D helmet was also read and previewed locally.
