const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeBrowsePosts } = require('../src/lib/browse-sort');

test('combined Get Mods results respect popularity, newest, updates, title, and search relevance', () => {
  const legacy = [
    { id: 1, title: 'Zebra kit', date: '2025-01-01', modified: '2026-01-01', rank: 2 },
    { id: 2, title: 'Alpine kit', date: '2024-01-01', modified: '2025-01-01', rank: 1 },
    { id: 3, title: 'Helmet', date: '2023-01-01', modified: '2024-01-01' },
  ];
  const community = [{ id: 'coremx:1', title: 'Alpine helmet', date: '2026-01-01', modified: '2026-06-01' }];
  const ids = (sort, query) => mergeBrowsePosts(legacy, community, sort, query).map(p => p.id);
  assert.deepEqual(ids('popular-week'), [2, 1, 'coremx:1', 3]);
  assert.deepEqual(ids('date'), ['coremx:1', 1, 2, 3]);
  assert.deepEqual(ids('modified'), ['coremx:1', 1, 2, 3]);
  assert.deepEqual(ids('title'), ['coremx:1', 2, 3, 1]);
  assert.deepEqual(ids('relevance', 'alpine helmet'), ['coremx:1', 2, 3, 1]);
});
