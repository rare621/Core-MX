const { test } = require('node:test');
const assert = require('node:assert/strict');
const friendGear = require('../src/lib/friend-gear');

const tick = () => new Promise((r) => setTimeout(r, 5));
function setup({ posts = {}, results = {}, installed = [] } = {}) {
  const jobs = new Map(), started = [], searched = [];
  const fg = friendGear.create({
    site: {
      post: async (id) => { if (!posts[id]) throw new Error('no post'); return posts[id]; },
      search: async ({ query, tab }) => { searched.push([query, tab]); return { posts: (results[query] || []).map((id) => ({ id })) }; },
    },
    startJob: (post, dl) => { const id = 'job' + (jobs.size + 1); jobs.set(id, { status: 'downloading' }); started.push([post.id, dl.url]); return id; },
    jobStatus: (id) => jobs.get(id) || null,
    isInstalled: (postId) => installed.includes(postId),
  });
  return { fg, jobs, started, searched };
}
const page = (id, title, downloads, link = `https://mxb-mods.com/p${id}/`) => ({ id, title, link, downloads });

test('search terms split a model folder name', () => {
  assert.deepEqual(friendGear.queries('Bellmoto10-FCR'), ['Bellmoto10 FCR', 'Bellmoto 10 FCR']);
  assert.deepEqual(friendGear.queries('Fox_V3'), ['Fox V3', 'Fox V 3']);
});

test('only a strong match installs: the download name or file, or the title with a single download', () => {
  const dl = (label, url) => ({ label, url, flag: 'Default' });
  assert.equal(friendGear.matchDownload(page(1, 'Helmets pack', [dl('mediafire', 'https://www.mediafire.com/file/x/Bellmoto10-FCR.rar/file')]), 'Bellmoto10-FCR').label, 'mediafire');
  assert.equal(friendGear.matchDownload(page(2, 'Pack', [dl('Bellmoto10 FCR version', 'https://a.test/1.zip'), dl('Other', 'https://a.test/2.zip')]), 'Bellmoto10-FCR').label, 'Bellmoto10 FCR version');
  assert.equal(friendGear.matchDownload(page(3, 'Bellmoto10-FCR helmet', [dl('Get', 'https://a.test/1.zip')]), 'Bellmoto10-FCR').label, 'Get');
  // The real page for that helmet: one "Bell moto 10.rar" with every goggle version. Not sure enough.
  assert.equal(friendGear.matchDownload(page(91257, 'Bell Moto 10´S different Googles', [dl('mediafire', 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file')]), 'Bellmoto10-FCR'), null);
  assert.equal(friendGear.matchDownload(page(4, 'Bellmoto10-FCR', [dl('A', 'https://a.test/1.zip'), dl('B', 'https://a.test/2.zip')]), 'Bellmoto10-FCR'), null, 'several downloads, none named');
  assert.equal(friendGear.matchDownload(page(5, 'Full protection', [dl('Get', 'https://a.test/1.zip')]), 'Full'), null, 'short names never install');
  assert.equal(friendGear.matchDownload(page(6, 'Bellmoto10-FCR', [{ label: 'Buy', url: 'https://shop.test/x', shop: 'mxbs' }]), 'Bellmoto10-FCR'), null, 'paid downloads never');
});

test('the page the owner installed from comes first, and its own link is used, not the one sent', async () => {
  const { fg, started, searched } = setup({ posts: { 77: page(77, 'Bell Moto 10s', [{ label: 'mediafire', url: 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file' }]) } });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR', source: { postId: 77, link: 'https://mxb-mods.com/bell-moto-10s/', download: 'https://evil.test/x.exe' } });
  await tick();
  assert.deepEqual(started, [[77, 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file']]);
  assert.deepEqual(searched, [], 'no search when the page works');
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'installing');
  fg.find({ slot: 'helmet', name: 'bellmoto10-fcr', source: { postId: 77, link: 'https://mxb-mods.com/bell-moto-10s/' } });
  await tick();
  assert.equal(started.length, 1, 'one attempt per item');
});

test('when the page download fails, the name search runs next, skipping that page', async () => {
  const posts = {
    77: page(77, 'Bell Moto 10s', [{ label: 'Get', url: 'https://a.test/broken.rar' }]),
    88: page(88, 'Other helmets', [{ label: 'Bellmoto10-FCR', url: 'https://a.test/fcr.zip' }]),
  };
  const { fg, jobs, started } = setup({ posts, results: { 'Bellmoto10 FCR': [77, 88] } });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR', source: { postId: 77, link: 'https://mxb-mods.com/bell-moto-10s/' } });
  await tick();
  jobs.get('job1').status = 'error'; jobs.get('job1').error = 'Link is dead';
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'failed');
  fg.jobFailed('job1');
  await tick();
  assert.deepEqual(started.map((s) => s[0]), [77, 88]);
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'installing');
  jobs.get('job2').status = 'done';
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'installed');
});

test('no page and nothing sure on MXB Mods: no match, nothing installed, the player decides', async () => {
  const posts = { 91257: page(91257, 'Bell Moto 10´S different Googles', [{ label: 'mediafire', url: 'https://www.mediafire.com/file/k/Bell+moto+10.rar/file' }]) };
  const { fg, started, searched } = setup({ posts, results: { 'Bellmoto 10 FCR': [91257] } });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR' });
  await tick();
  assert.deepEqual(searched.map((s) => s[1]), ['helmets', 'helmets']);
  assert.deepEqual(started, []);
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'nomatch');
});

test('a page already installed (the item still missing) is not downloaded again', async () => {
  const { fg, started } = setup({ posts: { 77: page(77, 'Pack', [{ label: 'Get', url: 'https://a.test/1.zip' }]) }, installed: [77] });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR', source: { postId: 77, link: 'https://mxb-mods.com/p/' } });
  await tick();
  assert.deepEqual(started, []);
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'nomatch');
});

test('nothing found is looked for again after a while, not on every sync', async () => {
  const searched = [];
  const fg = friendGear.create({
    site: { post: async () => null, search: async ({ query }) => { searched.push(query); return { posts: [] }; } },
    startJob: () => 'job', jobStatus: () => null, isInstalled: () => false, retryAfter: 40,
  });
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR' });
  await tick();
  assert.equal(fg.status('helmet', 'Bellmoto10-FCR').state, 'nomatch');
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR' });
  await tick();
  assert.equal(searched.length, 2, 'too soon: not again');
  await new Promise((r) => setTimeout(r, 50));
  fg.find({ slot: 'helmet', name: 'Bellmoto10-FCR' });
  await tick();
  assert.equal(searched.length, 4, 'later: searched again');
  fg.find({ slot: 'suitPaint', name: 'OPOlitPROpub' });
  await tick();
  assert.equal(fg.status('suitPaint', 'OPOlitPROpub').state, 'nomatch', 'paints end as no match too');
});
