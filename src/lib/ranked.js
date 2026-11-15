// mxb-ranked.com, read from its public pages (no login needed).
// A Steam player's MX Bikes GUID is "FF" + their SteamID64 as 16 hex digits — the same ID the site uses.
const cheerio = require('cheerio');
// Node's fetch (not Electron's net): the site's Cloudflare rejects Electron's request fingerprint.
const HTML_HEADERS = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };

const BASE = 'https://mxb-ranked.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function guidFromSteam(id64) {
  try { return 'FF' + BigInt(id64).toString(16).toUpperCase().padStart(16, '0'); } catch { return null; }
}
function normaliseGuid(raw) {
  const m = String(raw || '').toUpperCase().match(/[0-9A-F]{18}/);
  return m ? m[0] : null;
}

// The site is sometimes very slow (profile pages can take 25s+), so every request has a time limit
// and one retry instead of waiting forever.
async function page(pathname, { timeout = 18000, tries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + pathname, { headers: { 'User-Agent': UA, ...HTML_HEADERS }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`mxb-ranked.com returned HTTP ${res.status}`);
      return cheerio.load(await res.text());
    } catch (e) {
      lastErr = e.name === 'TimeoutError' || e.name === 'AbortError' ? new Error('mxb-ranked.com is responding very slowly right now') : e;
    }
  }
  throw lastErr;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const abs = (u) => (!u ? null : /^https?:/.test(u) ? u : `${BASE}/${u.replace(/^\//, '')}`);

// Rows of a MudBlazor table as objects keyed by each cell's data-label.
function tableRows($, table) {
  const rows = [];
  $(table).find('tbody tr').each((_, tr) => {
    const row = {};
    $(tr).find('td').each((__, td) => {
      const label = $(td).attr('data-label');
      if (!label) { const a = $(td).find('a[href]').attr('href'); if (a) row._link = abs(a); return; }
      const $td = $(td);
      let v = clean($td.text());
      // MXP chips carry an up/down arrow instead of a sign
      if ($td.find('.fa-arrow-down').length && v && !v.startsWith('-')) v = '-' + v;
      row[label] = v;
      if ($td.attr('title')) row[label + '_title'] = $td.attr('title');
      const color = $td.find('.fa-square').attr('style');
      if (color) row[label + '_color'] = (color.match(/color:\s*([^;]+)/) || [])[1];
    });
    if (Object.keys(row).length) rows.push(row);
  });
  return rows;
}

async function profile(guid) {
  guid = normaliseGuid(guid);
  if (!guid) throw new Error("That isn't a valid MX Bikes GUID");
  const $ = await page(`/Rider/${guid}`);
  const name = clean($('.mud-chip h6').first().text());
  const exp = clean($('h6').filter((_, h) => /\bEXP\b/.test($(h).text())).first().text());
  if (!name) return { found: false, guid, url: `${BASE}/Rider/${guid}` };
  const banner = ($('[style*="Achievements"]').attr('style') || '').match(/url\(['"&#x27;]*([^'")&]+)/);
  const ratingEl = $('[class*="playerRating-"]').first();
  const rating = clean(ratingEl.text());
  const member = clean($('p').filter((_, p) => /Member since/.test($(p).text())).first().text()).replace(/^Member since:\s*/, '');
  const penalty = clean($('p').filter((_, p) => /Penalty Points/.test($(p).text())).first().text());
  const flag = ($('.flag').attr('class') || '').match(/\bf-([a-z]{2})\b/);
  let races = [];
  $('table').each((_, t) => { if (/Last 50|Server/.test($(t).find('th').text())) races = tableRows($, t); });
  // Season stats carousel (when the rider has races this season)
  const stats = [];
  $('.mud-carousel-item').each((_, it) => {
    const txt = clean($(it).text());
    if (txt && !/No Season Data/i.test(txt)) stats.push(txt);
  });
  const season = clean($('input[aria-label="Selected Season"]').closest('.mud-select').text()) || null;
  return {
    found: true, guid, url: `${BASE}/Rider/${guid}`, name, exp: parseInt(exp) || 0,
    rating, member, penalty, country: flag ? flag[1] : null,
    banner: banner ? abs(banner[1]) : null, stats, season,
    races: races.map((r) => ({
      server: r.Server, track: r.Track, category: r.Category, position: r.Position, bike: r.Bike, bikeColor: r.Bike_color,
      mxp: r.MXP, globalMxp: r['Global MXP'], penalty: r['Pen. Points'], finished: r.Finished, finishedAt: r.Finished_title, link: r._link,
    })),
  };
}

async function servers() {
  const $ = await page('/Multiplayer');
  const out = [];
  $('h5').each((_, h) => {
    const card = $(h).closest('.mud-paper');
    if (!card.length || !/Current Players/.test(card.text())) return;
    const lines = (label) => clean(card.find('p').filter((__, p) => $(p).text().trim().startsWith(label)).first().text()).replace(label, '').trim();
    const rankEl = card.find('[title*="Rank"]').first();
    out.push({
      name: clean($(h).text()),
      players: parseInt(lines('Current Players:')) || 0,
      rank: clean(rankEl.text()), rankTitle: rankEl.attr('title') || '',
      ratings: card.find('[title="Allowed Ratings"] strong').map((__, s) => clean($(s).text())).get(),
      image: abs(card.find('img').first().attr('src')),
      description: clean(card.find('h6').first().text()),
      mode: lines('Game Mode:'), category: lines('Category:'), bikes: lines('Bikes:'),
    });
  });
  return out.sort((a, b) => b.players - a.players);
}

async function seasonRanks() {
  const $ = await page('/SeasonRanks');
  const title = clean($('h5, h6').filter((_, h) => /^Season \d+/.test($(h).text().trim())).first().text());
  const dates = clean($('p').filter((_, p) => /Start:|End:/.test($(p).text())).map((_, p) => $(p).text()).get().join(' · '));
  let rows = [];
  $('table').each((_, t) => { const r = tableRows($, t); if (r.length) rows = r; });
  return { title, dates, rows: rows.slice(0, 100) };
}

async function results() {
  const $ = await page('/Results');
  let rows = [];
  $('table').each((_, t) => { const r = tableRows($, t); if (r.length) rows = r; });
  return rows.map((r) => ({ server: r.Server, track: r.Track, category: r.Category, players: r.Players, weather: r.Weather, finished: r.Finished, finishedAt: r.Finished_title, link: r._link }));
}

async function records() {
  const $ = await page('/Records');
  let rows = [];
  $('table').each((_, t) => { const r = tableRows($, t); if (r.length) rows = r; });
  return rows.map((r) => ({ track: r.Track, type: r.Type, time: r['WR Time'], holder: r['WR Holder'], bike: r.Bike, category: r.Category, date: r.Date, link: r._link }));
}

async function tracks() {
  const $ = await page('/Tracks');
  const out = [];
  $('h6').each((_, h) => {
    const card = $(h).closest('.mud-paper');
    if (!card.length || !/Active:/.test(card.text())) return;
    const flag = (label) => {
      const row = card.find('p').filter((__, p) => $(p).text().trim() === label).first().parent();
      const t = row.find('svg title').first().text().trim();
      return t ? t === 'Yes' : null;
    };
    const note = clean(card.find('p').filter((__, p) => /^Note:/.test($(p).text().trim())).first().text()).replace(/^Note:\s*/, '');
    const rating = card.find('.mud-rating-item.mud-rating-item-active, .mud-rating-item svg.mud-icon-size-medium').length;
    out.push({
      name: clean($(h).text()), image: abs(card.find('img').first().attr('src')),
      category: clean(card.closest('.mud-tabs-panels, .mud-expand-panel, section').find('h5,h4').first().text()) || null,
      active: flag('Active:'), random: flag('Approved for Random Track Lists:'), free: flag('Free:'), note: note || null,
    });
  });
  return out;
}

async function announcements() {
  const $ = await page('/Announcements');
  const out = [];
  $('.mud-card, .mud-paper').each((_, c) => {
    const title = clean($(c).find('h5, h6').first().text());
    if (!title || /Search by GUID/.test(title)) return;
    const body = $(c).find('p, li').map((__, p) => clean($(p).text())).get().filter(Boolean);
    const date = body.find((t) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) || clean($(c).find('.mud-typography-caption, small').first().text());
    if (body.length < 1) return;
    out.push({ title, date, body: body.filter((t) => t !== date).slice(0, 40) });
  });
  // drop nested duplicates (a card inside another paper)
  return out.filter((a, i) => out.findIndex((b) => b.title === a.title) === i).slice(0, 30);
}

// Turn the text the site adds when "Details" is clicked into lobbies + track rotation.
function parseDetails(lines, imgs) {
  const out = { lobbies: [], tracks: [], notes: [], eventEnds: null, ratings: null };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const lob = l.match(/^([A-Z]{2,5}) #(\d+)$/);
    if (lob) {
      const lobby = { region: lob[1], id: lob[2], status: null, time: null, track: null, players: null };
      for (let j = i + 1; j < Math.min(lines.length, i + 20); j++) {
        const x = lines[j].trim();
        if (/^[A-Z]{2,5} #\d+$/.test(x) || /^(?:Tracks|Track List|Track Rotation|BACK)$/i.test(x)) break;
        const address = x.match(/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/);
        if (address && address[1].split('.').every((v) => Number(v) <= 255) && Number(address[2]) <= 65535) lobby.address = address[0];
        if (x.startsWith('Status:')) lobby.status = x.replace('Status:', '').trim();
        else if (/^-\s*\S/.test(x)) lobby.time = x.replace(/^-\s*/, '');
        else if (x.startsWith('Current Track:')) lobby.track = x.replace('Current Track:', '').trim();
        else if (/^\d+\/\d+$/.test(x)) lobby.players = x;
      }
      out.lobbies.push(lobby);
    } else if (/^Difficulty:/.test(lines[i + 1] || '') && !/^(Status|Current Track|Event Ends)/.test(l)) {
      const t = { name: l, difficulty: (lines[i + 1] || '').replace('Difficulty:', '').trim(), bonus: null };
      if (/^MXP Bonus:/.test(lines[i + 2] || '')) t.bonus = lines[i + 2].replace('MXP Bonus:', '').trim();
      out.tracks.push(t);
    } else if (l.startsWith('Event Ends:')) out.eventEnds = l.replace('Event Ends:', '').trim() || null;
    else if (/^[A-Z0-9 !'’,.-]{12,}$/.test(l) && !/^(LOGIN|BACK|ACCEPT)$/.test(l)) out.notes.push(l);
  }
  out.images = imgs || [];
  return out;
}

// PiBoSo's official stats server list (stats.mx-bikes.com/servers.php). Only servers registered for
// official stats appear there, so it is often empty.
async function officialServers() {
  const res = await fetch('https://stats.mx-bikes.com/servers.php', { headers: { 'User-Agent': UA, ...HTML_HEADERS } });
  if (!res.ok) throw new Error(`stats.mx-bikes.com returned HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const out = [];
  $('.content table tr').each((i, tr) => {
    const td = $(tr).find('td');
    if (td.length < 10) return;
    const cell = (n) => clean($(td[n]).text());
    const link = $(tr).find('a[href]').map((_, a) => $(a).attr('href')).get().find((h) => /mxbikes:|connect|\d+\.\d+\.\d+\.\d+/i.test(h)) || null;
    const addr = (String(link || '') + ' ' + $(tr).text()).match(/(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})/);
    out.push({
      name: cell(0), dedicated: !!cell(1), password: !!cell(2), riders: cell(3), track: cell(4), category: cell(5),
      length: cell(6), hardcore: !!cell(7), weather: cell(8), status: cell(9), rating: cell(10),
      address: addr ? addr[1] : null, link,
    });
  });
  return out;
}

module.exports = { guidFromSteam, normaliseGuid, profile, servers, seasonRanks, results, records, tracks, announcements, parseDetails, officialServers, BASE };
