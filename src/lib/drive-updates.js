const cheerio = require('cheerio');
const { Provider, parseUpdateInfo } = require('electron-updater/out/providers/Provider');
const FOLDER_ID = '1giNr8lC7cCLE_L62fSCIfRR-vfiwbMVk';
const downloadUrl = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

function folderFiles(html) {
  const found = new Map(), $ = cheerio.load(html);
  const add = (id, name) => {
    if (/^[\w-]{10,}$/.test(id || '') && /^(latest\.yml|MX-Bikes-Manager-Setup-[\w.-]+\.exe)$/.test(name || '')) {
      if (found.has(name) && found.get(name) !== id) throw new Error(`Duplicate ${name} in the update folder. Keep one current copy.`);
      found.set(name, id);
    }
  };
  $('[data-id]').each((_, el) => {
    const row = $(el);
    for (const name of [row.attr('data-tooltip'), row.attr('aria-label'), ...row.find('[data-tooltip]').map((_, e) => $(e).attr('data-tooltip')).get(), ...row.find('[role="gridcell"]').map((_, e) => $(e).text()).get()]) add(row.attr('data-id'), name?.trim());
  });
  // Public Drive embeds its file records as JSON. Parse data only, never execute
  // the page's JavaScript. This also supports its alternate list/grid layouts.
  for (const match of html.matchAll(/AF_initDataCallback\(\{key:[\s\S]*?data:([\s\S]*?),\s*sideChannel:/g)) {
    let data; try { data = JSON.parse(match[1]); } catch { continue; }
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      add(value[0], value[2]);
      for (const child of value) if (Array.isArray(child)) visit(child);
    };
    visit(data);
  }
  return found;
}

async function smallText(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Update metadata is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

class DriveProvider extends Provider {
  constructor(config, updater, options) {
    super({ ...options, isUseMultipleRangeRequest: false });
    this.fetch = config.fetch || ((...args) => require('electron').net.fetch(...args));
    this.folderId = config.folderId || FOLDER_ID;
  }
  async request(url) {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Google Drive returned ${response.status}`);
    return response;
  }
  async getLatestVersion() {
    const listing = await smallText(await this.request(`https://drive.google.com/drive/folders/${this.folderId}`));
    const files = folderFiles(listing), manifest = files.get('latest.yml');
    if (!manifest) throw new Error('Upload latest.yml and the setup EXE to the public Google Drive update folder.');
    const url = new URL(downloadUrl(manifest));
    const info = parseUpdateInfo(await smallText(await this.request(url.href)), 'latest.yml', url);
    const file = info.files?.find((f) => /^MX-Bikes-Manager-Setup-[\w.-]+\.exe$/.test(f.url));
    if (!file || !files.has(file.url) || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '')) throw new Error('The Drive folder needs the matching setup EXE and its original latest.yml.');
    let installerUrl = downloadUrl(files.get(file.url));
    const response = await this.request(installerUrl);
    if ((response.headers.get('content-type') || '').includes('text/html')) {
      const $ = cheerio.load(await smallText(response)), form = $('form#download-form');
      const action = new URL(form.attr('action') || '', installerUrl);
      if (!form.length || action.protocol !== 'https:' || action.hostname !== 'drive.usercontent.google.com') throw new Error('Google Drive download is unavailable. Check sharing permissions or download quota.');
      form.find('input[name]').each((_, input) => action.searchParams.set($(input).attr('name'), $(input).attr('value') || ''));
      installerUrl = action.href;
    } else { await response.body?.cancel(); }
    this.resolved = [{ url: new URL(installerUrl), info: file }];
    return info;
  }
  resolveFiles() { return this.resolved; }
}
module.exports = { DriveProvider, FOLDER_ID, folderFiles };
