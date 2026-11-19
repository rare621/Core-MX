const { test } = require('node:test');
const assert = require('node:assert/strict');
const { modSources } = require('../src/lib/paintsync');
const { resolveDownload } = require('../src/lib/source-install');

// The user's real case: a free 310 MB helmet locked by its creator, installed from a MediaFire folder.
const installs = {
  12345: { postId: 12345, title: '2024 Alpinestars SM10', link: 'https://mxb-mods.com/2024-alpinestars-sm10/', image: 'https://mxb-mods.com/wp-content/uploads/sm10.webp',
    source: 'https://www.mediafire.com/folder/khlt0hljirw6n/2024+Alpinestars+SM10', files: ['rider/helmets/2024 Astars SM10 EKS.pkz'] },
  777: { postId: 777, shopKey: 'shop:1', title: 'Paid helmet', link: 'https://mxb-mods.com/paid/', files: ['rider/helmets/Paid Lid.pkz'] },
  888: { postId: 888, title: 'Store page', link: 'https://example.com/x/', files: ['rider/helmets/Other.pkz'] },
};

test('a locked or too-large item is shared as its free MXB Mods post, never a shop item', () => {
  const sourceFor = modSources(installs);
  const s = sourceFor(['rider/helmets/2024 Astars SM10 EKS/paints/Aeon Blue-Red.pnt', 'rider/helmets/2024 Astars SM10 EKS']);
  assert.deepEqual(s, { postId: 12345, title: '2024 Alpinestars SM10', link: 'https://mxb-mods.com/2024-alpinestars-sm10/', image: 'https://mxb-mods.com/wp-content/uploads/sm10.webp',
    download: 'https://www.mediafire.com/folder/khlt0hljirw6n/2024+Alpinestars+SM10', fileName: '2024 Astars SM10 EKS.pkz' });
  assert.equal(sourceFor(['rider/helmets/Paid Lid']), null, 'shop installs are personal to the buyer');
  assert.equal(sourceFor(['rider/helmets/Other']), null, 'only mxb-mods.com posts');
  assert.equal(sourceFor(['rider/helmets/Unknown']), null);
});

const post = { id: 12345, paid: false, downloads: [{ url: 'https://www.mediafire.com/folder/khlt0hljirw6n/2024+Alpinestars+SM10' }] };
const folder = { response: { result: 'Success', folder_content: { files: [
  { quickkey: '199khzl7zp7kb3i', filename: '2024 Astars SM10 Armega.pkz', size: '145605350' },
  { quickkey: 'hn3jlwsqz9zf2yj', filename: '2024 Astars SM10 EKS.pkz', size: '310557615' },
] } } };

test('a MediaFire folder download resolves to the one file the friend has', async () => {
  const asked = [];
  const fetchJson = async (url) => { asked.push(url); return folder; };
  const got = await resolveDownload({ ...modSources(installs)(['rider/helmets/2024 Astars SM10 EKS']) }, post, { fetchJson });
  assert.equal(got.url, 'https://www.mediafire.com/file/hn3jlwsqz9zf2yj/file');
  assert.match(asked[0], /folder_key=khlt0hljirw6n/);
  assert.equal(await resolveDownload({ postId: 12345, download: post.downloads[0].url, fileName: 'Not There.pkz' }, post, { fetchJson }), null);
});

test('only downloads the post itself lists are used', async () => {
  const fetchJson = async () => folder;
  assert.equal(await resolveDownload({ postId: 12345, download: 'https://evil.example/file.pkz', fileName: 'x.pkz' }, post, { fetchJson }), null);
  assert.equal(await resolveDownload({ postId: 12345, download: post.downloads[0].url, fileName: '2024 Astars SM10 EKS.pkz' }, { ...post, paid: true }, { fetchJson }), null);
  const direct = { downloads: [{ url: 'https://mxb-mods.com/wp-content/uploads/helmet.zip' }] };
  assert.deepEqual(await resolveDownload({ postId: 1, download: 'https://mxb-mods.com/wp-content/uploads/helmet.zip' }, direct, { fetchJson }), { url: 'https://mxb-mods.com/wp-content/uploads/helmet.zip' });
  assert.equal(await resolveDownload({ postId: 1, download: 'https://mega.nz/folder/abc' }, { downloads: [{ url: 'https://mega.nz/folder/abc' }] }, { fetchJson }), null, 'other folders need the player');
});
