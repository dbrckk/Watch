/**
 * End-to-end smoke tests in real Chromium, without external radio data.
 * Run: npm --prefix web/e2e install --no-package-lock --ignore-scripts
 *      WATCH_CHROME_BIN=/usr/bin/google-chrome node web/e2e/smoke.mjs
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const artifacts=resolve(root,'e2e/artifacts');
const mimetypes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml','.png':'image/png'};
let browser, server, page;
const errors=[];
const cases=[
  {ts:1760200200000,kind:'WIFI',mac:'AA:BB:CC:11:22:33',name:'Coffee Hotspot',rssi:-53,lat:46.78,lon:4.85},
  {ts:1760200260000,kind:'WIFI',mac:'AA:BB:CC:11:22:33',name:'Coffee Hotspot',rssi:-50,lat:46.78,lon:4.85},
  {ts:1760200200000,kind:'BLE',mac:'DD:EE:FF:44:55:66',name:'Beacon sensor',rssi:-70,lat:46.79,lon:4.84},
];
const lines=cases.map(x=>JSON.stringify(x)).join('\n')+'\n';
const filePayload={name:'fieldwatch-test.jsonl',mimeType:'application/x-ndjson',buffer:Buffer.from(lines)};

function staticServer(){
  return createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const full=resolve(root,filename);
    if(!full.startsWith(root+sep)||!Object.hasOwn(mimetypes,extname(full))){
      res.writeHead(404);res.end('Not Found');return;
    }
    try{
      const body=await readFile(full);
      res.writeHead(200,{'Content-Type':mimetypes[extname(full)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(body);
    }catch{
      res.writeHead(404);res.end('Not Found');
    }
  });
}
async function expectText(selector,expected,timeout=15000){
  await page.waitForFunction(([selector,expected])=>
    document.querySelector(selector)?.textContent?.trim()===expected,
  [selector,expected],{timeout});
}
async function limited(task,ms,label){
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' : délai de '+ms+' ms dépassé')),ms);}),
    ]);
  } finally {clearTimeout(timer);}
}
async function step(label,fn){
  await limited(Promise.resolve().then(fn),22000,label);
  process.stdout.write('PASS '+label+'\n');
}
try{
  server=staticServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.WATCH_CHROME_BIN;
  assert.ok(executablePath,'Set WATCH_CHROME_BIN to installed Chromium/Chrome binary');
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,
    acceptDownloads:true,serviceWorkers:'allow',
  });
  page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('favicon.ico'))errors.push(msg.text());});
  await step('Page loads on Android-sized viewport',async()=>{
    const resp=await page.goto(origin+'/',{waitUntil:'networkidle'});
    assert.equal(resp.status(),200);
    await page.locator('#metric-total').waitFor();
    assert.equal(await page.locator('#metric-total').textContent(),'—');
    assert.ok(await page.locator('#privacy-toggle').isChecked());
    const viewport=await page.evaluate(()=>({
      layout:innerWidth,visible:visualViewport?.width||innerWidth,
      document:document.documentElement.scrollWidth
    }));
    assert.ok(viewport.layout<=viewport.visible+3 && viewport.document<=viewport.visible+3,
      'mobile layout exceeds physical screen: '+JSON.stringify(viewport));
  });
  await step('Import real JSONL via file picker and background Worker',async()=>{
    await page.locator('#import-input').setInputFiles(filePayload);
    await expectText('#metric-total','2');
    await expectText('#metric-wifi','1');
    await expectText('#metric-ble','1');
    await expectText('#metric-geo','2');
    assert.match(await page.locator('#file-status').textContent(),/3 observations/);
    assert.equal(await page.locator('#timeline .chart-col').count(),1);
  });
  await step('Search/filter and radio details conceal MAC by default',async()=>{
    await page.locator('[data-view="devices"]').click();
    await expectText('#list-count','2 résultat(s) · 3 observation(s) importée(s)');
    assert.equal(await page.locator('#device-list .radio-row').count(),2);
    await page.locator('#device-search').fill('Beacon');
    assert.equal(await page.locator('#device-list .radio-row').count(),1);
    await page.locator('#device-list .radio-row').click();
    assert.ok(await page.locator('#device-dialog').isVisible());
    const masked=await page.locator('#dialog-details').textContent();
    assert.ok(!masked.includes('DD:EE:FF:44:55:66'),'dialog leaked raw MAC in privacy mode');
    const closeInfo=await page.locator('#close-dialog').evaluate(button=>{
      const r=button.getBoundingClientRect();
      const px=r.left+r.width/2,py=r.top+r.height/2;
      const hit=document.elementFromPoint(px,py);
      return {
        rect:{left:r.left,top:r.top,width:r.width,height:r.height},
        hit:hit?.tagName+'#'+(hit?.id||''),
        hitClass:hit?.className?.toString?.().slice(0,100),
        visual:{width:visualViewport?.width,height:visualViewport?.height,offsetTop:visualViewport?.offsetTop},
        viewport:{width:innerWidth,height:innerHeight,scrollY},
      };
    });
    process.stdout.write('Dialog close hit-test: '+JSON.stringify(closeInfo)+'\n');
    await page.locator('#close-dialog').click({timeout:5000});
    await page.locator('#device-search').fill('');
  });
  await step('JSON download masks raw identifiers and GPS, CSV remains safe',async()=>{
    const [download]=await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-json').click(),
    ]);
    const stream=await download.createReadStream();
    const chunks=[];for await(const c of stream)chunks.push(c);
    const exported=Buffer.concat(chunks).toString('utf8');
    const parsed=JSON.parse(exported);
    assert.equal(parsed.privacyMasked,true);
    assert.equal(parsed.devices.length,2);
    assert.equal(new Set(parsed.devices.map(d=>d.mac)).size,2,'private aliases collided');
    assert.ok(parsed.devices.every(d=>d.mac.startsWith('WATCH-')),'missing opaque aliases');
    assert.ok(!exported.includes('DD:EE:FF:44:55:66'));
    assert.ok(!exported.includes('46.78'));
    assert.ok(!exported.includes('46.79'));
    for(const item of parsed.devices) assert.equal(item.position,null);
  });
  await step('Malformed import does not destroy previous data',async()=>{
    await page.locator('#import-input').setInputFiles({
      name:'broken.jsonl',mimeType:'application/x-ndjson',buffer:Buffer.from('{"broken":\n'),
    });
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent?.includes('JSONL invalide'));
    await page.locator('[data-view="overview"]').click();
    await expectText('#metric-total','2');
  });
  await step('Local positional map renders without external tile services',async()=>{
    await page.locator('[data-view="map"]').click();
    await expectText('#map-count','2 position(s)');
    const size=await page.locator('#map-canvas').evaluate(c=>({width:c.width,height:c.height}));
    assert.ok(size.width>0 && size.height>0);
    assert.ok(await page.locator('#map-empty').isVisible(),'GPS map leaked when privacy enabled');
    assert.match(await page.locator('#map-empty').textContent(),/Confidentialité/);
    await page.locator('#privacy-toggle').uncheck();
    assert.ok(await page.locator('#map-empty').isHidden(),'GPS visualization did not unlock');
    await page.locator('#privacy-toggle').check();
    assert.ok(await page.locator('#map-empty').isVisible(),'GPS visualization did not lock again');
  });
  await step('Real service worker intercepts OS-style multipart share',async()=>{
    await page.goto(origin+'/',{waitUntil:'networkidle'});
    await limited(page.evaluate(async()=>{
      const ready=await navigator.serviceWorker.ready;
      return {active:ready.active?.state};
    }),12000,'service worker ready');
    await page.reload({waitUntil:'networkidle'});
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:15000});
    const outcome=await page.evaluate(async jsonl=>{
      const form=new FormData();
      form.append('log',new File([jsonl],'android-share.jsonl',{type:'application/x-ndjson'}));
      const resp=await fetch('./share-target',{method:'POST',body:form});
      return {status:resp.status,url:resp.url};
    },lines);
    assert.ok(outcome.url.includes('shared=1'),JSON.stringify(outcome));
    await page.goto(origin+'/?shared=1',{waitUntil:'networkidle'});
    await expectText('#metric-total','2');
    const count=await page.evaluate(async()=>{
      const cache=await caches.open('watch-share-inbox-v1');
      return (await cache.keys()).length;
    });
    assert.equal(count,0,'temporary shared file remained in private cache');
  });
  await step('Offline reload works for an installed PWA after precache',async()=>{
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#metric-total').waitFor();
    assert.equal(await page.locator('#metric-total').textContent(),'—');
    await context.setOffline(false);
  });
  await step('Session can be explicitly cleared',async()=>{
    await page.locator('#import-input').setInputFiles(filePayload);
    await expectText('#metric-total','2');
    await page.locator('#clear-data').click();
    await expectText('#metric-total','—');
  });
  await step('Fieldwatch geographic WiGLE CSV preserves the UTC timeline and positions',async()=>{
    const wigle = [
      'WigleWifi-1.4,appRelease=Fieldwatch 1.1.26',
      'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type',
      'AA:BB:CC:00:11:22,Geo station,[ESS],2026-10-11 23:45:00,6,-42,46.780000,4.850000,0,0,WIFI',
      'AA:BB:CC:00:11:23,Geo beacon,,2026-10-12 00:15:00,0,-61,46.790000,4.840000,0,0,BLE',
      '',
    ].join('\n');
    await page.locator('#import-input').setInputFiles({
      name:'Fieldwatch-geo.csv',mimeType:'text/csv',buffer:Buffer.from(wigle),
    });
    await expectText('#metric-total','2');
    await expectText('#metric-geo','2');
    const chartDates=await page.locator('#timeline .chart-col small').allTextContents();
    assert.deepEqual(chartDates.map(s=>s.trim()),['10-11','10-12']);
    await page.locator('[data-view="devices"]').click();
    await page.locator('#device-search').fill('Geo station');
    assert.equal(await page.locator('#device-list .radio-row').count(),1);
    await page.locator('#device-list .radio-row').click();
    assert.match(await page.locator('#dialog-details').textContent(),/12\/10\/2026|11\/10\/2026/);
    await page.locator('#close-dialog').click();
  });
  assert.deepEqual(errors,[],'Unexpected browser script or console errors');
  process.stdout.write('\nWatch real Chromium smoke test passed.\n');
}catch(err){
  process.stderr.write('BROWSER SMOKE FAILED: '+(err?.stack||err)+'\n');
  if(page){
    try{await mkdir(artifacts,{recursive:true});await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});}
    catch(e){process.stderr.write('Screenshot failed: '+e.message+'\n');}
  }
  process.exitCode=1;
}finally{
  try{await browser?.close();}catch{}
  try{await new Promise(resolve=>server?.close(resolve)??resolve());}catch{}
}
