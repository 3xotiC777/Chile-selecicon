import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFile } from '../src/files.js';

test('captures immediately and reuses bytes after source access is lost',async()=>{
  let reads=0;
  const bytes=new Uint8Array([1,2,3]).buffer;
  const file={name:'planning.xlsm',arrayBuffer(){reads++;if(reads>1)throw new DOMException('File changed','NotReadableError');return Promise.resolve(bytes);}};
  const snapshot=captureFile(file,'la planeación');
  assert.equal(reads,1);assert.equal(await snapshot.task,bytes);assert.equal(snapshot.bytes,bytes);
  assert.equal(await snapshot.task,bytes);assert.equal(reads,1);
});

test('names the unreadable file and gives recovery steps in Spanish',async()=>{
  const cause=new DOMException('The requested file could not be read','NotReadableError');
  const snapshot=captureFile({name:'export.xlsx',arrayBuffer:()=>Promise.reject(cause)},'el export');
  await assert.rejects(snapshot.task,error=>{
    assert.equal(error.name,'FileReadError');assert.equal(error.cause,cause);
    assert.match(error.message,/el export.*export.xlsx/);assert.match(error.message,/Mantener siempre en este dispositivo/);assert.match(error.message,/vuelve a seleccionar/);
    return true;
  });
  assert.equal(snapshot.bytes,null);
});

test('a delayed previous file cannot overwrite a replacement snapshot',async()=>{
  let finish;
  const old=captureFile({name:'old.xlsm',arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})},'la planeación');
  const nextBytes=new Uint8Array([2]).buffer;
  const next=captureFile({name:'new.xlsm',arrayBuffer:()=>Promise.resolve(nextBytes)},'la planeación');
  await next.task;finish(new Uint8Array([1]).buffer);await old.task;
  assert.equal(next.bytes,nextBytes);assert.notEqual(old.bytes,next.bytes);
});
