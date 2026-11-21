/* global S, $, esc, icon, toast, api, go, renderRail */
'use strict';
// ---------- Onboarding: explainer pages in first-run setup, a live tour, and first-visit tips ----------
// Pictures are real CoreMX screenshots of a demo library (src/renderer/onboarding/*.jpg); the numbered
// markers are drawn on top, at percentages of the picture, so they stay sharp in any window size.

const OB_PAGES = {
  get: {
    title: 'Get mods in one click', img: 'onboarding/get.jpg',
    intro: 'Browse mxb-mods.com and the paid shops without leaving CoreMX. Install puts every file in the right folder for you.',
    marks: [
      { x: 21, y: 23, t: 'Search', d: 'Find bikes, tracks, gear and liveries by name.' },
      { x: 30, y: 31, t: 'Categories', d: 'Narrow the list down: tracks, new bikes, helmets, sounds and more.' },
      { x: 67, y: 10, t: 'Free and paid', d: 'Free mods from mxb-mods.com, or your purchases from MXB Hub and MX Bikes Shop.' },
      { x: 9, y: 87, t: 'View & install', d: 'Opens the mod. Install downloads it and puts it where MX Bikes looks for it.' },
    ],
  },
  library: {
    title: 'Everything you have installed', img: 'onboarding/library.jpg',
    intro: 'My Mods shows every bike, track and mod in your game, with pictures. Turn mods off, find duplicates and see updates here.',
    marks: [
      { x: 17, y: 33, t: 'Types', d: 'Bikes, tracks, tyres, graphics, plugins, animations, and programs or design files you downloaded (Apps).' },
      { x: 74, y: 9, t: 'Search', d: 'Find any installed mod.' },
      { x: 92, y: 9, t: 'Add mod from PC', d: 'Got a mod as a file? Drop it on the window or pick it here; CoreMX works out where it goes.' },
      { x: 12, y: 62, t: 'Your mods', d: 'Click one for details, pictures, or to delete it (it goes to the Recycle Bin).' },
    ],
  },
  rider: {
    title: 'Dress your rider', img: 'onboarding/rider.jpg',
    intro: 'Pick helmet, goggles, kit, gloves and boots for each bike and see them in 3D before you ride.',
    marks: [
      { x: 18, y: 6, t: 'Outfit, Bike, My gear', d: 'Your outfit, your bike and its livery, and all the gear you have (Synced from friends is there too).' },
      { x: 22, y: 60, t: '3D preview', d: 'Drag to turn, scroll to zoom. Changes show here first.' },
      { x: 69, y: 67, t: 'Gear', d: 'Click any piece to change it.' },
      { x: 95, y: 6, t: 'Apply', d: 'Saves your setup to the game. In game, press F8 (with the CoreMX plugin) to change it on track.' },
    ],
  },
  play: {
    title: 'Ride straight away', img: 'onboarding/play.jpg',
    intro: 'Pick a bike and a track and CoreMX opens MX Bikes with both already set.',
    marks: [
      { x: 20, y: 74, t: 'Bike', d: 'Any bike you have.' },
      { x: 54, y: 74, t: 'Track', d: 'Any track you have.' },
      { x: 9, y: 56, t: 'Ride', d: 'Opens the game ready to go. Choose Single Player in the game.' },
      { x: 18, y: 7, t: 'Game settings', d: 'Graphics and game options without opening the game.' },
    ],
  },
  friends: {
    title: 'Ride with friends', img: 'onboarding/friends.jpg',
    intro: 'Add friends from Steam to see where they ride, join them in one click, and see each other\'s gear in game.',
    marks: [
      { x: 13, y: 69, t: 'Add friends', d: 'Pick them from your Steam friends. Both of you add each other.' },
      { x: 22, y: 9, t: 'Leaderboard', d: 'Your best laps against your friends on the last tracks you rode, with a Challenge button.' },
      { x: 30, y: 9, t: 'Sync settings', d: 'What you share. Gear you get from friends is cleaned up when nobody needs it any more.' },
      { x: 13, y: 88, t: 'Online', d: 'Friends and gear sharing need Sign in with Steam (next page).' },
    ],
  },
};

function obPageHtml(id) {
  const p = OB_PAGES[id];
  return `<h2 class="setup-h">${esc(p.title)}</h2><p class="setup-p">${esc(p.intro)}</p>
    <div class="ob-shot"><img src="${esc(p.img)}" alt="">${p.marks.map((m, i) => `<span class="ob-mark" style="left:${m.x}%;top:${m.y}%">${i + 1}</span>`).join('')}</div>
    <ol class="ob-legend">${p.marks.map((m) => `<li><b>${esc(m.t)}</b> ${esc(m.d)}</li>`).join('')}</ol>`;
}

// Online: sign in with Steam (Steam's own page in the browser) and the optional game plugin.
function obOnlineHtml() {
  const st = S.live && S.live.status, sv = st && st.service, p = st && st.plugin;
  const signedIn = !!(sv && sv.connected);
  return `<h2 class="setup-h">Online features</h2><p class="setup-p">Optional, and you can do this later in Friends. Nothing is sent until you choose to.</p>
    <div class="set-card ob-online"><div class="ob-online-row">${icon('steam')}<div><b>Sign in with Steam</b><span class="muted">Friends, live servers, the leaderboard and gear sharing use your Steam account. Steam's own sign-in page opens in your browser; CoreMX never sees your password.</span></div>
      ${sv && sv.signingIn ? '<span class="muted">Waiting for Steam…</span>'
        : signedIn && sv.verified === false ? `<button class="btn btn-primary" data-ob-signin>${icon('steam')}Verify with Steam</button>`
        : signedIn ? `<span class="ok-chip">${icon('check')}Signed in</span>`
        : `<button class="btn btn-primary" data-ob-signin>${icon('steam')}Sign in</button>`}</div>${signedIn && sv.verified === false ? '<p class="muted" style="margin:8px 0 0 40px">Your account was made before CoreMX signed in with Steam. Verifying once confirms this Steam ID is really yours; your friends and settings stay.</p>' : ''}</div>
    <div class="set-card ob-online"><div class="ob-online-row">${icon('box')}<div><b>CoreMX game plugin</b><span class="muted">Shows friends in their own gear in game, tells CoreMX which server you're on, and adds the in-game overlay: press <b>F8</b> in MX Bikes to change your gear or see the riders on your server.</span></div>
      ${p && p.installed ? `<span class="ok-chip">${icon('check')}Installed</span>` : p && p.available ? `<button class="btn" data-ob-plugin>${icon('download')}Install</button>` : '<span class="muted">Set your game folder first</span>'}</div></div>`;
}

document.addEventListener('click', async (e) => {
  const signin = e.target.closest('[data-ob-signin]');
  if (signin) {
    signin.disabled = true;
    try { S.live.status = await api.invoke('online:signIn'); toast('Signed in with Steam', 'ok', 2500); }
    catch (err) { toast(esc(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')), 'err', 6000); }
    if (typeof drawSetup === 'function' && $('#setup')) drawSetup();
    return;
  }
  const plugin = e.target.closest('[data-ob-plugin]');
  if (plugin) {
    plugin.disabled = true;
    try { S.live.status = await api.invoke('online:pluginInstall'); toast('Plugin installed: it starts next time you open MX Bikes', 'ok', 4000); }
    catch (err) { toast(esc(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')), 'err', 6000); }
    if (typeof drawSetup === 'function' && $('#setup')) drawSetup();
  }
});

// ---------- "Show me around": highlights the real buttons, one at a time ----------
const TOUR = [
  { sel: '.rail-btn[data-view="library"]', t: 'My Mods', d: 'Everything installed in your game. Start here.' },
  { sel: '.rail-btn[data-view="get"]', t: 'Get Mods', d: 'Browse and install mods from mxb-mods.com and the shops.' },
  { sel: '.rail-btn[data-view="packs"]', t: 'OEM Packs', d: 'The official bike packs most servers use. Updates download only what changed.' },
  { sel: '.rail-btn[data-view="rider"]', t: 'Rider', d: 'Your outfit, bike and livery, in 3D. Apply saves them to the game.' },
  { sel: '.rail-btn[data-view="game"]', t: 'Play', d: 'Pick a bike and track and ride.' },
  { sel: '.rail-btn[data-view="online"]', t: 'Online', d: 'Live servers with CoreMX riders, recent servers, Ranked and hosting your own.' },
  { sel: '.rail-btn[data-view="friends"]', t: 'Friends', d: 'Where your friends ride, the leaderboard, and gear sharing.' },
  { sel: '.top-icon[data-view="downloads"]', t: 'Downloads', d: 'Downloads, installs and mod updates.' },
  { sel: '.top-icon[data-view="settings"]', t: 'Settings', d: 'Folders, the game plugin and more. You can run this setup again from here.' },
  { sel: '.top-icon[data-help]', t: 'Help', d: 'Explains the page you are on. Click it any time.' },
];
let tourAt = -1;
function startTour() { tourAt = 0; drawTour(); }
function endTour() { tourAt = -1; $('#obTour')?.remove(); }
function drawTour() {
  let el = $('#obTour');
  const step = TOUR[tourAt];
  if (!step) return endTour();
  const target = document.querySelector(step.sel);
  if (!target) { tourAt++; return drawTour(); }
  if (!el) { el = document.createElement('div'); el.id = 'obTour'; el.className = 'ob-tour'; document.body.appendChild(el); }
  const r = target.getBoundingClientRect(), pad = 6;
  const left = Math.max(12, Math.min(window.innerWidth - 332, r.left + r.width / 2 - 160));
  el.innerHTML = `<div class="ob-spot" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
    <div class="ob-bubble" style="left:${left}px;top:${r.bottom + 14}px"><div class="ob-bubble-step">${tourAt + 1} of ${TOUR.length}</div><b>${esc(step.t)}</b><p>${esc(step.d)}</p>
      <div class="ob-bubble-foot"><button class="btn btn-ghost btn-sm" data-tour="end">Skip tour</button><span class="grow"></span>${tourAt ? '<button class="btn btn-sm" data-tour="back">Back</button>' : ''}<button class="btn btn-primary btn-sm" data-tour="next">${tourAt === TOUR.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tour]');
  if (!b) return;
  if (b.dataset.tour === 'end') return endTour();
  tourAt += b.dataset.tour === 'back' ? -1 : 1;
  drawTour();
});
window.addEventListener('resize', () => { if (tourAt >= 0) drawTour(); });

// ---------- First-visit tips, and the Help (?) button ----------
const TIPS = {
  library: ['My Mods', 'Every mod in your game. Click one for details; turn mods off without deleting them; use the tabs for tracks, plugins, graphics and more.'],
  get: ['Get Mods', 'Search or browse, then Install. CoreMX puts the files in the right place. Paid shops: link your account under Settings to install what you bought.'],
  packs: ['OEM Packs', 'The official bike packs. Update downloads only the bikes that are new or changed.'],
  rider: ['Rider', 'Pick your gear, check it in 3D, then Apply to save it to the game. Each bike can have its own outfit.'],
  game: ['Play', 'Choose a bike and a track and press Ride: MX Bikes opens with both set. Game settings has graphics and options.'],
  graphics: ['Graphics', 'Graphics mods and presets for MX Bikes. Anything they replace is backed up so you can undo it.'],
  online: ['Online', 'Servers with CoreMX riders on them, with who is riding. Join checks you have the track and the bikes. Host runs your own server.'],
  friends: ['Friends', 'Add friends from Steam, see where they ride and join them. Leaderboard compares your best laps; Sync settings controls what you share.'],
  downloads: ['Downloads', 'Your downloads and installs, and updates for mods you installed with CoreMX.'],
  settings: ['Settings', 'Your game folders, the game plugin, the in-game overlay key, and Run setup again.'],
};
function showTip(view, force) {
  const tip = TIPS[view];
  if (!tip) { if (force) startTour(); return; }
  const seen = (S.env && S.env.settings && S.env.settings.tipsSeen) || {};
  if (!force && seen[view]) return;
  $('#obTip')?.remove();
  const el = document.createElement('div');
  el.id = 'obTip'; el.className = 'ob-tip';
  el.innerHTML = `<div class="ob-tip-head">${icon('info')}<b>${esc(tip[0])}</b><button class="btn btn-ghost btn-icon btn-sm" data-tip="close" aria-label="Close">${icon('x')}</button></div><p>${esc(tip[1])}</p><div class="ob-tip-foot"><button class="btn btn-ghost btn-sm" data-tip="tour">Show me around</button><button class="btn btn-primary btn-sm" data-tip="close">Got it</button></div>`;
  document.body.appendChild(el);
  if (!seen[view]) api.invoke('settings:set', { tipsSeen: { ...seen, [view]: true } }).then((env) => { S.env = env; }).catch(() => {});
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t) { $('#obTip')?.remove(); if (t.dataset.tip === 'tour') startTour(); return; }
  if (e.target.closest('[data-help]')) showTip(S.view, true);
});
// First visit of each page, once setup is done (not on top of the setup screens).
function maybeShowTip(view) {
  if (!S.env || !S.env.settings || !S.env.settings.setupDone || $('#setup') || tourAt >= 0) return;
  setTimeout(() => { if (S.view === view && !$('#setup')) showTip(view, false); }, 700);
}
