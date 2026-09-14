const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load() {
  const exports = {}, calls = [], records = [];
  const validator = new Proxy({}, {get: () => () => ({})});
  const social = new Proxy({}, {get: (_, key) => String(key)});
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('convex/social.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports, URLSearchParams, Date, Error,
    require: path => path === 'convex/values' ? {v:validator} : path.endsWith('/server') ? new Proxy({}, {get:()=>x=>x}) : path.endsWith('/api') ? {internal:{social}} : {requireCrmPermission:async ctx=>{if(ctx.denied)throw new Error('Forbidden');}},
    fetch: async (url,options) => { calls.push({url,params:options.body}); return {ok:true,json:async()=>({id:`remote-${calls.length}`})}; },
  });
  const payload = {page:{pageId:'page',name:'Page',accessToken:'fake-test-token'},event:{title:'Titre',description:'Texte',photoUrl:'https://example.test/photo.jpg'}};
  const ctx = {storage:{getUrl:async id=>`https://example.test/${id}.jpg`},runMutation:async (_,args)=>records.push(args),runQuery:async (name,args)=>{
    if(name==='assertCanPublish')return {clerkId:'user',name:'Auteur'};
    if(name==='eventPayload'){assert.equal(args.sourcePostId,'source-post');return payload;}
    if(name==='instagramTargets')return [{instagramId:'instagram',username:'compte',accessToken:'fake-test-token'}];
    throw new Error(name);
  }};
  return {api:exports,calls,records,ctx};
}
test('post payload preserves title, text, link and cover; requires read permission',async()=>{
 const {api}=load();
 const ctx={db:{get:async()=>({title:'Titre',body:'Texte',externalLink:'https://example.test',images:['photo']})},storage:{getUrl:async()=> 'https://example.test/photo.jpg'}};
 const result=await api.eventPayload.handler(ctx,{sourcePostId:'source-post',pageId:'',skipPage:true});
 assert.equal(result.event.description,'Texte\n\nhttps://example.test');
 assert.equal(result.event.photoUrl,'https://example.test/photo.jpg');
 await assert.rejects(()=>api.eventPayload.handler({...ctx,denied:true},{sourcePostId:'source-post',pageId:'',skipPage:true}),/Forbidden/);
 await assert.rejects(()=>api.eventPayload.handler(ctx,{sourcePostId:'source-post',eventId:'event',skipPage:true}),/un seul/);
});
test('Facebook sends chosen images and records the source post',async()=>{
 const {api,ctx,calls,records}=load();
 await api.publishEvent.handler(ctx,{sourcePostId:'source-post',pageId:'page',message:'Texte édité',photoStorageIds:['one','two']});
 assert.equal(calls.length,3);
 assert.equal(calls[2].params.get('message'),'Texte édité');
 assert.ok(calls[2].params.get('attached_media[1]'));
 assert.equal(records[0].sourcePostId,'source-post');
});
test('removing all photos does not silently restore the cover',async()=>{
 const {api,ctx,calls}=load();
 await api.publishEvent.handler(ctx,{sourcePostId:'source-post',pageId:'page',photoStorageIds:[]});
 assert.equal(calls.length,1);
 assert.ok(calls[0].url.endsWith('/feed'));
});
test('Instagram publishes edited caption with source post tracking',async()=>{
 const {api,ctx,calls,records}=load();
 await api.publishEventToInstagram.handler(ctx,{sourcePostId:'source-post',instagramIds:['instagram'],message:'Légende éditée',photoStorageIds:['one']});
 assert.equal(calls[0].params.get('caption'),'Légende éditée');
 assert.ok(calls[1].url.endsWith('/media_publish'));
 assert.equal(records[0].sourcePostId,'source-post');
});
test('publishing permission is checked before any social request',async()=>{
 for(const name of ['publishEvent','publishEventToInstagram']){
  const {api,ctx,calls}=load();ctx.runQuery=async()=>{throw new Error('Forbidden');};
  await assert.rejects(()=>api[name].handler(ctx,{sourcePostId:'source-post',pageId:'page',instagramIds:['instagram'],photoStorageIds:['one']}),/Forbidden/);
  assert.equal(calls.length,0);
 }
});
