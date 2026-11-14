## Fixed Husqvarna bike previews

Husqvarna models could appear as several bikes stacked on top of each other. Their model files use variant-suffixed part names such as `steer450f`, while the configuration asks for `steer`. The viewer now resolves the individual part instead of loading the whole model into each slot.

- Verified the installed Husqvarna FC 250, FC 350, FC 450, TC 125, and TC 250.
- Checked Kawasaki KX250 and Honda CR250 previews for regressions.
- Missing or ambiguous parts now produce a warning instead of duplicating an entire bike.
- Added regression tests for suffixed part names and combined model files.

Download **MX-Bikes-Manager-Setup-1.0.1-x64.exe** and install it over the previous version. Your manager settings and game mods are preserved. Node.js is not required.

The installer is unsigned, so Windows may show an unknown-publisher warning. Verify the download against `SHA256SUMS.txt` if needed. Game and mod assets are not included.
