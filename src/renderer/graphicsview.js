/* global S, $, $$, esc, icon, toast, confirmBox, cleanErr, api, go, fmtSize, timeAgo, renderBrowse, browseReset */
'use strict';
// ---------- Graphics: ReShade / presets / shader packs in the game folder, plus browsing graphics mods ----------
S.gfxTab = 'installed';
S.gfx = null;

async function loadGraphics() { S.gfx = await api.invoke('graphics:scan').catch((e) => ({ error: cleanErr(e), items: [], installed: [] })); return S.gfx; }

function graphicsListHtml(g) {
  if (g.error) return `<div class="notice danger">${icon('alert')}<div>${esc(g.error)}</div></div>`;
  if (!g.installDir) return `<div class="notice warn">${icon('alert')}<div>Set your MX Bikes install folder in Settings — graphics mods live there.</div></div>`;
  const rows = g.items.map((i, idx) => `<div class="srv"><div class="srv-ico">${icon(i.type === 'ReShade' ? 'sparkle' : i.type === 'Shader pack' ? 'layers' : i.type === 'ReShade preset' ? 'image' : 'box')}</div>
      <div class="srv-txt"><div class="t">${esc(i.name)}</div><div class="m">${esc(i.type)}${i.detail && i.detail !== i.name ? ` · ${esc(i.detail)}` : ''} · ${fmtSize(i.size)}</div></div>
      <div class="jactions"><button class="btn btn-sm btn-icon" data-gfx-reveal="${idx}" title="Show in folder">${icon('folder')}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-gfx-trash="${idx}" title="Remove">${icon('trash')}</button>
        <label class="toggle" title="${i.on ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-gfx-toggle="${idx}" ${i.on ? 'checked' : ''}><span class="sw"></span></label></div></div>`).join('');
  const recs = g.installed.map((r) => `<div class="srv">${r.image ? `<img src="${esc(r.image)}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:8px">` : `<div class="srv-ico">${icon('sparkle')}</div>`}
      <div class="srv-txt"><div class="t">${esc(r.title)}</div><div class="m">${r.active ? 'Active' : 'Disabled'} · ${r.files} files · installed ${timeAgo(r.installedAt)}</div></div>
      <div class="jactions"><button class="btn btn-sm ${r.active ? '' : 'btn-primary'}" data-gfx-active="${esc(r.key)}" data-enabled="${r.active ? '0' : '1'}">${icon('power')}${r.active ? 'Disable' : 'Enable'}</button>${r.link ? `<button class="btn btn-sm" data-open="${esc(r.link)}">${icon('external')}Page</button>` : ''}<button class="btn btn-sm btn-danger" data-uninstall="${esc(r.key)}">${icon('trash')}Uninstall</button></div></div>`).join('');
  return `${g.items.length ? `<div class="section-title">In your game folder</div><div class="srv-list">${rows}</div>` : ''}
    ${recs ? `<div class="section-title">Installed with this app</div><p class="muted">Only one graphics package can be active. Enabling another disables the current package.</p><div class="srv-list">${recs}</div>` : ''}
    ${!g.items.length && !recs ? `<div class="set-card gfx-empty">
        <div class="gfx-empty-ico">${icon('sparkle')}</div>
        <h3>No graphics mods yet</h3>
        <p>ReShade presets and graphics overhauls make MX Bikes look a lot better. Install one and it shows up here with an on/off switch.</p>
        <button class="btn btn-primary" data-act="gfx-get">${icon('globe')}Get graphics mods</button></div>`
      : `<div class="muted" style="font-size:12px;margin:14px 4px">Turning something off renames it so the game skips it — turn it back on any time. ReShade can crash the game on busy servers; turn it off if that happens.</div>`}`;
}

async function renderGraphics(c) {
  const t = (id, ic, l) => `<button class="${S.gfxTab === id ? 'active' : ''}" data-gfx-tab="${id}">${icon(ic)}${l}</button>`;
  c.innerHTML = `<div class="view col"><div class="srcbar"><h2>Graphics</h2><div class="seg-tabs">${t('installed', 'sparkle', 'Installed')}${t('get', 'globe', 'Get graphics')}</div></div><div class="view" id="gfxBody"></div></div>`;
  const body = $('#gfxBody');
  if (S.gfxTab === 'get') {
    if (S.browse.tab !== 'graphics') { S.browse.tab = 'graphics'; S.browse.query = ''; S.browse.posts = []; S.browse.page = 0; S.browse.totalPages = 1; S.browse.req = (S.browse.req || 0) + 1; S.browse.loading = false; }
    renderBrowse(body);
    return;
  }
  body.innerHTML = `<div class="main"><div class="scroller" style="padding-top:12px"><div class="loadmore"><div class="spinner"></div></div></div></div>`;
  const g = await loadGraphics();
  if (S.view === 'graphics' && S.gfxTab === 'installed') $('.scroller', body).innerHTML = `<div style="max-width:960px">${graphicsListHtml(g)}</div>`;
}

// My Mods → Graphics tab uses the same list
async function renderGraphicsInto(sc) {
  sc.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
  const g = await loadGraphics();
  if (sc.isConnected) sc.innerHTML = `<div style="max-width:960px">${graphicsListHtml(g)}</div>`;
}

function refreshGraphicsViews() {
  if (S.view === 'graphics') renderGraphics($('#content'));
  else if (S.view === 'library' && S.lib.tab === 'graphics') renderGraphicsInto($('#libScroll'));
}

document.addEventListener('click', async (e) => {
  const active = e.target.closest('[data-gfx-active]');
  if (active) {
    active.disabled = true;
    try { await api.invoke('graphics:setActive', active.dataset.gfxActive, active.dataset.enabled === '1'); refreshGraphicsViews(); }
    catch (err) { active.disabled = false; toast(esc(cleanErr(err)), 'err', 6000); }
    return;
  }
  const t = e.target.closest('[data-gfx-tab]');
  if (t) { S.gfxTab = t.dataset.gfxTab; renderGraphics($('#content')); return; }
  const get = e.target.closest('[data-act="gfx-get"]');
  if (get) { S.gfxTab = 'get'; go('graphics'); return; }
  const rv = e.target.closest('[data-gfx-reveal]');
  if (rv) { api.invoke('graphics:reveal', S.gfx.items[Number(rv.dataset.gfxReveal)].path); return; }
  const tr = e.target.closest('[data-gfx-trash]');
  if (tr) {
    const it = S.gfx.items[Number(tr.dataset.gfxTrash)];
    if (!(await confirmBox('Remove graphics mod', `Move <b>${esc(it.name)}</b> to the Recycle Bin?`, 'Remove', true))) return;
    try { await api.invoke('graphics:trash', it.path); toast('Removed', 'ok', 1500); } catch (err) { toast(esc(cleanErr(err)), 'err'); }
    refreshGraphicsViews();
  }
});
document.addEventListener('change', async (e) => {
  const tg = e.target.closest('[data-gfx-toggle]');
  if (!tg) return;
  const it = S.gfx.items[Number(tg.dataset.gfxToggle)];
  try { await api.invoke('graphics:toggle', it.path, tg.checked); toast(`${esc(it.name)} turned ${tg.checked ? 'on' : 'off'}`, 'ok', 1500); }
  catch (err) { toast(esc(cleanErr(err)), 'err'); }
  refreshGraphicsViews();
});
