const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');

test('inline download finishes and deletion restores Install instead of keeping Installing', () => {
  const button = { disabled: true, textContent: 'Installing', dataset: { inlineReview: 'job' } };
  const progress = { hidden: false, replaceChildren() { this.cleared = true; } };
  const row = { dataset: { downloadUrl: 'https://example.test/file.zip' } };
  const job = { url: row.dataset.downloadUrl, status: 'done' };
  const context = vm.createContext({ S: { jobs: new Map([['job', job]]) }, document: {}, $$: () => [row], $: (s) => s.includes('progress') ? progress : button });
  vm.runInContext(app.slice(app.indexOf('function refreshInlineDownloads('), app.indexOf('function jobHtml(')), context);
  context.refreshInlineDownloads();
  assert.equal(button.textContent, 'Installed'); assert.equal(button.disabled, true);
  assert.equal(progress.hidden, true); assert.equal(button.dataset.inlineReview, undefined);
  job.filesDeleted = true; context.refreshInlineDownloads();
  assert.equal(button.textContent, 'Install'); assert.equal(button.disabled, false);
});

test('paid sync summary counts only missing protected items and never lists their names', () => {
  const live = fs.readFileSync(path.join(__dirname, '../src/renderer/live.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(live.slice(live.indexOf('function paidModsSummary('), live.indexOf('async function openFriendDetails(')), context);
  const html = context.paidModsSummary([{ label: 'Hidden name', error: 'Paid mod — not installing' }, { error: 'Paid mod', state: 'have' }, { error: 'Unreadable' }]);
  assert.match(html, /1 paid mod — not installing/);
  assert.doesNotMatch(html, /Hidden name|2 paid/);
  assert.equal(context.paidModsSummary([{ error: 'Paid mod', state: 'have' }]), '');
});

test('Ranked keeps addresses tied to the correct lobby and ignores invalid IPs', () => {
  const { parseDetails } = require('../src/lib/ranked');
  const result = parseDetails(['EU #10','Status: Warmup','Current Track: Track A','2/30','Server IP: 192.0.2.5:54210', 'US #11','Status: Race','Current Track: Track B','1/30','IP: 999.0.0.1:99999', 'Track List', 'IP: 192.0.2.20:54210']);
  assert.equal(result.lobbies[0].address, '192.0.2.5:54210');
  assert.equal(result.lobbies[1].address, undefined);
  assert.equal(result.lobbies[1].track, 'Track B');
});

test('free dependency actions use the in-app installer while store links remain external', () => {
  const context = vm.createContext({ URL, esc: (s) => s, icon: () => '' });
  vm.runInContext(app.slice(app.indexOf('function isMxbModelPage('), app.indexOf('async function installDependency(')), context);
  assert.match(context.dependencyButton({ url: 'https://mxb-mods.com/helmet/' }), /data-install-required/);
  assert.match(context.dependencyButton({ url: 'https://mxbikes-shop.com/downloads/hoodie/' }), /data-open/);
  assert.equal(context.isMxbModelPage('https://mxb-mods.com.attacker.test/helmet/'), false);
});
