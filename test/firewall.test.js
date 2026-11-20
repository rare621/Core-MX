const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/lib/firewall');

// Hosting: Windows Firewall must let MX Bikes in on the network type in use, or every rider times out.
const profiles = (enabled = 'True', inbound = 'NotConfigured') => ['Domain', 'Private', 'Public'].map((name) => ({ name, enabled, inbound }));
test('Windows Firewall: off, allowed, blocked or no rule', () => {
  assert.equal(evaluate({ profiles: profiles('False'), categories: ['Public'], rules: [] }).state, 'off');
  assert.equal(evaluate({ profiles: profiles(), categories: ['Public'], rules: [{ action: 'Allow', enabled: 'True', profile: 'Private, Public', protocol: 'UDP' }] }).state, 'allowed');
  // "Private networks" ticked at the Windows prompt while the PC's network is Public.
  assert.equal(evaluate({ profiles: profiles(), categories: ['Public'], rules: [{ action: 'Allow', enabled: 'True', profile: 'Private', protocol: 'UDP' }] }).state, 'blocked');
  // Cancel at the prompt makes a block rule; it wins over an allow rule.
  assert.equal(evaluate({ profiles: profiles(), categories: ['Public'], rules: [{ action: 'Allow', enabled: 'True', profile: 'Any', protocol: 'Any' }, { action: 'Block', enabled: 'True', profile: 'Public', protocol: 'UDP' }] }).state, 'blocked');
  assert.equal(evaluate({ profiles: profiles(), categories: ['Public'], rules: [{ action: 'Block', enabled: 'False', profile: 'Public', protocol: 'UDP' }] }).state, 'blocked', 'no rule at all: Windows drops it');
  assert.equal(evaluate({ profiles: profiles(), categories: 'Private', rules: [{ action: 'Allow', enabled: 'True', profile: 'Private', protocol: 'TCP' }] }).state, 'blocked', 'a TCP-only rule does not cover the game');
  assert.equal(evaluate({ profiles: [], categories: [], rules: [] }).state, 'unknown');
});
