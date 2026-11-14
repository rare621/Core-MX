# MX Bikes preview implementation notes

Verified locally on November 13, 2026, against Steam build 23566986.

The manager reads installed models and paints directly. No retail assets, executable dumps, account credentials, or game keys are bundled with it. The user's installed game files and profiles were not changed during development; write operations were tested in disposable fixture folders.

## Asset reader

`src/lib/assetread.js` reads ordinary ZIPs and unbound KCOL containers. It validates container bounds, directory checksums, decoded lengths, and ZIP entry CRCs. KCOL archives expose individual files without extracting a decrypted copy of the entire package. Account-bound containers are rejected; Steam ownership checks are not changed. The CLI in `scripts/read-asset.js` inspects containers and optionally exports one selected asset to a new file.

Source lookup combines loose overrides, the sibling package, and built-in fallback content. A paints-only directory no longer hides its packaged model. File handles close after reads, archive indexes and model caches are bounded, and updates invalidate cached archive indexes.

## Geometry

Bike assemblies use gfx.cfg, HRC scene selections, and GEOM mount points. Explicit scene-child links preserve animated lever pivots. Independent export objects are distinguished from combined bike nodes. Wheel radii come from visible geometry, excluding procedural chain templates. Rear suspension is posed so both tyres meet a common display ground plane; this is a static preview rather than a simulation of the game's suspension physics. Texture alpha cutouts preserve the brake disc openings.

Helmet exports with unrelated camera roots use independent object frames. A shared face/shell basis is selected only when it improves head enclosure. Material tables accept the texture-coordinate channel used by sampled Fly and 6D exports. Glove thumbnails isolate one glove from the rider body.

## Verification

- Rendered installed 1996 Honda CR250, 2002 Kawasaki KX125, 2023 Kawasaki KX250/KX450, selected bike paint, 6D2020 helmet, and sealed Fly Evo Blue gloves in the real Three.js viewer. Checked individual images for assembly, pivots, tyre placement, alpha cutouts, helmet orientation, and glove framing.
- Verified large bike grids and combined brand/cc/class filtering; profile positioning and creation; livery source images without 3D thumbnail requests; rider controls; paint management; Host presets; and asynchronous store details in a hidden Electron UI harness.
- Ran the full app against disposable folders to install a track ZIP, clear its health warning, recognize identical content, filter install targets, cancel and clean a staged job, preview/delete a synthetic rider model, and create/activate a real-format profile. No staging files remained.
- `npm test` covers container integrity, sources, transform hierarchy, suspension mounts, image ranking, profile operations, store loading, content verification, cache cleanup, and storage accounting. Tests use original synthetic fixtures.

Temporary analysis tools, the private loaded-code inspection dump, test profiles, screenshots, and staged downloads are removed after verification. No game process access is needed at runtime or for previewing.

Format reference and attribution: [MXB App](https://github.com/Frostn1/mxb-app), with its MIT notice in THIRD_PARTY_NOTICES.md. No shared field note or public upload was made.
