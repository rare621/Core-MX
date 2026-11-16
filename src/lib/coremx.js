'use strict';
const BASE = 'https://coremx.app';
const CATEGORY = {tracks:[22],bikes:[45],liveries:[37],riderkit:[35],riders:[365],helmets:[33],boots:[31],gloves:[32],protection:[36],goggles:[380],sounds:[],wheels:[],graphics:[174],modpacks:[],other:[]};
const CAT_NAME = {tracks:'Tracks',bikes:'Bikes',liveries:'Bike liveries',riderkit:'Rider kits',riders:'Rider models',helmets:'Helmets',boots:'Boots',gloves:'Gloves',protection:'Protection',goggles:'Goggles',sounds:'Sounds',wheels:'Wheels',graphics:'Graphics',modpacks:'Modpacks',other:'Other'};
const text = s => String(s || '').slice(0, 20000);
const esc = s => text(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function idOf(m) { const value=String(m.id||'').replace(/^local-/,'');const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null; }
function normalize(m, detail=false) {
 const id=idOf(m);if(!id)return null;
 const cat=String(m.category||'other').toLowerCase(),images=(Array.isArray(m.images)?m.images:[]).filter(x=>typeof x==='string'&&/^https:\/\//.test(x));
 const deps=(Array.isArray(m.deps)?m.deps:[]).filter(d=>d&& !d.missing).map(d=>({label:text(d.name||'Required mod'),url:d.id?`${BASE}/#/mod/${encodeURIComponent(d.id)}`:text(d.url),declared:true}));
 const sourceId=`local-${id}`;
 const post={id:-id,coremxId:sourceId,title:text(m.title),link:`${BASE}/#/mod/${sourceId}`,date:m.createdAt||m.created||m.date||new Date().toISOString(),modified:m.updatedAt||m.updated||m.createdAt||new Date().toISOString(),categoryNames:[CAT_NAME[cat]||'Other'],categories:CATEGORY[cat]||[],image:images[0]||null,excerpt:text(m.summary),paid:false,addon:!!m.addon,needsModelNotice:!!m.addon&&deps.length>0,version:text(m.version),dependencies:deps};
 if(!detail)return post;
 const link=`${BASE}/dl/${sourceId}`;
 return {...post,author:text(m.creator||m.author?.name),images,description:`<p>${esc(m.description).replace(/\n/g,'<br>')}</p>${m.install?`<h3>How to install</h3><p>${esc(m.install).replace(/\n/g,'<br>')}</p>`:''}<p>Version ${esc(m.version||'1.0')}</p>`,downloads:[{url:link,label:'Download from CoreMX',host:new URL(link).hostname,flag:'Community upload'}],madeFor:m.gameVersion?`Made for MX Bikes ${text(m.gameVersion)}`:'',modelDependencies:deps.map(d=>({...d,installed:null}))};
}
async function json(url,fetcher) { const request=fetcher||require('electron').net.fetch;const r=await request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`CoreMX returned HTTP ${r.status}`);return r.json(); }
async function search({query='',tab='all',scope='free',page=1,perPage=24,orderby='relevance'}={},fetcher) {
 const u=new URL('/api/mods',BASE);u.searchParams.set('src','local');u.searchParams.set('page',String(page));u.searchParams.set('per',String(perPage));if(query)u.searchParams.set('q',query);if(tab!=='all')u.searchParams.set('cat',tab);u.searchParams.set('sort',orderby==='title'?'name':orderby==='relevance'?'new':orderby==='modified'?'updated':'new');
 const data=await json(u.href,fetcher);const posts=(data.mods||[]).map(m=>normalize(m)).filter(Boolean).filter(m=>scope==='addons'?m.addon:!m.addon);
 return {posts,total:Number(data.total)||0,page:Number(data.page)||page,totalPages:Math.max(1,Math.ceil((Number(data.total)||0)/(Number(data.per)||perPage)))};
}
async function post(id,fetcher) { const n=Number(id);if(!Number.isSafeInteger(n)||n<1)throw new Error('Invalid CoreMX mod ID');const data=await json(`${BASE}/api/mods/local-${n}`,fetcher);const mod=normalize(data.mod,true);if(!mod)throw new Error('CoreMX mod not found');return mod; }
module.exports={normalize,search,post};
