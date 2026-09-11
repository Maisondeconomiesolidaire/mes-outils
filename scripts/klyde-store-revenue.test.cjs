const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const result = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('convex/lib/klydeStoreRevenue.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, result);
const summarize = (...args) => JSON.parse(JSON.stringify(result.exports.summarizeStoreRevenue(...args)));
const annual = [{ site: '76', amount: 31112 }, { site: '60', amount: 36910 }];
test('2025 annual total is 68022 with no invented monthly detail', () => {
  assert.deepEqual(summarize([], annual, null), { bySite: { '60': 36910, '76': 31112 }, revenue: 68022 });
  for (let month = 0; month < 12; month++) assert.equal(summarize([], annual, month).revenue, 0);
});
test('dated entries are not counted twice against an annual total', () => {
  const details = [{ site: '76', amount: 100 }, { site: '60', amount: 200 }];
  assert.equal(summarize(details, annual, null).revenue, 68022);
  assert.equal(summarize(details, annual, 5).revenue, 300);
});
test('sites without annual totals keep their existing detailed sales', () => {
  assert.deepEqual(summarize([{ site: '60', amount: 250 }], [annual[0]], null), { bySite: { '60': 250, '76': 31112 }, revenue: 31362 });
});
test('zero annual totals remain authoritative and cents are rounded', () => {
  assert.equal(summarize([{ site: '60', amount: 100 }], [{ site: '60', amount: 0 }], null).revenue, 0);
  assert.equal(summarize([{ site: '60', amount: 0.1 }, { site: '60', amount: 0.2 }], [], null).revenue, 0.3);
});
