const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { popularRows } = require('../src/lib/site');

// Markup copied from mxb-mods.com's popular pages (Nov 2026), images removed.
const today = `<div class="dmpop dmpop--podium"><div class="dmpop-podium"><li class="dmpop-card is-first"><a class="dmpop-thumb" href="https://mxb-mods.com/oem-bike-pack/"></a><div class="dmpop-body"><a class="dmpop-title" href="https://mxb-mods.com/oem-bike-pack/">MX OEM</a><a href="https://mxb-mods.com/bikes/">Bikes</a><span class="dmpop-views"><i class="far fa-eye"></i> 1,536 views</span></div></li>
<ol class="dmpop-side"><li class="dmpop-mini"><a class="dmpop-thumb" href="https://mxb-mods.com/zd-kato-cycle-club/"><span class="dmpop-rank">2</span></a><div class="dmpop-main"><a class="dmpop-title" href="https://mxb-mods.com/zd-kato-cycle-club/">ZD Kato</a><span class="dmpop-sub">1,367 views <span class="dmpop-delta is-same">–</span></span></div></li></ol></div>
<ol class="dmpop-compact"><li class="dmpop-line"><span class="dmpop-num">4</span><a class="dmpop-title" href="https://mxb-mods.com/wdr-mx-26-rd-08-2/">WDR</a><span class="dmpop-delta is-up">▲10</span><span class="dmpop-views" title="880 views">880</span></li></ol></div>`;
const allTime = `<ol><li class="dmpop-row is-top"><span class="dmpop-num">1</span><a class="dmpop-thumb" href="https://mxb-mods.com/oem-bike-pack/"></a><div class="dmpop-main"><a class="dmpop-title" href="https://mxb-mods.com/oem-bike-pack/">MX OEM</a><span class="dmpop-sub">Bikes · by insane</span></div><div class="dmpop-side-stat"><span class="dmpop-views">2,194,975 views </span></div></li>
<li class="dmpop-row"><span class="dmpop-num">2</span><div class="dmpop-main"><a class="dmpop-title" href="https://mxb-mods.com/eleven10-mods-factory-bike-open-test/">Eleven10</a></div><div class="dmpop-side-stat"><span class="dmpop-views">921,545 views </span></div></li></ol>`;

test('reads the podium card, mini and compact lines on the "today" page', () => {
  assert.deepEqual(popularRows(cheerio.load(today)), [
    { slug: 'oem-bike-pack', views: 1536 }, { slug: 'zd-kato-cycle-club', views: 1367 }, { slug: 'wdr-mx-26-rd-08-2', views: 880 },
  ]);
});
test('reads the row layout on the all-time page', () => {
  assert.deepEqual(popularRows(cheerio.load(allTime)), [
    { slug: 'oem-bike-pack', views: 2194975 }, { slug: 'eleven10-mods-factory-bike-open-test', views: 921545 },
  ]);
});
