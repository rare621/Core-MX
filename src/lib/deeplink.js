// mxbm:// links. The app registers the mxbm protocol; the website (coremx.app) and join links use it.
//   mxbm://join/<ip:port>                      join a server
//   mxbm://install/<source>/<id>[?file=<n>]    open a mod from Get Mods and install it
//                                              source: mxbmods (mxb-mods.com post id), hub (MXB Hub product id), mxbs (MX Bikes Shop download id)
//                                              file:   0-based index into the post's download list
//   mxbm://oem/<pack>                          install or update an OEM pack (mx, enduro, sm, freeride)
// Everything is validated here; anything that doesn't match exactly is ignored.
const SOURCES = new Set(['mxbmods', 'hub', 'mxbs']);
const PACKS = new Set(['mx', 'enduro', 'sm', 'freeride']);

function parse(link) {
  if (typeof link !== 'string' || link.length > 300) return null;
  let m = link.match(/^mxbm:\/\/join\/([^/?#]+)\/?$/i);
  if (m) {
    let address; try { address = decodeURIComponent(m[1]); } catch { return null; }
    return /^[A-Za-z0-9.\-:[\]]{3,80}$/.test(address) ? { type: 'join', address } : null;
  }
  m = link.match(/^mxbm:\/\/install\/([a-z]+)\/(\d{1,12})\/?(?:\?file=(\d{1,3}))?$/i);
  if (m) {
    const source = m[1].toLowerCase();
    if (!SOURCES.has(source)) return null;
    const out = { type: 'install', source, id: Number(m[2]) };
    if (m[3] !== undefined) out.file = Number(m[3]);
    return out.id > 0 ? out : null;
  }
  m = link.match(/^mxbm:\/\/oem\/([a-z]+)\/?$/i);
  if (m) { const pack = m[1].toLowerCase(); return PACKS.has(pack) ? { type: 'oem', pack } : null; }
  return null;
}
// Windows passes the link as one of the process arguments.
function fromArgv(argv) {
  const link = (argv || []).find((x) => /^mxbm:\/\//i.test(String(x)));
  return link ? parse(String(link)) : null;
}
// Hold cold-start and second-instance links until the renderer has finished booting.
function createInbox(deliver) {
  let ready = false;
  let pending = [];
  return {
    reset() { ready = false; },
    push(link) { if (!link) return; if (ready) deliver(link); else pending.push(link); },
    ready() { ready = true; const links = pending; pending = []; return links; },
  };
}
module.exports = { parse, fromArgv, createInbox };
