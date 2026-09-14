const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,extras={}){
 const exports={};const internal={socialAi:{begin:'begin',finish:'finish'},socialEnhancements:{previewSource:'previewSource'}};
 const modules={'convex/values':{v:new Proxy({},{get:()=>()=>({})})},'./_generated/server':Object.fromEntries(['action','query','internalQuery','internalMutation'].map(k=>[k,x=>x])),'./_generated/api':{internal},'./lib':{requireCrmPermission:async()=>{},requireUser:async()=>({subject:'user'})}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>modules[n],URL,AbortSignal,process:{env:{OPENAI_API_KEY:'fake-test-key'}},...extras});return exports;
}
test('Facebook iframe points to the original post and never includes credentials',async()=>{
 const api=load('convex/socialEnhancements.ts',{fetch:()=>{throw Error('Not expected');}});
 const result=await api.publishedPreview.handler({runQuery:async()=>({network:'facebook',postId:'123_456',accessToken:'secret'})},{id:'record'});
 assert.equal(result.permalink,'https://www.facebook.com/123/posts/456');
 assert.equal(new URL(result.embedUrl).searchParams.get('href'),result.permalink);
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('Instagram resolves the actual permalink and rejects untrusted embed origins',async()=>{
 let permalink='https://www.instagram.com/p/REAL_CODE/';let auth;
 const api=load('convex/socialEnhancements.ts',{fetch:async(url,opts)=>{auth=opts.headers.Authorization;return {ok:true,json:async()=>({permalink})};}});
 const ctx={runQuery:async()=>({network:'instagram',postId:'123',accessToken:'private-token'})};
 const result=await api.publishedPreview.handler(ctx,{id:'record'});
 assert.equal(result.embedUrl,'https://www.instagram.com/p/REAL_CODE/embed/captioned/');assert.equal(auth,'Bearer private-token');assert.ok(!JSON.stringify(result).includes('private-token'));
 permalink='https://untrusted.example/p/REAL_CODE/';await assert.rejects(api.publishedPreview.handler(ctx,{id:'record'}),/invalide/);
});
test('publication status distinguishes pending, complete success and partial failure',async()=>{
 const api=load('convex/socialEnhancements.ts');let statuses=['published','publishing'];
 const ctx={db:{query:()=>({withIndex:()=>({collect:async()=>statuses.map(status=>({status}))})})}};
 assert.equal((await api.publicationStatus.handler(ctx,{id:'post'})).pending,true);
 statuses=['published','published'];const done=await api.publicationStatus.handler(ctx,{id:'post'});assert.equal(done.published,done.total);assert.equal(done.pending,false);
 statuses=['published','failed'];const partial=await api.publicationStatus.handler(ctx,{id:'post'});assert.equal(partial.failed,1);assert.notEqual(partial.published,partial.total);
});
test('AI authorizes before calling provider, uses community manager prompt and persists proposal and usage',async()=>{
 let sent;let saved;let calls=0;
 const api=load('convex/socialAi.ts',{fetch:async(url,opts)=>{calls++;sent=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'Une seconde vie à découvrir.'})}}],usage:{prompt_tokens:120,completion_tokens:30}})};}});
 const args={keywords:'meubles, seconde main',networks:['facebook'],pageNames:['Recyclerie']};
 await assert.rejects(api.generate.handler({runMutation:async()=>{throw Error('permission');}},args));assert.equal(calls,0);
 const result=await api.generate.handler({runMutation:async(name,args)=>{if(name==='begin')return 'draft-id';saved=args;}},args);
 assert.equal(result.text,'Une seconde vie à découvrir.');assert.equal(saved.inputTokens,120);assert.equal(saved.outputTokens,30);
 assert.match(sent.messages[0].content,/community manager expérimenté/);assert.match(sent.messages[0].content,/N'invente jamais/);assert.match(sent.messages[1].content,/meubles/);
});
test('AI rejects malformed or truncated output and records failure without replacing the post',async()=>{
 for (const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:'{"text":123}'}},{finish_reason:'stop',message:{content:'invalid'}}]) {
  let saved;const api=load('convex/socialAi.ts',{fetch:async()=>({ok:true,json:async()=>({choices:[choice]})})});
  await assert.rejects(api.generate.handler({runMutation:async(name,args)=>{if(name==='begin')return 'draft';saved=args;}},{keywords:'test',networks:['facebook'],pageNames:[]}));
  assert.ok(saved.error);assert.equal(saved.text,undefined);
 }
});
