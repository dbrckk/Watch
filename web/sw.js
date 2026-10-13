/* Explicit user-initiated local Android -> PWA share handoff.
   Only the share POST is accepted. It never reaches the static host. */
const CACHE='watch-console-v2';
const INBOX='watch-share-inbox-v1';
const MAX_BYTES=40*1024*1024;
const AGE_MS=10*60*1000;
const ASSETS=['./','./index.html','./style.css','./app.mjs','./core.mjs','./manifest.webmanifest','./icon.svg'];
const shareTarget=new URL('./share-target',self.registration.scope).pathname;
const shareKey=new URL('./__watch_incoming_file__',self.registration.scope).href;
function redirect(params){return Response.redirect(new URL('./?'+params,self.registration.scope).href,303);}
async function expirePending(){
  const cache=await caches.open(INBOX);
  const r=await cache.match(shareKey);
  if(!r)return;
  const n=Number(r.headers.get('X-Watch-At'));
  if(!Number.isFinite(n)||n<=0||Date.now()-n>AGE_MS)await cache.delete(shareKey);
}
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('watch-console-')&&k!==CACHE).map(k=>caches.delete(k)))),
    expirePending()
  ]).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.method==='POST'&&url.pathname===shareTarget){
    event.respondWith((async()=>{
      try{
        const type=event.request.headers.get('content-type')||'';
        if(!type.startsWith('multipart/form-data'))return redirect('shared=error');
        const form=await event.request.formData();
        const file=form.get('log');
        if(!file||typeof file.name!=='string'||!/\.(csv|jsonl|ndjson|json)$/i.test(file.name)||
            !Number.isFinite(file.size)||file.size===0||file.size>MAX_BYTES)return redirect('shared=error');
        const cache=await caches.open(INBOX);
        await cache.put(shareKey,new Response(file,{headers:{
          'Content-Type':file.type||'application/octet-stream',
          'X-Watch-At':String(Date.now()),
          'X-Watch-Name':encodeURIComponent(file.name.slice(0,150)),
        }}));
        return redirect('shared=1');
      }catch{return redirect('shared=error');}
    })());
    return;
  }
  if(event.request.method!=='GET')return;
  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached)return cached;
    try{return await fetch(event.request);}
    catch{
      if(event.request.mode==='navigate'){
        const fallback=await caches.match('./index.html');
        if(fallback)return fallback;
      }
      return new Response('Offline',{status:503,headers:{'Content-Type':'text/plain'}});
    }
  })());
});
