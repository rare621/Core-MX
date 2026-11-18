'use strict';

const BASE = 'https://coremx.app';
let websiteCookie = '';
async function websiteRequest(route, options = {}) {
  const headers = { Accept: 'application/json', 'X-MCTG': '1', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(websiteCookie ? { Cookie: websiteCookie } : {}) };
  const response = await fetch(BASE + route, { ...options, headers, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) websiteCookie = '';
  if (!response.ok) throw new Error(data.error || data.message || `CoreMX returned HTTP ${response.status}`);
  return { response, data };
}
async function websiteLogin(name, password) {
  name = String(name || '').trim().slice(0, 100);
  if (!name || !password) throw new Error('Enter your CoreMX website name and password.');
  const { response } = await websiteRequest('/api/login', { method: 'POST', body: JSON.stringify({ name, password }) });
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const match = cookies.map((value) => value.match(/(?:^|[,\s])mctg_session=([^;,\s]+)/i)).find(Boolean);
  if (!match) throw new Error('CoreMX did not return a website session. Check your login and try again.');
  websiteCookie = `mctg_session=${match[1]}`;
  return { signedIn: true, name };
}
async function reportMod(id, details) {
  const value = rawId(id);
  if (!value) throw new Error('Invalid CoreMX mod ID.');
  if (!websiteCookie) throw new Error('Sign in to your CoreMX website account first.');
  details = String(details || '').trim().slice(0, 2000);
  if (details.length < 10) throw new Error('Describe the problem in at least 10 characters.');
  return (await websiteRequest(`/api/mods/${encodeURIComponent(value)}/report`, { method: 'POST', body: JSON.stringify({ reason: 'Other', details }) })).data;
}
async function websiteNotifications() {
  if (!websiteCookie) return { signedIn: false, notifications: [] };
  const { data } = await websiteRequest('/api/notifications');
  return { signedIn: true, notifications: Array.isArray(data) ? data : Array.isArray(data.notifications) ? data.notifications : Array.isArray(data.items) ? data.items : [] };
}
function websiteSession() { return { signedIn: !!websiteCookie }; }
const CATEGORY = { tracks: [22], bikes: [45], liveries: [37], riderkit: [35], riders: [365], helmets: [33], boots: [31], gloves: [32], protection: [36], goggles: [380], sounds: [], animations: [519], wheels: [], graphics: [174], modpacks: [], other: [] };
const CAT_NAME = { tracks: 'Tracks', bikes: 'Bikes', liveries: 'Bike liveries', riderkit: 'Rider kits', riders: 'Rider models', helmets: 'Helmets', boots: 'Boots', gloves: 'Gloves', protection: 'Protection', goggles: 'Goggles', sounds: 'Sounds', animations: 'Animations', wheels: 'Wheels', graphics: 'Graphics', modpacks: 'Modpacks', other: 'Other' };
const text = s => String(s || '').slice(0, 20000);
const esc = s => text(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function timestamp(value) {
  if (value === null || value === undefined || value === '') return new Date().toISOString();
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value || '')) ? Number(value) : null;
  const date = new Date(numeric === null ? value : numeric < 100000000000 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function rawId(value) {
  const id = String(value || '').replace(/^coremx:/, '');
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, BASE);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function normalize(m, detail = false) {
  const id = rawId(m.id);
  if (!id) return null;
  const cat = String(m.category || 'other').toLowerCase();
  const images = (Array.isArray(m.images) ? m.images : []).map(imageUrl).filter(Boolean);
  const deps = (Array.isArray(m.deps) ? m.deps : []).filter(d => d && !d.missing).map(d => ({
    label: text(d.name || 'Required mod'),
    url: rawId(d.id) ? `${BASE}/#/mod/${encodeURIComponent(rawId(d.id))}` : text(d.url),
    declared: true,
  }));
  const post = {
    id: `coremx:${id}`, coremxId: id, title: text(m.title), link: `${BASE}/#/mod/${encodeURIComponent(id)}`,
    date: timestamp(m.createdAt || m.created || m.date),
    modified: timestamp(m.updatedAt || m.updated || m.createdAt || m.created || m.date),
    categoryNames: [CAT_NAME[cat] || 'Other'], categories: CATEGORY[cat] || [], image: images[0] || null,
    excerpt: text(m.summary), paid: false, addon: !!m.addon, needsModelNotice: !!m.addon && deps.length > 0,
    views: Number.isFinite(Number(m.views ?? m.viewCount ?? m.stats?.views)) && Number(m.views ?? m.viewCount ?? m.stats?.views) >= 0 ? Number(m.views ?? m.viewCount ?? m.stats?.views) : null,
    version: text(m.version), dependencies: deps,
  };
  if (!detail) return post;
  const link = `${BASE}/dl/${encodeURIComponent(id)}`;
  return {
    ...post, author: text(m.creator || m.author?.name), images,
    description: `<p>${esc(m.description).replace(/\n/g, '<br>')}</p>${m.install ? `<h3>How to install</h3><p>${esc(m.install).replace(/\n/g, '<br>')}</p>` : ''}<p>Version ${esc(m.version || '1.0')}</p>`,
    downloads: [{ url: link, label: 'Download from CoreMX', host: new URL(link).hostname, flag: 'Community upload' }],
    madeFor: m.gameVersion ? `Made for MX Bikes ${text(m.gameVersion)}` : '',
    modelDependencies: deps.map(d => ({ ...d, installed: null })),
  };
}

async function json(url, fetcher) {
  const request = fetcher || require('electron').net.fetch;
  const response = await request(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`CoreMX returned HTTP ${response.status}`);
  return response.json();
}

async function search({ query = '', tab = 'all', scope = 'free', page = 1, perPage = 24, orderby = 'relevance' } = {}, fetcher) {
  const url = new URL('/api/mods', BASE);
  url.searchParams.set('src', 'local');
  url.searchParams.set('page', String(page));
  url.searchParams.set('per', String(perPage));
  if (query) url.searchParams.set('q', query);
  if (tab !== 'all') url.searchParams.set('cat', tab);
  // CoreMX uses its own sort names. Its trending list covers recent activity;
  // most-viewed is the closest available ranking for longer popularity ranges.
  const sort = orderby === 'title' ? 'name' : orderby === 'modified' ? 'updated'
    : orderby === 'popular-week' || orderby === 'popular-today' || orderby === 'relevance' && !query ? 'trending'
    : orderby === 'popular-month' || orderby === 'popular-all' ? 'popular' : 'new';
  url.searchParams.set('sort', sort);
  const data = await json(url.href, fetcher);
  const posts = (data.mods || []).map(m => normalize(m)).filter(Boolean).filter(m => scope !== 'addons' || m.addon);
  return { posts, total: Number(data.total) || 0, page: Number(data.page) || page, totalPages: Math.max(1, Math.ceil((Number(data.total) || 0) / (Number(data.per) || perPage))) };
}

async function post(id, fetcher) {
  const value = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? `local-${id}` : rawId(id);
  if (!value) throw new Error('Invalid CoreMX mod ID');
  const data = await json(`${BASE}/api/mods/${encodeURIComponent(value)}`, fetcher);
  const mod = data.mod && normalize(data.mod, true);
  if (!mod || mod.coremxId !== value) throw new Error('CoreMX mod not found');
  return mod;
}

module.exports = { normalize, search, post, websiteLogin, reportMod, websiteNotifications, websiteSession };
