const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/publishToPages.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, Error });
const { publishToPages } = exportsObject;
const pages = ['A', 'B', 'C'].map(pageId => ({ pageId, name: pageId }));
test('publishes each selected Page exactly once and reports progress', async () => {
  const calls = [], progress = [];
  const result = await publishToPages(pages, async id => calls.push(id), r => progress.push(r));
  assert.deepEqual(calls, ['A', 'B', 'C']);
  assert.equal(result.length, 3);
  assert.equal(progress.length, 3);
  assert.ok(result.every(r => r.status === 'success'));
});
test('continues after failure and retry targets only failed Pages', async () => {
  const calls = [];
  const result = await publishToPages(pages, async id => { calls.push(id); if (id === 'B') throw new Error('Accès refusé'); }, () => {});
  assert.deepEqual(calls, ['A', 'B', 'C']);
  assert.equal(result[1].error, 'Accès refusé');
  const retry = pages.filter(page => result.find(r => r.pageId === page.pageId)?.status !== 'success');
  const retried = [];
  await publishToPages(retry, async id => retried.push(id), () => {});
  assert.deepEqual(retried, ['B']);
});
test('empty selection sends nothing', async () => {
  const result = await publishToPages([], async () => assert.fail('Unexpected send'), () => assert.fail('Unexpected result'));
  assert.equal(result.length, 0);
});
