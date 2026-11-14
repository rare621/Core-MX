const { test } = require('node:test');
const assert = require('node:assert/strict');
const edf = require('../src/lib/edf');

test('independent helmet objects do not inherit an unrelated camera rotation', () => {
  const vc = 8, vs = 0x54 + 4, ic = vs + vc * 72, name = ic + 8 + 24;
  const b = Buffer.alloc(name + 580);
  b.write('EDF\0', 0, 'latin1'); b.writeUInt32LE(vc, 0x54);
  const input = Array.from({ length: vc }, (_, i) => [(i & 1) ? 0.2 : -0.2, (i & 2) ? 0.3 : -0.3, (i & 4) ? 0.1 : -0.1]);
  input.forEach((p, i) => p.forEach((v, k) => b.writeFloatLE(v, vs + i * 12 + k * 4)));
  b.writeUInt32LE(2, ic);
  [0, 1, 2, 4, 5, 6].forEach((v, i) => b.writeUInt32LE(v, ic + 4 + i * 4));
  b.write('camera', name); b.write('shell', name + 280);
  const rotation = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  rotation.forEach((v, i) => b.writeFloatLE(v, name + 104 + i * 4));
  identity.forEach((v, i) => b.writeFloatLE(v, name + 384 + i * 4));
  [[0, 1, 0, 4, 4, 0], [1, 1, 4, 4, 4, 4]].forEach((g, n) => g.forEach((v, i) => b.writeUInt32LE(v, name + 252 + n * 280 + i * 4)));
  [-0.3, -0.3, -0.1, 0.3, 0.3, 0.1].forEach((v, i) => b.writeFloatLE(v, 4 + i * 4));
  const m = edf.parse(b, { gear: true, helmet: true });
  assert.equal(m.nodes.length, 1);
  input.slice(4).forEach((p, i) => p.forEach((v, k) => assert.ok(Math.abs(m.nodes[0].positions[(i + 4) * 3 + k] - v) < 1e-6)));
  assert.ok(Math.abs(m.nodes[0].positions[0] - 0.3) < 1e-6);
});

test('lever meshes inherit explicit pivot parents even when record sizes differ', () => {
  const vc=8,vs=0x58,ic=vs+vc*72,name=ic+8+24,b=Buffer.alloc(name+900);b.write('EDF\0',0,'latin1');b.writeUInt32LE(vc,0x54);
  for(let i=0;i<vc;i++){b.writeFloatLE(i*.01,vs+i*12);b.writeFloatLE(.05,vs+i*12+4)}
  b.writeUInt32LE(2,ic);[0,1,2,4,5,6].forEach((v,i)=>b.writeUInt32LE(v,ic+4+i*4));
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  for(const [offset,label] of [[0,'chassis'],[280,'brake_pivot'],[564,'brake_mesh']]){b.write(label,name+offset);identity.forEach((v,i)=>b.writeFloatLE(v,name+offset+104+i*4))}
  b.writeFloatLE(.4,name+280+104+7*4);b.writeUInt32LE(1,name+236);b.writeUInt32LE(1,name+240);b.writeUInt32LE(1,name+280+236);b.writeUInt32LE(2,name+280+240);
  [[0,1,0,4,4,0],[1,1,4,4,4,4]].forEach((g,n)=>g.forEach((v,i)=>b.writeUInt32LE(v,name+252+(n?564:0)+i*4)));
  const model=edf.parse(b,{gear:true});assert.ok(Math.abs(model.nodes[0].positions[4*3+1]-.45)<1e-6);
});

