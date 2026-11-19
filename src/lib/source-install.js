// Friend gear CoreMX can't copy (locked by its creator, or too large) but that came from a free
// MXB Mods post: the friend's CoreMX installs it from that post, the same way Get Mods does, in the
// background. Only downloads the post itself lists are used, so a shared link can't point anywhere else.
const MEDIAFIRE_FOLDER = /^https?:\/\/(?:www\.)?mediafire\.com\/folder\/([a-z0-9]+)/i;

const sameUrl = (a, b) => String(a || '').trim().replace(/\/+$/, '').toLowerCase() === String(b || '').trim().replace(/\/+$/, '').toLowerCase();
const baseName = (name) => String(name || '').toLowerCase().replace(/\.(pkz|zip|rar|7z)$/i, '').replace(/[\s_]+/g, ' ').trim();

// A MediaFire folder can't be downloaded whole without Premium: take the file with the shared name.
async function mediafireFile(folderKey, fileName, fetchJson) {
  const data = await fetchJson(`https://www.mediafire.com/api/1.5/folder/get_content.php?folder_key=${encodeURIComponent(folderKey)}&content_type=files&response_format=json&chunk=1`);
  const files = data?.response?.folder_content?.files || [];
  const want = baseName(fileName);
  const hit = files.find((f) => baseName(f.filename) === want);
  return hit && /^[a-z0-9]+$/i.test(hit.quickkey) ? { url: `https://www.mediafire.com/file/${hit.quickkey}/file`, size: Number(hit.size) || 0, name: hit.filename } : null;
}

// Which file to download for a shared source, or null when it can't be done without the player.
async function resolveDownload(source, post, { fetchJson }) {
  if (!source || !post || post.paid) return null;
  const downloads = (post.downloads || []).filter((d) => d && d.url && !d.shop);
  const listed = source.download ? downloads.find((d) => sameUrl(d.url, source.download)) : downloads.length === 1 ? downloads[0] : null;
  if (!listed) return null;
  const folder = listed.url.match(MEDIAFIRE_FOLDER);
  if (folder) return source.fileName ? mediafireFile(folder[1], source.fileName, fetchJson) : null;
  if (/mega\.nz\/(folder|#F!)|drive\.google\.com\/drive\/folders|dropbox\.com\/(scl\/fo|sh)\//i.test(listed.url)) return null;
  return { url: listed.url };
}

module.exports = { resolveDownload, mediafireFile, baseName };
