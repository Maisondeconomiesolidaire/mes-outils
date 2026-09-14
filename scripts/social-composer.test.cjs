const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture({ denyCreate = false, facebookFails = false } = {}) {
 const rows = { socialFacebookPages: [{_id:'page',active:true,pageId:'fb',name:'Recyclerie',instagramId:'ig',instagramUsername:'recyclerie'}], socialCompositions:[], socialDeliveries:[],posts:[],socialFacebookPosts:[] };
 const jobs=[]; const calls=[]; let serial=0;
 const exports={};
 const internal={socialComposer:{deliver:'deliver',claim:'claim',finish:'finish'}};
 const modules={
  'convex/values':{v:new Proxy({},{get:()=>()=>({})})},
  './_generated/server':Object.fromEntries(['query','mutation','internalMutation','internalAction'].map(k=>[k,x=>x])),
  './_generated/api':{internal},
  './lib':{requireCrmPermission:async(ctx,page,action)=>{if(denyCreate&&action==='create')throw Error('Permission refusée');},requireUser:async()=>({subject:'user'}),formatUserName:()=> 'Test'},
  './social':{sendFacebook:async()=>{calls.push('facebook');if(facebookFails)throw Error('Page indisponible');return {postId:'fb-post'};},sendInstagram:async()=>{calls.push('instagram');return {published:['@recyclerie'],failed:[]};}},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('convex/socialComposer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>modules[n]});
 const ctx={db:{
  query:name=>{let predicates=[];const q={withIndex:(_,cb)=>{const range={eq:(k,v)=>{predicates.push(r=>r[k]===v);return range;},gte:(k,v)=>{predicates.push(r=>r[k]>=v);return range;},lt:(k,v)=>{predicates.push(r=>r[k]<v);return range;}};cb(range);return q;},collect:async()=>rows[name].filter(r=>predicates.every(p=>p(r))),unique:async()=>rows[name].find(r=>predicates.every(p=>p(r)))};return q;},
  insert:async(name,data)=>{const id=`${name}-${++serial}`;rows[name].push({_id:id,...data});return id;},
  get:async id=>Object.values(rows).flat().find(r=>r._id===id),
  patch:async(id,data)=>Object.assign(Object.values(rows).flat().find(r=>r._id===id),data),
  system:{get:async()=>({contentType:'image/jpeg'})},
 },scheduler:{runAt:async(date,fn,args)=>{jobs.push({date,fn,args});return 'scheduler-'+jobs.length;},cancel:async id=>calls.push('cancel:'+id)}};
 ctx.runMutation=async(name,args)=>exports[name].handler(ctx,args);
 return {api:exports,ctx,rows,jobs,calls};
}
const args={requestKey:'unique',message:'Un nouveau post',images:[],facebookIds:['fb'],instagramIds:[],publishOnMesoutils:false};
test('schedules each unique destination and publishes Mes Outils immediately only when requested',async()=>{
 const f=fixture();const date=Date.now()+86400000;
 const input={...args,facebookIds:['fb','fb'],instagramIds:['ig'],images:['photo'],scheduledFor:date,publishOnMesoutils:true};
 const id=await f.api.create.handler(f.ctx,input);
 assert.equal(f.rows.posts.length,1);assert.ok(f.rows.posts[0].createdAt<date);
 assert.equal(f.jobs.length,2);assert.ok(f.jobs.every(j=>j.date===date));
 assert.equal(await f.api.create.handler(f.ctx,input),id);assert.equal(f.jobs.length,2);assert.equal(f.rows.posts.length,1);
});
test('No leaves Mes Outils untouched and destination failures are isolated',async()=>{
 const f=fixture({facebookFails:true});await f.api.create.handler(f.ctx,{...args,images:['photo'],instagramIds:['ig']});
 assert.equal(f.rows.posts.length,0);
 for(const job of f.jobs) await f.api.deliver.handler(f.ctx,job.args);
 assert.equal(f.rows.socialDeliveries[0].status,'failed');
 assert.equal(f.rows.socialDeliveries[1].status,'published');
 await f.api.deliver.handler(f.ctx,f.jobs[1].args);assert.equal(f.calls.length,2);
});
test('rejects missing targets, stale dates, image-less Instagram and missing Mes Outils permission',async()=>{
 const f=fixture();
 for(const input of [{...args,facebookIds:[]},{...args,scheduledFor:Date.now()-1},{...args,instagramIds:['ig']},{...args,facebookIds:['missing']}]) await assert.rejects(f.api.create.handler(f.ctx,input));
 assert.equal(f.jobs.length,0);assert.equal(f.rows.socialCompositions.length,0);
 const denied=fixture({denyCreate:true});await assert.rejects(denied.api.create.handler(denied.ctx,{...args,publishOnMesoutils:true}),/Permission/);
});
test('cancelled deliveries cannot be claimed or sent',async()=>{
 const f=fixture();await f.api.create.handler(f.ctx,args);
 await f.api.cancel.handler(f.ctx,f.jobs[0].args);
 await f.api.deliver.handler(f.ctx,f.jobs[0].args);
 assert.equal(f.rows.socialDeliveries[0].status,'cancelled');assert.ok(!f.calls.includes('facebook'));
});
test('calendar includes historic shares and does not duplicate composer records',async()=>{
 const f=fixture();await f.api.create.handler(f.ctx,args);
 f.rows.socialFacebookPosts.push({_id:'legacy',network:'facebook',pageName:'Recyclerie',postId:'old',message:'Ancien',createdAt:Date.now(),authorName:'Test'}, {_id:'copy',composerId:f.rows.socialCompositions[0]._id,postId:'new',createdAt:Date.now()});
 const result=await f.api.list.handler(f.ctx,{start:Date.now()-10000,end:Date.now()+10000});
 assert.equal(result.length,2);assert.ok(result.some(p=>p.id==='legacy'));
});
test('social uploads convert PNG to JPEG even when conversion increases file size', async () => {
 const exports={};let sent;
 const modules={'convex/react':{useMutation:()=>async()=> 'mock-upload'},'../../convex/_generated/api':{api:{files:{generateUploadUrl:'upload'}}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/useUpload.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:n=>modules[n],File,Blob,
  createImageBitmap:async()=>({width:100,height:100,close(){}}),
  document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toBlob:(callback,type)=>callback(new Blob(['large converted image'],{type}))})},
  fetch:async(url,options)=>{sent=options;return {ok:true,json:async()=>({storageId:'photo'})};},
 });
 await exports.useUpload({jpeg:true})(new File(['png'],'test.png',{type:'image/png'}));
 assert.equal(sent.headers['Content-Type'],'image/jpeg');assert.equal(sent.body.name,'test.jpg');
 await exports.useUpload()(new File(['png'],'test.png',{type:'image/png'}));
 assert.equal(sent.headers['Content-Type'],'image/png');
});
