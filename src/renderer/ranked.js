/* global S, $, $$, esc, icon, toast, modal, cleanErr, api, go, onlineTabs, openMenu, normName, findTrack */
'use strict';
// ---------- Ranked (mxb-ranked.com, read in the background) ----------
// Profile first, then: Servers (filterable, with details + join), Results, Lap records, Tracks, News.
S.rk = { tab: 'servers', me: null, servers: null, season: null, cache: {}, f: { join: 'all', cat: '', bikes: '' }, showAllRaces: false };

const RANK_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion'];
function rankValue(tier, n) { const t = RANK_TIERS.findIndex((x) => x.toLowerCase() === String(tier).toLowerCase()); return t < 0 ? null : t * 3 + Number(n || 1); }

// Can the user join this server? Returns { ok, why }.
function canJoin(s, me) {
  const myRating = me && me.found ? me.rating : null;
  const myRank = me && me.rankValue != null ? me.rankValue : 0; // unranked = below Bronze 1
  if (s.ratings.length && myRating && !s.ratings.includes(myRating)) return { ok: false, why: `Needs rider rating ${s.ratings.join('/')}` };
  const min = s.rankTitle.match(/Min Rank:\s*(\w+)\s*(\d)?/i), max = s.rankTitle.match(/Max Rank:\s*(\w+)\s*(\d)?/i);
  if (min) { const v = rankValue(min[1], min[2]); if (v != null && myRank < v) return { ok: false, why: `Needs ${min[1]} ${min[2] || ''} or higher`.trim() }; }
  if (max) { const v = rankValue(max[1], max[2]); if (v != null && myRank > v) return { ok: false, why: `Only up to ${max[1]} ${max[2] || ''}`.trim() }; }
  return { ok: true, why: 'You can join' };
}

function rkTabs() {
  const t = (id, l) => `<button class="${S.rk.tab === id ? 'active' : ''}" data-rk-tab="${id}">${l}</button>`;
  return `<div class="seg-tabs" style="margin:0">${t('servers', 'Servers')}${t('results', 'Results')}${t('records', 'Lap records')}${t('tracks', 'Tracks')}${t('news', 'News')}${t('season', 'Season')}</div>`;
}

const flagEmoji = (cc) => (cc && /^[a-z]{2}$/.test(cc) && cc !== 'un' ? String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : '');
const RATING_COLORS = { A: '#30d158', B: '#64d2ff', C: '#ffd60a', D: '#ff9f0a', E: '#ff453a' };

function profileHtml(me) {
  if (!me) return '';
  if (me.error) return `<div class="notice danger">${icon('alert')}<div>Couldn't reach mxb-ranked.com: ${esc(me.error)}</div></div>`;
  if (!me.found) {
    return `<div class="set-card"><h3>Find your ranked profile</h3><p>${me.noGuid ? "Steam isn't signed in on this PC, so" : "There's no ranked profile for your Steam account yet —"} paste your MX Bikes GUID (shown on your mxb-ranked profile).</p>
      <div class="path-row"><input class="input mono" id="rkGuid" placeholder="FF0110000…" style="flex:1;background:var(--raised)"><button class="btn btn-primary" data-act="ranked-guid">Use this</button></div></div>`;
  }
  const races = me.races || [];
  const wins = races.filter((r) => /^1 \//.test(r.position || '')).length;
  const podiums = races.filter((r) => /^[123] \//.test(r.position || '')).length;
  const finished = races.filter((r) => /^\d+ \//.test(r.position || ''));
  const avg = finished.length ? (finished.reduce((a, r) => a + Number(r.position.split('/')[0]), 0) / finished.length).toFixed(1) : '—';
  const mxp = races.reduce((a, r) => a + (Number(r.mxp) || 0), 0);
  const shown = S.rk.showAllRaces ? races : races.slice(0, 8);
  return `<div class="rk-hero" style="${me.banner ? `background-image:linear-gradient(90deg,rgba(28,28,30,.95) 35%,rgba(28,28,30,.55)),url('${esc(me.banner)}')` : ''}">
      <div class="rk-who"><div class="rk-avatar">${esc(me.name.slice(0, 1).toUpperCase())}</div>
        <div><div class="rk-name">${esc(me.name)} ${flagEmoji(me.country)}</div><div class="muted" style="font-size:13px">Member since ${esc(me.member)} · <span class="mono">${esc(me.guid)}</span></div></div>
        <div class="grow"></div><button class="btn btn-sm" data-ranked-open="${esc(me.url)}">${icon('external')}On mxb-ranked</button><button class="btn btn-sm btn-ghost" data-act="ranked-change">Not you?</button></div>
      <div class="rk-stats">
        <div><div class="rk-v" style="color:${RATING_COLORS[me.rating] || 'inherit'}">${esc(me.rating || '—')}</div><div class="rk-l">Rider rating</div></div>
        <div><div class="rk-v">${me.exp.toLocaleString()}</div><div class="rk-l">EXP</div></div>
        <div><div class="rk-v">${races.length}</div><div class="rk-l">Races</div></div>
        <div><div class="rk-v">${wins}</div><div class="rk-l">Wins</div></div>
        <div><div class="rk-v">${podiums}</div><div class="rk-l">Podiums</div></div>
        <div><div class="rk-v">${avg}</div><div class="rk-l">Avg finish</div></div>
        <div><div class="rk-v" style="color:${mxp >= 0 ? 'var(--ok)' : 'var(--danger)'}">${mxp >= 0 ? '+' : ''}${mxp}</div><div class="rk-l">MXP (recent)</div></div>
      </div>
      <div class="muted" style="font-size:12.5px">${esc(me.penalty || '')}${me.stats.length ? '' : ' · No ranked races this season yet'}</div></div>
    ${me.stats.length ? `<div class="set-card" style="margin-top:12px">${me.stats.map((s) => `<div>${esc(s)}</div>`).join('')}</div>` : ''}
    ${races.length ? `<div class="section-title" style="display:flex">Your races<span class="grow"></span>${races.length > 8 ? `<button class="btn btn-sm btn-ghost" data-act="rk-allraces">${S.rk.showAllRaces ? 'Show fewer' : `Show all ${races.length}`}</button>` : ''}</div>
      <div class="glist">${shown.map(raceRow).join('')}</div>` : ''}`;
}

function raceRow(r) {
  const pos = (r.position || '').match(/^(\d+)/);
  const mx = Number(r.mxp);
  return `<div class="rk-race" ${r.link ? `data-ranked-open="${esc(r.link)}"` : ''}>
    <div class="rk-pos ${pos && pos[1] === '1' ? 'gold' : pos && Number(pos[1]) <= 3 ? 'pod' : ''}">${esc(r.position || '—')}</div>
    <div class="rk-race-t"><div class="t">${esc(r.track)}</div><div class="m">${esc((r.server || '').replace(/^MXB-Ranked\.com \| /, ''))}</div></div>
    <div class="m" style="min-width:170px"><span class="dotc" style="background:${esc(r.bikeColor || 'var(--muted)')}"></span>${esc(r.bike)}</div>
    <div class="rk-mxp ${mx > 0 ? 'up' : mx < 0 ? 'down' : ''}">${mx > 0 ? '+' : ''}${esc(r.mxp)} MXP</div>
    <div class="m" title="${esc(r.finishedAt || '')}" style="min-width:90px;justify-content:flex-end">${esc(r.finished)}</div></div>`;
}

async function renderRanked(c, force) {
  if (force) { S.rk.me = null; S.rk.servers = null; S.rk.cache = {}; }
  // Draw everything straight away; the profile fills in when mxb-ranked answers (it can be slow).
  c.innerHTML = `<div class="view"><div class="main">
    <div class="toolbar"><h2>Online</h2>${onlineTabs()}<div class="grow"></div><button class="btn" data-act="ranked-refresh">${icon('refresh')}Refresh</button></div>
    <div class="scroller" id="rkScroll"><div style="max-width:1100px"><div id="rkProfile"></div>
      <div style="margin:22px 0 14px">${rkTabs()}</div><div id="rkBody"><div class="loadmore"><div class="spinner"></div></div></div></div></div></div></div>`;
  drawRkBody();
  if (S.rk.me && !S.rk.me.error && !S.rk.me.loading) { drawProfile(); return; }
  if (!S.rk.me || S.rk.me.error) {
    const cached = await api.invoke('ranked:cached').catch(() => null);
    S.rk.me = cached ? { ...cached, refreshing: true } : { loading: true };
  }
  drawProfile();
  loadProfile();
}

let profileReq = 0;
async function loadProfile() {
  const req = ++profileReq;
  const fresh = await api.invoke('ranked:me').catch((e) => ({ error: cleanErr(e) }));
  if (req !== profileReq) return;
  // Keep showing a cached profile if the refresh failed
  if (fresh.error && S.rk.me && S.rk.me.found) S.rk.me = { ...S.rk.me, refreshing: false, refreshError: fresh.error };
  else S.rk.me = fresh;
  drawProfile();
  if (S.rk.tab === 'servers') drawRkBody(); // "can join" depends on your rating
}

function drawProfile() {
  const el = $('#rkProfile');
  if (!el) return;
  const me = S.rk.me;
  if (!me || me.loading) {
    el.innerHTML = `<div class="rk-hero"><div class="rk-who"><div class="rk-avatar skeleton"></div><div style="flex:1"><div class="skeleton" style="height:22px;width:220px;border-radius:6px"></div><div class="muted" style="font-size:13px;margin-top:8px">Loading your profile from mxb-ranked… (their site can be slow)</div></div></div>
      <div class="rk-stats">${[1, 2, 3, 4, 5].map(() => '<div><div class="skeleton" style="height:24px;width:60px;border-radius:6px"></div><div class="rk-l">&nbsp;</div></div>').join('')}</div></div>`;
    return;
  }
  if (me.error) {
    el.innerHTML = `<div class="notice warn">${icon('alert')}<div>Couldn't load your profile: ${esc(me.error)}. <button class="btn btn-sm" style="margin-left:6px" data-act="rk-retry-profile">${icon('refresh')}Try again</button></div></div>`;
    return;
  }
  const status = me.refreshing ? `<div class="muted" style="font-size:12px;margin-top:6px">${icon('refresh')} Updating… (showing your profile from ${esc(timeAgoShort(me.cachedAt))})</div>`
    : me.refreshError ? `<div class="muted" style="font-size:12px;margin-top:6px">${icon('alert')} Couldn't refresh — mxb-ranked is slow. Showing your profile from ${esc(timeAgoShort(me.cachedAt))}. <a href="#" data-act="rk-retry-profile">Try again</a></div>` : '';
  el.innerHTML = profileHtml(me) + status;
}
function timeAgoShort(t) { return t ? window.timeAgo(t) : 'earlier'; }

async function rkLoad(key, ch) {
  if (S.rk.cache[key] === undefined) {
    const v = await api.invoke(ch).catch((e) => ({ error: cleanErr(e) }));
    if (v && v.error) return v; // don't remember failures, so switching tabs retries
    S.rk.cache[key] = v;
  }
  return S.rk.cache[key];
}

async function drawRkBody() {
  const body = $('#rkBody');
  if (!body) return;
  const tab = S.rk.tab;
  body.innerHTML = '<div class="loadmore"><div class="spinner"></div></div>';
  let html = '';
  if (tab === 'servers') {
    const list = await rkLoad('servers', 'ranked:servers');
    if (list.error) html = `<div class="notice warn">${icon('alert')}<div>${esc(list.error)}</div></div>`;
    else {
      const f = S.rk.f;
      const rows = list.map((s) => ({ s, j: canJoin(s, S.rk.me) }));
      const cats = [...new Set(list.map((s) => s.category).filter(Boolean))];
      const bikes = [...new Set(list.flatMap((s) => s.bikes.split('/').map((b) => b.trim())).filter(Boolean))];
      let xs = rows;
      if (f.join === 'can') xs = xs.filter((r) => r.j.ok);
      if (f.join === 'busy') xs = xs.filter((r) => r.s.players > 0);
      if (f.cat) xs = xs.filter((r) => r.s.category === f.cat);
      if (f.bikes) xs = xs.filter((r) => r.s.bikes.split('/').map((b) => b.trim()).includes(f.bikes));
      const pill = (key, label, on) => `<button class="pill-btn ${on ? 'on' : ''}" data-rkf="${key}">${esc(label)}${icon('chevdown')}</button>`;
      S.rk.menus = {
        join: [{ value: 'all', label: 'All servers' }, { value: 'can', label: 'Ones I can join', count: rows.filter((r) => r.j.ok).length }, { value: 'busy', label: 'Has riders now', count: rows.filter((r) => r.s.players > 0).length }],
        cat: [{ value: '', label: 'All categories' }, ...cats.map((x) => ({ value: x, label: x, count: list.filter((s) => s.category === x).length }))],
        bikes: [{ value: '', label: 'All bikes' }, ...bikes.map((x) => ({ value: x, label: x }))],
      };
      html = `<div class="filters" style="padding:0 0 14px">
          ${pill('join', f.join === 'can' ? 'Ones I can join' : f.join === 'busy' ? 'Has riders now' : 'All servers', f.join !== 'all')}
          ${pill('cat', f.cat || 'Category', !!f.cat)}${pill('bikes', f.bikes || 'Bikes', !!f.bikes)}
          <span class="count">${xs.length} server${xs.length === 1 ? '' : 's'} · ${list.reduce((a, s) => a + s.players, 0)} riding now</span></div>
        <div class="rk-srv-grid">${xs.map(({ s, j }) => `<div class="rk-srv" data-rk-srv="${esc(s.name)}" style="cursor:pointer">
          <div class="rk-srv-img">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}<span class="badge ${s.players ? 'ok' : ''}" style="position:absolute;top:10px;left:10px">${icon('user')}${s.players} riding</span>
            ${s.rank ? `<span class="badge" title="${esc(s.rankTitle)}" style="position:absolute;top:10px;right:10px">${esc(s.rank)}</span>` : ''}</div>
          <div class="rk-srv-body"><div class="t">${esc(s.name)}</div><div class="muted" style="font-size:12.5px;margin:2px 0 8px">${esc(s.description)}</div>
            <div class="tags"><span class="tag">${esc(s.category)}</span><span class="tag">${esc(s.bikes)}</span></div>
            <div class="rk-can ${j.ok ? 'ok' : 'no'}">${icon(j.ok ? 'check' : 'x')}${esc(j.why)}</div></div></div>`).join('') || '<div class="muted">No servers match these filters.</div>'}</div>`;
    }
  } else if (tab === 'results') {
    const list = await rkLoad('results', 'ranked:results');
    html = list.error ? `<div class="notice warn">${icon('alert')}<div>${esc(list.error)}</div></div>`
      : `<div class="glist">${list.map((r) => `<div class="rk-race" ${r.link ? `data-ranked-open="${esc(r.link)}"` : ''}>
          <div class="rk-pos">${esc(r.category)}</div><div class="rk-race-t"><div class="t">${esc(r.track)}</div><div class="m">${esc((r.server || '').replace(/^MXB-Ranked\.com \| /, ''))}</div></div>
          <div class="m">${icon('user')}${esc(r.players)}</div><div class="m">${esc(r.weather)}</div><div class="m" title="${esc(r.finishedAt || '')}" style="min-width:110px;justify-content:flex-end">${esc(r.finished)}</div></div>`).join('')}</div>`;
  } else if (tab === 'records') {
    const list = await rkLoad('records', 'ranked:records');
    html = list.error ? `<div class="notice warn">${icon('alert')}<div>${esc(list.error)}</div></div>`
      : `<div class="glist">${list.map((r) => `<div class="rk-race" ${r.link ? `data-ranked-open="${esc(r.link)}"` : ''}>
          <div class="rk-pos gold" style="min-width:84px">${esc(r.time)}</div><div class="rk-race-t"><div class="t">${esc(r.track)}</div><div class="m">${esc(r.holder)}</div></div>
          <div class="m">${esc(r.bike)}</div><div class="m">${esc(r.category)}</div><div class="m" style="min-width:140px;justify-content:flex-end">${esc(r.date)}</div></div>`).join('')}</div>`;
  } else if (tab === 'tracks') {
    const list = await rkLoad('tracks', 'ranked:tracks');
    if (list.error) html = `<div class="notice warn">${icon('alert')}<div>${esc(list.error)}</div></div>`;
    else {
      const q = (S.rk.trackQ || '').toLowerCase();
      const act = list.filter((t) => t.active && (!q || t.name.toLowerCase().includes(q)));
      html = `<div class="filters" style="padding:0 0 14px"><div class="search">${icon('search')}<input id="rkTrackQ" placeholder="Search ranked tracks…" value="${esc(S.rk.trackQ || '')}"></div><span class="count">${act.length} active tracks</span></div>
        <div class="grid">${act.slice(0, 120).map((t) => {
          const have = trackInstalled(t.name);
          return `<div class="card"><div class="thumb">${t.image ? `<img src="${esc(t.image)}" loading="lazy" alt="">` : ''}<div class="badges">${have ? `<span class="badge ok">${icon('check')}Installed</span>` : ''}${t.free === false ? '<span class="badge warn">Paid</span>' : ''}</div></div>
            <div class="card-body"><div class="card-title" title="${esc(t.name)}">${esc(t.name)}</div><div class="card-meta">${t.note ? esc(t.note) : t.random ? 'In random rotation' : ''}</div>
            ${have ? '' : `<button class="btn btn-sm" style="margin-top:6px" data-rk-get="${esc(t.name)}">${icon('search')}Get track</button>`}</div></div>`;
        }).join('')}</div>`;
    }
  } else if (tab === 'news') {
    const list = await rkLoad('news', 'ranked:news');
    html = list.error ? `<div class="notice warn">${icon('alert')}<div>${esc(list.error)}</div></div>`
      : list.map((n) => `<div class="set-card" style="margin-bottom:12px"><h3>${esc(n.title)}</h3><p>${esc(n.date || '')}</p>${n.body.map((b) => `<div style="color:var(--text-2);font-size:13.5px;margin-bottom:6px">${esc(b)}</div>`).join('')}</div>`).join('');
  } else if (tab === 'season') {
    const s = await rkLoad('season', 'ranked:season');
    html = s.error ? `<div class="notice warn">${icon('alert')}<div>${esc(s.error)}</div></div>`
      : s.rows.length ? `<div class="glist">${s.rows.map((r) => `<div class="rk-race"><div class="rk-pos">${esc(r.Rank || '')}</div><div class="rk-race-t"><div class="t">${esc(r.Rider || '')}</div><div class="m">${esc(r['Total Races'] || '')} races · ${esc(r.Wins || '0')} wins · ${esc(r.Podiums || '0')} podiums · avg ${esc(r['Avg Position'] || '—')}</div></div></div>`).join('')}</div>`
      : `<div class="set-card muted" style="text-align:center">${esc(s.title || 'This season')} has no standings yet${s.dates ? ` (${esc(s.dates)})` : ''}.</div>`;
  }
  if (S.rk.tab === tab && $('#rkBody')) {
    $('#rkBody').innerHTML = html;
    const tq = $('#rkTrackQ');
    if (tq) tq.addEventListener('input', () => { S.rk.trackQ = tq.value; clearTimeout(tq._t); tq._t = setTimeout(() => { drawRkBody().then(() => { const n = $('#rkTrackQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); });
  }
}

// Server details popup: read live from mxb-ranked in the background, then join.
async function openRankedServer(name) {
  const s = (S.rk.cache.servers || []).find((x) => x.name === name) || { name, ratings: [], rankTitle: '' };
  const j = canJoin(s, S.rk.me);
  const m = modal({ title: esc(name), size: 'md', body: `<div class="loadmore"><div class="spinner"></div></div><div class="muted" style="text-align:center">Loading live details from mxb-ranked…</div>` });
  let d;
  try { d = await api.invoke('ranked:details', name); } catch (e) { $('.modal-body', m).innerHTML = `<div class="notice danger">${icon('alert')}<div>${esc(cleanErr(e))}</div></div>`; return; }
  if (!m.isConnected) return;
  const have = (t) => trackInstalled(t);
  const missing = d.tracks.filter((t) => !have(t.name));
  const lobbyName = (l) => `MXB-Ranked.com | ${name} | ${l.region}`;
  $('.modal-body', m).innerHTML = `
    ${s.image ? `<div class="gallery-main" style="aspect-ratio:21/8;margin-bottom:14px"><img src="${esc(s.image)}" data-keep="1" style="object-fit:cover"></div>` : ''}
    <div class="muted" style="margin-bottom:10px">${esc(s.description || '')}</div>
    <div class="tags"><span class="tag">${esc(s.category || '')}</span><span class="tag">${esc(s.bikes || '')}</span>${s.rankTitle ? `<span class="tag">${esc(s.rankTitle)}</span>` : ''}${s.ratings && s.ratings.length ? `<span class="tag">Ratings ${esc(s.ratings.join(' '))}</span>` : ''}${d.eventEnds ? `<span class="tag">Ends ${esc(d.eventEnds)}</span>` : ''}</div>
    <div class="rk-can ${j.ok ? 'ok' : 'no'}" style="margin:4px 0 12px">${icon(j.ok ? 'check' : 'x')}${esc(j.why)}</div>
    ${d.notes.map((n) => `<div class="notice info">${icon('info')}<div>${esc(n)}</div></div>`).join('')}
    <div class="section-title">Lobbies</div>
    <div class="glist">${d.lobbies.map((l, i) => `<div class="rk-race"><div class="rk-pos" style="min-width:60px">${esc(l.region)}</div>
      <div class="rk-race-t"><div class="t">${esc(l.track || '—')}</div><div class="m">${esc(l.status || '')}${l.time ? ` · ${esc(l.time)}` : ''}</div></div>
      <div class="m">${icon('user')}${esc(l.players || '')}</div>
      <button class="btn btn-sm btn-primary" data-rk-join="${i}">${icon('play')}Join</button></div>`).join('') || '<div class="rk-race muted">No lobbies running right now.</div>'}</div>
    <div class="section-title">Tracks${missing.length ? ` · ${missing.length} not installed` : ' · all installed'}</div>
    <div class="glist">${d.tracks.map((t) => `<div class="rk-race"><div class="rk-race-t"><div class="t">${esc(t.name)}</div><div class="m">Difficulty ${esc(t.difficulty || '—')}${t.bonus ? ` · MXP bonus ${esc(t.bonus)}` : ''}</div></div>
      ${have(t.name) ? `<span class="have">${icon('check')}Installed</span>` : `<button class="btn btn-sm" data-rk-get="${esc(t.name)}">${icon('search')}Get track</button>`}</div>`).join('')}</div>`;
  $('.modal-body', m).addEventListener('click', async (e) => {
    const jb = e.target.closest('[data-rk-join]');
    if (jb) {
      const l = d.lobbies[Number(jb.dataset.rkJoin)];
      if (missing.length && !(await window.confirmBox('Missing tracks', `You don't have <b>${missing.map((t) => esc(t.name)).join(', ')}</b>. Join anyway?`, 'Join anyway'))) return;
      navigator.clipboard.writeText(lobbyName(l));
      try { await api.invoke('game:launch'); } catch {}
      toast(`Opening MX Bikes — the server name <b>${esc(lobbyName(l))}</b> is copied. In Multiplayer, search for it and join.`, 'info', 9000);
    }
  });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-rk-tab]');
  if (t) { S.rk.tab = t.dataset.rkTab; $$('[data-rk-tab]').forEach((b) => b.classList.toggle('active', b === t)); drawRkBody(); return; }
  const f = e.target.closest('[data-rkf]');
  if (f) { const k = f.dataset.rkf; openMenu(f, S.rk.menus[k], S.rk.f[k], (v) => { S.rk.f[k] = v; drawRkBody(); }); return; }
  const sv = e.target.closest('[data-rk-srv]');
  if (sv) { openRankedServer(sv.dataset.rkSrv); return; }
  const g = e.target.closest('[data-rk-get]');
  if (g) { for (const w of $$('.modal-wrap')) w.close(); findTrack(g.dataset.rkGet); return; }
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'rk-allraces') { S.rk.showAllRaces = !S.rk.showAllRaces; renderRanked($('#content')); }
});

document.addEventListener('click', async (e) => {
  const o = e.target.closest('[data-ranked-open]');
  if (o) { e.preventDefault(); api.invoke('ranked:open', o.dataset.rankedOpen); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'ranked-refresh') renderRanked($('#content'), true);
  if (a.dataset.act === 'rk-retry-profile') {
    e.preventDefault();
    S.rk.me = S.rk.me && S.rk.me.found ? { ...S.rk.me, refreshing: true, refreshError: null } : { loading: true };
    drawProfile(); loadProfile();
  }
  if (a.dataset.act === 'ranked-change') { S.rk.me = { found: false }; renderRanked($('#content')); }
  if (a.dataset.act === 'ranked-guid') {
    try { await api.invoke('ranked:setGuid', $('#rkGuid').value.trim()); S.rk.me = null; renderRanked($('#content')); }
    catch (err) { toast(esc(cleanErr(err)), 'err'); }
  }
});
