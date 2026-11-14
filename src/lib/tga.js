// Minimal TGA decoder -> BGRA bitmap (what Electron's nativeImage.createFromBitmap expects on Windows).
// Supports true-color (2), grayscale (3), color-mapped (1) and their RLE variants (10, 11, 9).

function decodeTGA(buf) {
  const idLen = buf[0];
  const cmapType = buf[1];
  const imgType = buf[2];
  const cmapStart = buf.readUInt16LE(3);
  const cmapLen = buf.readUInt16LE(5);
  const cmapDepth = buf[7];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  if (!width || !height || width > 16384 || height > 16384) throw new Error('bad tga size');
  const rle = imgType >= 9;
  const base = imgType % 8; // 1 = mapped, 2 = truecolor, 3 = gray
  if (![1, 2, 3].includes(base)) throw new Error('unsupported tga type ' + imgType);

  let off = 18 + idLen;
  let cmap = null;
  if (cmapType === 1) {
    const eb = Math.ceil(cmapDepth / 8);
    cmap = { start: cmapStart, data: buf.subarray(off, off + cmapLen * eb), eb };
    off += cmapLen * eb;
  }
  const bytesPP = Math.ceil(bpp / 8);
  const n = width * height;
  const out = Buffer.alloc(n * 4);

  // Writes one source pixel (at buf[p]) into out pixel i (BGRA)
  const put = (i, src, p) => {
    const o = i * 4;
    if (base === 3) {
      const g = src[p];
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = bytesPP === 2 ? src[p + 1] : 255;
      return;
    }
    let s = src, q = p, depth = bpp;
    if (base === 1) {
      const idx = (bytesPP === 2 ? src.readUInt16LE(p) : src[p]) - cmap.start;
      s = cmap.data; q = idx * cmap.eb; depth = cmapDepth;
    }
    if (depth === 32) {
      out[o] = s[q]; out[o + 1] = s[q + 1]; out[o + 2] = s[q + 2]; out[o + 3] = s[q + 3];
    } else if (depth === 24) {
      out[o] = s[q]; out[o + 1] = s[q + 1]; out[o + 2] = s[q + 2]; out[o + 3] = 255;
    } else if (depth === 16 || depth === 15) {
      const v = s.readUInt16LE(q);
      out[o + 2] = ((v >> 10) & 31) << 3;
      out[o + 1] = ((v >> 5) & 31) << 3;
      out[o] = (v & 31) << 3;
      out[o + 3] = 255;
    } else {
      throw new Error('unsupported depth ' + depth);
    }
  };

  if (!rle) {
    for (let i = 0; i < n; i++) put(i, buf, off + i * bytesPP);
  } else {
    let i = 0;
    while (i < n && off < buf.length) {
      const h = buf[off++];
      const count = (h & 0x7f) + 1;
      if (h & 0x80) {
        for (let k = 0; k < count && i < n; k++) put(i++, buf, off);
        off += bytesPP;
      } else {
        for (let k = 0; k < count && i < n; k++) { put(i++, buf, off); off += bytesPP; }
      }
    }
  }

  // If alpha channel is entirely zero, treat image as opaque (common in exported TGAs)
  if (bpp === 32 || (base === 1 && cmapDepth === 32)) {
    let anyAlpha = false;
    for (let i = 3; i < out.length; i += 4) if (out[i] !== 0) { anyAlpha = true; break; }
    if (!anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }

  // Origin: bit 5 set = top-left; otherwise bottom-left -> flip vertically
  const topLeft = (desc & 0x20) !== 0;
  if (!topLeft) {
    const row = width * 4;
    const tmp = Buffer.alloc(row);
    for (let y = 0; y < (height >> 1); y++) {
      const a = y * row, b = (height - 1 - y) * row;
      out.copy(tmp, 0, a, a + row);
      out.copy(out, a, b, b + row);
      tmp.copy(out, b);
    }
  }
  return { width, height, data: out };
}

module.exports = { decodeTGA };
