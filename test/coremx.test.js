const {test}=require('node:test'),assert=require('node:assert/strict');
const coremx=require('../src/lib/coremx');
const sample={id:'qnuO9d1Lr7Ij',title:'AB Hoodie',summary:'Rider hoodie',category:'riders',kind:'model',version:'2.0',images:['/img/qnuO9d1Lr7Ij-cover.png'],externalUrl:'https://drive.google.com/file/d/abc/view',deps:[{id:'otherModel9',name:'Base gear'}],description:'Wear it',install:'Put in riders',createdAt:1794868709652,updatedAt:1794868745795};
const fake=body=>async url=>({ok:true,json:async()=>body,url});
test('CoreMX community uploads enter Free mods with unique IDs, categories, and page data',async()=>{
 const r=await coremx.search({scope:'free',tab:'riders',query:'hoodie',page:1,perPage:24},fake({mods:[sample],page:1,per:24,total:1}));
 assert.equal(r.posts[0].id,'coremx:qnuO9d1Lr7Ij');assert.deepEqual(r.posts[0].categories,[365]);assert.equal(r.totalPages,1);assert.equal(r.posts[0].version,'2.0');assert.equal(r.posts[0].image,'https://coremx.app/img/qnuO9d1Lr7Ij-cover.png');assert.equal(r.posts[0].date,new Date(sample.createdAt).toISOString());
 const addons=await coremx.search({scope:'addons'},fake({mods:[sample],total:1,page:1,per:24}));assert.equal(addons.posts.length,0);
});
test('CoreMX detail downloads through its route and retains creator instructions and dependencies',async()=>{
 const urls=[];const fetcher=async url=>{urls.push(url);return {ok:true,json:async()=>({mod:sample})}};
 const p=await coremx.post('coremx:qnuO9d1Lr7Ij',fetcher);assert.equal(urls[0],'https://coremx.app/api/mods/qnuO9d1Lr7Ij');assert.equal(p.downloads[0].url,'https://coremx.app/dl/qnuO9d1Lr7Ij');assert.equal(p.dependencies[0].url,'https://coremx.app/#/mod/otherModel9');assert.match(p.description,/Put in riders/);assert.equal(p.categories[0],365);assert.equal(p.modified,new Date(sample.updatedAt).toISOString());
});
test('CoreMX detail handles a missing or malformed mod',async()=>{
 await assert.rejects(coremx.post(0,fake({})),/Invalid/);
 await assert.rejects(coremx.post('qnuO9d1Lr7Ij',fake({mod:{id:'bad'}})),/not found/);
});
