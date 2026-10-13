import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {File} from 'node:buffer';

const script = readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function makeWorker(){
  const entries=new Map();
  const listeners={};
  const context={
    self:{
      location:{origin:'https://watch.example'},
      registration:{scope:'https://watch.example/'},
      clients:{claim:()=>Promise.resolve()},
      skipWaiting:()=>Promise.resolve(),
      addEventListener:(type,handler)=>{listeners[type]=handler;},
    },
    caches:{
      open:async()=>({
        match:async key=>entries.get(key)?.clone()||undefined,
        put:async(key,value)=>{entries.set(key,value.clone());},
        delete:async key=>entries.delete(key),
      }),
      keys:async()=>[],
      match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone(),
    },
    URL,Response,Date,Number,Promise,
    fetch:async()=>{throw new Error('Unexpected network request');}
  };
  runInNewContext(script,context);
  async function dispatch(request){
    let result;
    listeners.fetch({request,respondWith:promise=>{result=promise;},waitUntil:()=>{}});
    if(!result)throw new Error('The worker did not intercept '+request.method);
    return await result;
  }
  async function share(form){
    return dispatch(new Request('https://watch.example/share-target',{method:'POST',body:form}));
  }
  async function getInbox(){
    return dispatch(new Request('https://watch.example/__watch_incoming_file__'));
  }
  return {share,getInbox,entries};
}
test('share_target declares a file POST with matching field',()=>{
  assert.equal(manifest.share_target.method,'POST');
  assert.equal(manifest.share_target.enctype,'multipart/form-data');
  assert.equal(manifest.share_target.params.files[0].name,'log');
  assert.ok(manifest.share_target.params.files[0].accept.includes('.jsonl'));
});
test('service worker intercepts real multipart JSONL without network',async()=>{
  const worker=makeWorker(),form=new FormData();
  form.append('log',new File(['{"kind":"BLE","mac":"aa"}\n'],'fieldwatch-log.jsonl',{type:'application/x-ndjson'}));
  const response=await worker.share(form);
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'https://watch.example/?shared=1');
  const stored=worker.entries.get('https://watch.example/__watch_incoming_file__');
  assert.ok(stored);
  assert.match(await stored.text(),/"kind":"BLE"/);
  assert.equal(decodeURIComponent(stored.headers.get('X-Watch-Name')),'fieldwatch-log.jsonl');
});
test('empty multipart is rejected, without data persistence',async()=>{
  const worker=makeWorker();
  const response=await worker.share(new FormData());
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'https://watch.example/?shared=error');
  assert.equal(worker.entries.size,0);
});
test('invalid extensions and zero-byte files fail closed',async()=>{
  for(const [name,contents] of [['notes.txt','abc'],['empty.jsonl','']]){
    const worker=makeWorker(),form=new FormData();
    form.append('log',new File([contents],name,{type:'text/plain'}));
    const r=await worker.share(form);
    assert.match(r.headers.get('location'),/shared=error/);
    assert.equal(worker.entries.size,0);
  }
});

test('private inbox is never exposed by service worker GET',async()=>{
  const worker=makeWorker(),form=new FormData();
  form.append('log',new File(['{"kind":"BLE","mac":"secret"}'],'fieldwatch.jsonl'));
  await worker.share(form);
  assert.equal(worker.entries.size,1);
  const response=await worker.getInbox();
  assert.equal(response.status,404);
  assert.doesNotMatch(await response.text(),/secret/);
});
