const {test}=require('node:test'),assert=require('node:assert/strict');
const coremx=require('../src/lib/coremx');
const sample={id:'local-17',title:'AB Hoodie',summary:'Rider hoodie',category:'riders',kind:'model',version:'2.0',images:['https://coremx.app/a.png'],externalUrl:'https://drive.google.com/file/d/abc/view',deps:[{id:'local-11',name:'Base gear'}],description:'Wear it',install:'Put in riders',createdAt:'2026-11-16T10:00:00Z'};
const fake=body=>async url=>({ok:true,json:async()=>body,url});
test('CoreMX community uploads enter Free mods with unique IDs, categories, and page data',async()=>{
 const r=await coremx.search({scope:'free',tab:'riders',query:'hoodie',page:1,perPage:24},fake({mods:[sample],page:1,per:24,total:1}));
 assert.equal(r.posts[0].id,-17);assert.deepEqual(r.posts[0].categories,[365]);assert.equal(r.totalPages,1);assert.equal(r.posts[0].version,'2.0');
 const addons=await coremx.search({scope:'addons'},fake({mods:[sample],total:1,page:1,per:24}));assert.equal(addons.posts.length,0);
});
test('CoreMX detail downloads through its route and retains creator instructions and dependencies',async()=>{
 const p=await coremx.post(17,fake({mod:sample}));assert.equal(p.downloads[0].url,'https://coremx.app/dl/local-17');assert.equal(p.dependencies[0].url,'https://coremx.app/#/mod/local-11');assert.match(p.description,/Put in riders/);assert.equal(p.categories[0],365);
});
test('CoreMX detail handles a missing or malformed mod',async()=>{
 await assert.rejects(coremx.post(0,fake({})),/Invalid/);
 await assert.rejects(coremx.post(17,fake({mod:{id:'bad'}})),/not found/);
});
