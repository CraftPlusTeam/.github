import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectStats, renderStats, renderLanguages } from './update-stats.mjs';

function fixture(path) {
  if (path === 'orgs/CraftPlusTeam') return {public_repos:1,total_private_repos:1};
  if (path.includes('/repos?')) return [{name:'one',default_branch:'main'},{name:'empty',default_branch:'main'}];
  if (path.includes('/members?')) return [{login:'Alice'},{login:'Bob'}];
  if (path.endsWith('/languages')) return path.includes('/empty/')?{}:{TypeScript:300,JavaScript:100};
  if (path.includes('/branches?')) return path.includes('/empty/')?[]:[{name:'main',commit:{sha:'pinned'}}];
  if (path.includes('/commits?')) {
    assert.ok(path.includes('sha=pinned'));
    return [{sha:'a',author:{login:'alice'}},{sha:'a',author:{login:'alice'}},
      {sha:'b',author:null},{sha:'c',author:{login:'outside'}},{sha:'d',author:{login:'Bob'}}];
  }
  if (path.includes('/pulls?')) return path.includes('/empty/')?[]:[{merged_at:'2026-01-01'},{merged_at:null}];
  throw new Error('Unexpected request');
}
test('pinned histories, case-insensitive author mapping, zero-history repos and unattributed commits',()=>{
  const data=collectStats(fixture,new Date('2026-09-29T00:00:00Z'));
  assert.equal(data.commits,4); assert.equal(data.other,2); assert.equal(data.merged,1);
  assert.equal(data.repositories,2); assert.deepEqual(data.languages,[{name:'TypeScript',bytes:300},{name:'JavaScript',bytes:100}]); assert.deepEqual(data.members,[{login:'Alice',commits:1},{login:'Bob',commits:1}]);
  assert.equal(data.commits,data.other+data.members.reduce((s,m)=>s+m.commits,0));
});
test('partial organization visibility aborts',()=>{
  assert.throws(()=>collectStats(p=>p==='orgs/CraftPlusTeam'?{public_repos:1,total_private_repos:8}:fixture(p)),/読み取り権限/);
});
test('API failures propagate instead of generating partial output',()=>{
  assert.throws(()=>collectStats(p=>{if(p.includes('/commits?'))throw new Error('offline');return fixture(p)}),/offline/);
});
test('zero contributors, XML escaping and proportion bars',()=>{
  const svg=renderStats({commits:4,repositories:2,merged:0,other:3,members:[{login:'a&b',commits:1},{login:'zero',commits:0}],updated:'test'});
  assert.ok(svg.includes('a&amp;b')); assert.ok(svg.includes('width="260.50"'));
  assert.ok(svg.includes('25.0%')); assert.ok(svg.includes('0.0%'));
  assert.ok(!svg.includes('NaN')); assert.ok(svg.includes('prefers-reduced-motion'));
});
test('language shares round to 100% and aggregate the tail',()=>{
 const svg=renderLanguages({languages:Array.from({length:10},(_,i)=>({name:'Language '+i,bytes:1})),updated:'now'});
 assert.ok(svg.includes('Other 30.0%'));
 assert.equal([...svg.matchAll(/<circle /g)].length,8);
 const thirds=renderLanguages({languages:[{name:'A',bytes:1},{name:'B',bytes:1},{name:'C',bytes:1}],updated:'now'});
 assert.ok(thirds.includes('A 33.4%, B 33.3%, C 33.3%'));
 const empty=renderLanguages({languages:[],updated:'now'});
 assert.ok(empty.includes('No language data'));assert.ok(!empty.includes('NaN'));
});
