import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionSaver} from '../src/selection-save.js';

const draft={result:{period:{month:'2026-10',week:4}},workspaceRevision:7};
test('saving waits for confirmation, shares an in-flight request and does not resave success',async()=>{
  let finish,calls=0;
  const saver=createSelectionSaver({save:async value=>{assert.equal(value,draft);calls++;return new Promise(resolve=>finish=resolve);}});
  saver.setDraft(draft);
  const pending=saver.save();assert.equal(saver.save(),pending);
  assert.equal(saver.getState().phase,'saving');assert.equal(saver.isSaving(),true);
  await Promise.resolve();assert.equal(calls,1);
  finish({period:draft.result.period});assert.equal(await pending,true);
  assert.equal(saver.getState().phase,'saved');assert.equal(saver.getState().receipt.period.week,4);
  await saver.save();assert.equal(calls,1);assert.equal(saver.isSaving(),false);
});

test('a failed save retains the same generated snapshot and can retry without regeneration',async()=>{
  const submitted=[];
  const saver=createSelectionSaver({save:async value=>{submitted.push(value);if(submitted.length===1)throw new Error('Sin conexión');return {savedAt:'2026-10-16'};}});
  saver.setDraft(draft);assert.equal(await saver.save(),false);
  assert.equal(saver.getState().phase,'error');assert.equal(saver.getState().error,'Sin conexión');
  assert.equal(await saver.save(),true);assert.deepEqual(submitted,[draft,draft]);
});

test('late save responses cannot mark a replacement draft or signed-out view as saved',async()=>{
  for(const replacement of [null,{result:{period:{week:5}}}]){
    let finish;
    const saver=createSelectionSaver({save:()=>new Promise(resolve=>finish=resolve)});
    saver.setDraft(draft);const pending=saver.save();await Promise.resolve();
    saver.setDraft(replacement);assert.equal(saver.isSaving(),true);
    finish({period:draft.result.period});await pending;
    assert.equal(saver.getState().phase,'idle');assert.equal(saver.getState().receipt,null);
  }
});

test('no draft cannot be saved and a fresh generation resets the save status',async()=>{
  let calls=0;const saver=createSelectionSaver({save:async()=>{calls++;}});
  assert.equal(await saver.save(),false);assert.equal(calls,0);
  saver.setDraft(draft);await saver.save();
  saver.setDraft({...draft});assert.equal(saver.getState().phase,'idle');
  await saver.save();assert.equal(calls,2);
});
