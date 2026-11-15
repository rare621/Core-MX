const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a declared numbered helmet matches installed variants without accepting another generation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function modelTerms('), source.indexOf('function dependencySearchScore(')), context);
  const dependency = { declared: true, label: '2021 6D ATR-2', url: 'https://mxb-mods.com/2021-6d-atr-2/' };
  assert.equal(context.matchingModel(['2021_6d_atr2_armega'], dependency), '2021_6d_atr2_armega');
  assert.equal(context.matchingModel(['2021_6d_atr3', '2018_6d_atr2'], dependency), null);
});

test('shop popup downloads record their product separately from the requesting paint listing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  let download, fields;
  const context = vm.createContext({ session: { fromPartition: () => ({ setUserAgent() {}, on: (_, fn) => { download = fn; } }) }, site: { UA: 'test' }, browserJobs: new Map(), jobs: new Map(), shopDownloads: new Map([[42, { shop: 'mxbs', link: 'https://mxbikes-shop.com/downloads/6-helmet/' }]]), newJob: (f) => { fields = f; return { ...f, stageDir: 'test-stage' }; }, send() {}, emitJob() {}, fs: { mkdirSync() {} }, path, hosts: { safeName: (name) => name } });
  vm.runInContext(source.slice(source.indexOf('function setupDownloadsSession()'), source.indexOf('function registerIpc()')), context);
  context.setupDownloadsSession();
  download({}, { getFilename: () => '6Helmet.pkz', setSavePath() {}, on() {}, once() {} }, { id: 42 });
  assert.equal(fields.shopKey, 'https://mxbikes-shop.com/downloads/6-helmet/');
  assert.equal(fields.link, fields.shopKey);
  assert.equal(fields.postId, undefined);
});

test('shop dependency action opens a shop popup instead of starting a paint download or external browser', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const calls = [];
  const context = vm.createContext({ URL, api: { invoke: async (...args) => calls.push(args) } });
  vm.runInContext(source.slice(source.indexOf('function isMxbModelPage('), source.indexOf("document.addEventListener('click', async", source.indexOf('async function installDependency('))), context);
  await context.installDependency('https://mxbikes-shop.com/downloads/6-helmet/');
  assert.deepEqual(calls, [['shops:open', 'mxbs', 'https://mxbikes-shop.com/downloads/6-helmet/']]);
});
