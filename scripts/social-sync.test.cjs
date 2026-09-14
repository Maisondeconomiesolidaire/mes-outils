const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function load(file,imports={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],URL,AbortSignal,...globals});return exports;}
const snapshot=load('convex/lib/socialSyncSnapshot.ts');
test('only complete snapshots may remove old posts; protects concurrent/new sends',()=>{
 const now=Date.now();const old={createdAt:now-300000,_creationTime:now-300000};
 assert.equal(snapshot.deletionDecision({...old,scheduledFor:now},now,true),'keep');
 assert.equal(snapshot.deletionDecision(old,now,true),'remove');assert.equal(snapshot.deletionDecision(old,now,false),'keep');
 assert.equal(snapshot.deletionDecision({...old,createdAt:now},now,true),'keep');assert.equal(snapshot.deletionDecision({...old,_creationTime:now+1},now,true),'keep');
});
test('pagination gathers every page and recognizes a genuinely empty account',async()=>{
 let calls=0;const api=load('convex/lib/socialSyncSnapshot.ts',{}, {fetch:async()=>({ok:true,json:async()=>++calls===1?{data:[{id:'a',caption:'Photo',timestamp:'2026-01-01T12:00:00Z'}],paging:{next:'https://graph.facebook.com/next'}}:{data:[]}})});
 const result=await api.fetchSocialSnapshot('https://graph.facebook.com/start','token','instagram');assert.equal(calls,2);assert.equal(result.complete,true);assert.equal(result.posts[0].message,'Photo');
 const empty=await api.fetchSocialSnapshot('https://graph.facebook.com/start','token','instagram');assert.equal(empty.complete,true);assert.equal(empty.posts.length,0);
});
test('errors, malformed pages and unsafe paging never masquerade as empty snapshots',async()=>{
 for(const result of [{error:{code:190}},{},{data:[{message:'no id'}]},{data:[],paging:{next:'https://untrusted.example'}}]){
  const api=load('convex/lib/socialSyncSnapshot.ts',{}, {fetch:async()=>({ok:true,json:async()=>result})});await assert.rejects(api.fetchSocialSnapshot('https://graph.facebook.com/start','token','facebook'));
 }
 let calls=0;const api=load('convex/lib/socialSyncSnapshot.ts',{}, {fetch:async()=>({ok:true,json:async()=>++calls===1?{data:[{id:'a'}],paging:{next:'https://graph.facebook.com/next'}}:{error:{code:4}}})});
 await assert.rejects(api.fetchSocialSnapshot('https://graph.facebook.com/start','token','facebook'));
});
function fixture(){
 const now=Date.now();const rows={socialSyncState:[{_id:'state',key:'global',startedAt:now,leaseUntil:0}],socialFacebookPosts:[],socialDeliveries:[],socialCompositions:[],posts:[{_id:'internal-post',body:'Independent internal post'}],socialFacebookPages:[{_id:'page'}]};
 let serial=0;const ctx={db:{
 query:name=>{let pred=[];const obj={withIndex:(_,cb)=>{const q={eq:(k,v)=>{pred.push(r=>r[k]===v);return q;}};cb(q);return obj;},collect:async()=>rows[name].filter(r=>pred.every(p=>p(r))),unique:async()=>rows[name].find(r=>pred.every(p=>p(r)))};return obj;},
 get:async id=>Object.values(rows).flat().find(r=>r._id===id),insert:async(name,data)=>{const id='new'+ ++serial;rows[name].push({_id:id,_creationTime:now+1,...data});return id;},patch:async(id,data)=>Object.assign(Object.values(rows).flat().find(r=>r._id===id),data),delete:async id=>{for(const name of Object.keys(rows))rows[name]=rows[name].filter(r=>r._id!==id);}
 }};
 const api=load('convex/socialSync.ts',{'convex/values':{v:new Proxy({},{get:()=>()=>({})})},'./_generated/server':Object.fromEntries(['action','query','internalQuery','internalMutation','internalAction'].map(k=>[k,x=>x])),'./_generated/api':{internal:{}},'./lib':{requireCrmPermission:async()=>{}},'./lib/socialSyncSnapshot':snapshot});
 const args={network:'facebook',targetId:'fb',targetName:'Recyclerie',startedAt:now,complete:true,posts:[]};return {ctx,api,rows,args,now};
}
test('confirmed deletion clears the event record and published delivery but retains other targets and internal post',async()=>{
 const f=fixture();f.rows.socialFacebookPosts.push({_id:'record',composerId:'composition',pageId:'fb',postId:'remote',createdAt:f.now-300000,_creationTime:f.now-300000});
 f.rows.socialDeliveries.push({_id:'delivery',compositionId:'composition',network:'facebook',targetId:'fb',postId:'remote',status:'published'},{_id:'other',compositionId:'composition',network:'facebook',targetId:'other',postId:'another',status:'published'});
 const result=await f.api.applySnapshot.handler(f.ctx,f.args);assert.equal(result.removed,1);assert.equal(f.rows.socialFacebookPosts.length,0);assert.equal(f.rows.socialDeliveries.length,1);assert.equal(f.rows.posts.length,1);
});
test('imports external posts, updates edited text, and never deletes on incomplete history',async()=>{
 const f=fixture();f.rows.socialFacebookPosts.push({_id:'existing',pageId:'fb',postId:'old',message:'Old',createdAt:f.now-300000,_creationTime:f.now-300000});
 await f.api.applySnapshot.handler(f.ctx,{...f.args,complete:false,posts:[{id:'external',message:'From Facebook',createdAt:f.now-500000}]});assert.equal(f.rows.socialFacebookPosts.length,2);
 await f.api.applySnapshot.handler(f.ctx,{...f.args,complete:false,posts:[{id:'external',message:'Edited',createdAt:f.now-500000}]});assert.equal(f.rows.socialFacebookPosts.length,2);assert.equal(f.rows.socialFacebookPosts.find(p=>p.postId==='external').message,'Edited');
});
test('ignores stale sync runs and rejects credential-bearing profile URLs',async()=>{
 const f=fixture();const result=await f.api.applySnapshot.handler(f.ctx,{...f.args,startedAt:1,posts:[{id:'x',createdAt:1}]});assert.equal(result.imported,0);
 await f.api.saveProfile.handler(f.ctx,{pageId:'page',network:'facebook',imageUrl:'https://graph.facebook.com/picture?access_token=secret'});assert.equal(f.rows.socialFacebookPages[0].profileImageUrl,undefined);
 await f.api.saveProfile.handler(f.ctx,{pageId:'page',network:'facebook',imageUrl:'https://cdn.example/photo.jpg'});assert.equal(f.rows.socialFacebookPages[0].profileImageUrl,'https://cdn.example/photo.jpg');
});
