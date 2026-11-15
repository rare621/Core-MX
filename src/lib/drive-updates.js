const cheerio = require('cheerio');
const { Provider, parseUpdateInfo } = require('electron-updater/out/providers/Provider');
const FOLDER_ID = '1giNr8lC7cCLE_L62fSCIfRR-vfiwbMVk';
const downloadUrl = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
const updateError = (message) => Object.assign(new Error(message), { code: 'DRIVE_UPDATE' });

function folderFiles(html) {
  const found = new Map(), $ = cheerio.load(html);
  const add = (id, name) => {
    if (/^[\w-]{10,}$/.test(id || '') && /^(latest\.yml|MX-Bikes-Manager-Setup-[\w.-]+\.exe)$/.test(name || '')) {
      if (found.has(name) && found.get(name) !== id) throw updateError(`Duplicate ${name} in the update folder. Keep one current copy.`);
      found.set(name, id);
    }
  };
  $('[data-id]').each((_, el) => {
    const row = $(el);
    // Drive appends localized type/sharing labels to tooltips and aria-labels
    // ("latest.yml Binary", "...exe Unknown Shared"). Read the exact visible
    // filename too, without treating those suffixes as part of the filename.
    const labels = row.find('[data-tooltip], [role="gridcell"], strong').filter((_, e) => $(e).closest('[data-id]').attr('data-id') === row.attr('data-id'));
    for (const name of [row.attr('data-tooltip'), row.attr('aria-label'), row.text(), ...labels.map((_, e) => $(e).attr('data-tooltip')).get(), ...labels.map((_, e) => $(e).text()).get()]) add(row.attr('data-id'), name?.trim());
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
    if (!response.ok) throw updateError(`Google Drive returned ${response.status}. Check that the update folder and its files are shared with anyone who has the link.`);
    return response;
  }
  async getLatestVersion() {
    const listing = await smallText(await this.request(`https://drive.google.com/drive/folders/${this.folderId}`));
    const files = folderFiles(listing), manifest = files.get('latest.yml');
    if (!manifest) throw updateError('Could not find latest.yml in the shared update folder. Put it beside the setup EXE and allow anyone with the link to view both files.');
    const url = new URL(downloadUrl(manifest));
    const info = parseUpdateInfo(await smallText(await this.request(url.href)), 'latest.yml', url);
    const file = info.files?.find((f) => /^MX-Bikes-Manager-Setup-[\w.-]+\.exe$/.test(f.url));
    if (!file || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '')) throw updateError('The update manifest is invalid. Upload the original latest.yml from the release without editing it.');
    if (!files.has(file.url)) throw updateError(`The shared update folder is missing ${file.url}. Upload the setup EXE from the same release as latest.yml.`);
    let installerUrl = downloadUrl(files.get(file.url));
    const response = await this.request(installerUrl);
    if ((response.headers.get('content-type') || '').includes('text/html')) {
      const $ = cheerio.load(await smallText(response)), form = $('form#download-form');
      const action = new URL(form.attr('action') || '', installerUrl);
      if (!form.length || action.protocol !== 'https:' || action.hostname !== 'drive.usercontent.google.com') throw updateError('Google Drive download is unavailable. Check sharing permissions or download quota.');
      form.find('input[name]').each((_, input) => action.searchParams.set($(input).attr('name'), $(input).attr('value') || ''));
      installerUrl = action.href;
    } else { await response.body?.cancel(); }
    this.resolved = [{ url: new URL(installerUrl), info: file }];
    return info;
  }
  resolveFiles() { return this.resolved; }
}
module.exports = { DriveProvider, FOLDER_ID, folderFiles };
