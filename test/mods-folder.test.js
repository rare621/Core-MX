const { test } = require('node:test');
const assert = require('node:assert/strict');
const { modsFolderFromGlobalIni } = require('../src/lib/paths');

// MX Bikes keeps mods elsewhere when global.ini has [mods] folder=<path> (a friend's setup:
// profiles in Documents, mods on T:). CoreMX must use that folder, or its sync and the game disagree.
test('the game\'s own mods folder is read from global.ini', () => {
  assert.equal(modsFolderFromGlobalIni('\r\n[profile]\r\nlastprofile=Cardone\r\n\r\n[mods]\r\nfolder=T:\\MX Bike Mods\\mods\r\n'), 'T:\\MX Bike Mods\\mods');
  assert.equal(modsFolderFromGlobalIni('[mods]\nfolder = "D:/Games/MXB mods"\n'), 'D:/Games/MXB mods');
  assert.equal(modsFolderFromGlobalIni('[mods]\nfolder=\\\\nas\\mxb\\mods\n'), '\\\\nas\\mxb\\mods');
  assert.equal(modsFolderFromGlobalIni('[profile]\nlastprofile=Rare621\nnickname=Rare621\n'), '', 'default: no override');
  assert.equal(modsFolderFromGlobalIni('[mods]\nfolder=relative\\mods\n'), '', 'only absolute paths');
  assert.equal(modsFolderFromGlobalIni('[other]\nfolder=T:\\x\n'), '', 'only the [mods] section');
});
