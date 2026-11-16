const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInbox } = require('../src/lib/deeplink');
const source = fs.readFileSync(require.resolve('../src/renderer/app.js'), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

test('cold-start, warm and recreated windows receive links once and in order', () => {
  const delivered = [], inbox = createInbox(x => delivered.push(x));
  inbox.push({type:'install',id:1}); inbox.push({type:'join',address:'1.2.3.4:54210'});
  assert.equal(delivered.length,0);
  assert.deepEqual(inbox.ready().map(x=>x.type),['install','join']);
  assert.deepEqual(inbox.ready(),[]);
  inbox.push({type:'oem',pack:'mx'}); assert.equal(delivered[0].pack,'mx');
  inbox.reset(); inbox.push({type:'install',id:2});
  assert.equal(delivered.length,1); assert.equal(inbox.ready()[0].id,2);
});

function renderer(overrides={}) {
 const calls=[], messages=[];
 const ctx=vm.createContext({S:{browse:{},env:{modsFound:true,settings:{setupDone:true}},jobs:new Map()},
  api:{on(){},invoke:async(...args)=>{calls.push(args);return {source:'mxbmods',post:{id:1}}}},
  go:view=>calls.push(['go',view]),openPost:async(...args)=>calls.push(['post',...args]),
  handleJoinLink:async address=>calls.push(['join',address]),openSetup:()=>calls.push(['setup']),
  toast:message=>messages.push(message),esc:x=>x,cleanErr:x=>x.message,$:()=>null,...overrides});
 vm.runInContext(source.slice(source.indexOf('async function handleOpenLink(')),ctx);
 return {ctx,calls,messages};
}
test('website mod links route to Get Mods and preserve the selected file',async()=>{
 const {ctx,calls}=renderer();await ctx.handleOpenLink({type:'install',source:'mxbmods',id:1,file:2});
 assert.equal(ctx.S.getSrc,'free');assert.deepEqual(plain(calls.slice(1)),[['go','get'],['post',{id:1},{install:true,file:2}]]);
});
test('shop links select the shop and open its purchase popup, join links retain confirmation flow',async()=>{
 for(const shop of ['hub','mxbs']) {
  const {ctx,calls}=renderer();ctx.api.invoke=async(name,...args)=>{calls.push([name,...args]);return {source:shop,link:'https://shop.example/product'}};
  await ctx.handleOpenLink({type:'install',source:shop,id:2});assert.equal(ctx.S.getSrc,shop);
  assert.deepEqual(calls.at(-1),['shops:open',shop,'https://shop.example/product']);
 }
 const {ctx,calls}=renderer();await ctx.handleOpenLink({type:'join',address:'1.2.3.4:54210'});assert.deepEqual(calls,[['join','1.2.3.4:54210']]);
});
test('OEM links wait for pack data, report failures honestly, and do not download twice',async()=>{
 let clicked=0;const {ctx,messages}=renderer({$:()=>({click:()=>clicked++})});
 ctx.api.invoke=async()=>[{id:'mx',summary:{needCount:2}}];await ctx.handleOpenLink({type:'oem',pack:'mx'});assert.equal(clicked,1);
 ctx.$=()=>null;ctx.api.invoke=async()=>[{id:'mx',error:'Host unavailable'}];await ctx.handleOpenLink({type:'oem',pack:'mx'});assert.match(messages.at(-1),/Host unavailable/);
 ctx.S.jobs.set('a',{packId:'mx',status:'downloading'});await ctx.handleOpenLink({type:'oem',pack:'mx'});assert.match(messages.at(-1),/already downloading/);
});
test('explicit download selection never falls back to a different file or blocks a new variant',()=>{
 const started=[],{ctx,messages}=renderer({startDownload:async(p,d)=>started.push(d.url),installDependency:async url=>started.push(url)});
 ctx.installLinkedDownload({downloads:[{url:'first'}]},9);assert.equal(started.length,0);assert.match(messages.at(-1),/no longer available/);
 ctx.installLinkedDownload({downloads:[{url:'old',installed:true},{url:'new',installed:false}]},1);assert.deepEqual(started,['new']);
 ctx.installLinkedDownload({downloads:[{url:'old',installed:true}]},0);assert.equal(started.length,1);
 ctx.installLinkedDownload({downloads:[{url:'first'},{url:'second'}]},null);assert.equal(started.length,1);
 ctx.installLinkedDownload({downloads:[{url:'shop',shop:'mxbs'}]},0);assert.equal(started.at(-1),'shop');
});
test('shop IDs resolve only to safe product URLs on the expected shop',async()=>{
 const {productLink}=require('../src/lib/shops');const calls=[];
 const ses=value=>({fetch:async url=>{calls.push(url);return {ok:true,json:async()=>value}}});
 assert.equal(await productLink(ses({link:'http://mxbikes-shop.com/downloads/helmet/'}),'mxbs',1),'https://mxbikes-shop.com/downloads/helmet/');
 assert.match(calls.at(-1),/wp\/v2\/edd-downloads\/1/);
 assert.equal(await productLink(ses({permalink:'https://shop.mxb-hub.com/product/helmet/'}),'hub',2),'https://shop.mxb-hub.com/product/helmet/');
 assert.match(calls.at(-1),/wc\/store\/v1\/products\/2/);
 for(const link of ['https://evil.example/x','https://mxbikes-shop.com.evil.example/x','https://user:pass@mxbikes-shop.com/x','ftp://mxbikes-shop.com/x']) assert.equal(await productLink(ses({link}),'mxbs',1),null);
 assert.equal(await productLink(ses({}),'hub',Infinity),null);
});
