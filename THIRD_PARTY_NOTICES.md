# Third-party notices

## MXB App (github.com/Frostn1/mxb-app)

The paint (.pnt) and model (.edf) readers in `src/lib/pnt.js` and `src/lib/edf.js`, and bike geometry conventions in `src/lib/bike3d.js`, build on the format work in MXB App's `crates/core` readers. Source: https://github.com/Frostn1/mxb-app.

```
MIT License

Copyright (c) 2026 Sean Dahan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

Used for the 3D rider preview (`node_modules/three`).

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
# Bundled FrostMod

The Windows setup includes FrostMod v0.52.0-mxbm.2 `frostmod.dlo`, built from v0.52.0 with the included automatic-discovery patch, from https://github.com/Frostn1/frostmod/releases/tag/v0.52.0 for server-address discovery. Copyright (c) 2026 Frostn1, MIT licensed. It also includes MinHook (BSD 2-Clause) and its disassembler notices.

The full notices are distributed in `resources/plugin/frostmod/LICENSE.txt`, `MINHOOK-LICENSE.txt` and `NOTICE.txt`, and copied next to the game plugin under `plugins/frostmod-licenses` when installed. Source, pinned release metadata and license texts are in this repository's `plugin/frostmod` directory. FrostMod includes additional live-reload and gameplay/overlay features; Settings → Plugins can remove or reinstall it.


The custom build also includes runtime license texts for libc++, libc++abi, libunwind, MinGW and Zig in the bundled plugin directory.
