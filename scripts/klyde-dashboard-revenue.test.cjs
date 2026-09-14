const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name]});
 return exports;
}
const sales=load('convex/lib/klydeSalesRevenue.ts');
test('counts sold, shipped and won stock once, with actual price fallback',()=>{
 const result=sales.summarizeKlydeSales([
  {status:'en_cours_envoi',price:20,actualSalePrice:15},
  {status:'envoye',price:10,actualSalePrice:0,outlet:'mobifrip'},
  {status:'gagne',price:12},
  {status:'vendu',price:8},
  {status:'stock',price:999},
  {status:'en_ligne',price:999},
 ]);
 assert.equal(result.revenue,45);assert.equal(result.salesCount,4);
 assert.equal(result.byOutlet.klyd,35);assert.equal(result.byOutlet.mobifrip,10);
});
test('group total counts only Vinted sales, excluding stores and boutique orders',async()=>{
 const dashboard=load('convex/dashboard.ts',{
  'convex/values':{v:new Proxy({},{get:()=>()=>({})})},
  './_generated/server':{query:definition=>definition},
  './lib':{requireAdmin:async()=>{}},'./processes':{STEP:{}},
  './lib/klydeSalesRevenue':sales,
 });
 const tables={requests:[],ventes:[],bikes:[],cycleRequests:[],klydeItems:[
 {_id:'a',vinted:true,status:'gagne',price:30,outlet:'klyd'},
 {_id:'b',vinted:true,status:'envoye',actualSalePrice:20,outlet:'mobifrip'},
 {_id:'c',vinted:false,status:'gagne',price:40},
 {_id:'d',vinted:true,status:'en_cours_envoi',price:99},
 ],klydeOrders:[{status:'payee',total:99,itemIds:['d']}],klydeStoreRevenues:[{site:'60',year:2026,amount:999}],klydeStoreAnnualRevenues:[{site:'60',year:2025,amount:68022}]};
 const result=await dashboard.globalStats.handler({db:{query:name=>({collect:async()=>tables[name]})}},{});
 assert.equal(result.klyde.revenue,50);assert.equal(result.totalRevenue,50);
 assert.equal(result.klyde.paidOrders,1);
});
test('filters all revenue sources by Paris year/month and retains year choices', async () => {
 const dashboard=load('convex/dashboard.ts',{
  'convex/values':{v:new Proxy({},{get:()=>()=>({})})},
  './_generated/server':{query:definition=>definition},
  './lib':{requireAdmin:async()=>{}},'./processes':{STEP:{}},
  './lib/klydeSalesRevenue':sales,
 });
 const jan=Date.parse('2025-12-31T23:30:00Z'); // January in Paris
 const feb=Date.parse('2026-02-10T12:00:00Z');
 const old=Date.parse('2025-06-10T12:00:00Z');
 const tables={
  requests:[{type:'collecte',outcome:'gagnee',quoteAmount:100,createdAt:old,fieldEdits:{outcome:{at:jan}}}],
  ventes:[{total:20,date:jan},{total:50,date:feb}],
  bikes:[{status:'sold',price:200,updatedAt:jan}],cycleRequests:[],klydeOrders:[],
  klydeItems:[{_id:'a',vinted:true,status:'gagne',price:30,saleRecordedAt:jan,updatedAt:feb},
   {_id:'b',vinted:true,status:'envoye',price:40,soldAt:feb},
   {_id:'c',vinted:true,status:'vendu',price:10,updatedAt:old}],
 };
 const ctx={db:{query:name=>({collect:async()=>tables[name]})}};
 const january=await dashboard.globalStats.handler(ctx,{year:2026,month:1});
 assert.equal(january.totalRevenue,350);
 assert.equal(january.klyde.salesCount,1);
 assert.ok(january.availableYears.includes(2025));
 assert.equal((await dashboard.globalStats.handler(ctx,{year:2026})).totalRevenue,440);
 assert.equal((await dashboard.globalStats.handler(ctx,{year:2025})).totalRevenue,10);
 assert.equal((await dashboard.globalStats.handler(ctx,{year:2026,month:3})).totalRevenue,0);
 await assert.rejects(dashboard.globalStats.handler(ctx,{year:2026,month:13}),/Mois invalide/);
});
