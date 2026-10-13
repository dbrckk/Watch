import {selectDevices,toCsv,summary,exportDevices,geographicBounds} from './core.mjs';
import {processFiles} from './import-processor.mjs';

const $ = id => document.getElementById(id);
const state = {observations:0,dailyCounts:[],devices:[],files:[],importing:false,privacy:true,filter:'ALL',sort:'recent',query:'',limit:100,view:'overview'};
const titles = {overview:"Vue d'ensemble",devices:"Observations",map:"Positions",guide:"Guide & sécurité"};

function element(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function prettyDate(ms) {
  return ms && Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000 ?
    new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(ms)) : 'Non renseignée';
}
function shortId(mac) {
  if (!state.privacy) return mac;
  return mac.length < 6 ? '••••' : mac.slice(0,5) + '••:••';
}
function notify(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.style.borderColor = error ? '#b76c65' : '#426051';
  el.style.background = error ? '#3b2527' : '#1d392f';
  el.hidden = false;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => el.hidden = true, 6500);
}
function badgeFor(d) {
  return element('span','radio-type ' + (d.kind === 'BLE' ? 'ble' : ''),d.kind === 'BLE' ? 'BLE' : 'Wi-Fi');
}
function createRow(d) {
  const row = element('button','radio-row');
  row.type = 'button';
  row.append(badgeFor(d));
  const info = element('div','radio-info');
  info.append(element('strong','',d.name || (d.hidden ? 'Réseau masqué' : 'Radio sans nom')));
  info.append(element('small','',shortId(d.mac) + (d.vendor ? ' · ' + d.vendor : '')));
  row.append(info);
  const extra = element('div','radio-extra');
  extra.append(element('strong','',d.rssi === null ? '—' : d.rssi + ' dBm'));
  extra.append(element('small','',prettyDate(d.lastSeen)));
  row.append(extra);
  row.setAttribute('aria-label','Détails : ' + (d.name || d.kind) + ', ' + shortId(d.mac));
  row.addEventListener('click', () => openRadio(d));
  return row;
}
function openRadio(d) {
  $('dialog-title').textContent = d.name || 'Radio ' + d.kind;
  const grid = element('div','details-grid');
  const fields = [
    ['Type',d.kind === 'BLE' ? 'Bluetooth LE' : 'Wi-Fi'],
    ['Identifiant',shortId(d.mac)],['Fabricant',d.vendor || 'Non identifié'],
    ['Dernier RSSI observé',d.rssi === null ? 'Inconnu' : d.rssi + ' dBm'],
    ['Première observation',prettyDate(d.firstSeen)],
    ['Dernière observation',prettyDate(d.lastSeen)],
    ['Occurrences dans les exports',d.hits],
    ['Canal',d.channel ?? '—'],['Fréquence',d.freq ? d.freq + ' MHz' : '—'],
    ['Coordonnées du téléphone',d.position && !state.privacy ?
      d.position.lat.toFixed(6) + ', ' + d.position.lon.toFixed(6) : 'Masquées ou non renseignées'],
    ['Signatures / groupes',d.fleets || '—']
  ];
  for (const [label,value] of fields) {
    const item=element('div','detail');
    item.append(element('label','',label),element('strong','',value));
    grid.append(item);
  }
  $('dialog-details').replaceChildren(grid);
  $('device-dialog').showModal();
}
function metric(id, value) { $(id).textContent = state.files.length ? String(value) : '—'; }
function currentDevices() { return selectDevices(state.devices,state.query,state.filter,state.sort); }
function renderOverview() {
  const s=summary(state.devices,state.observations);
  metric('metric-total',s.total);
  metric('metric-wifi',s.wifi);
  metric('metric-ble',s.ble);
  metric('metric-geo',s.geotagged);
  const recent=$('recent-list');
  recent.replaceChildren();
  const all=selectDevices(state.devices,'','ALL','recent').slice(0,6);
  if (!all.length) recent.append(element('p','empty-state','Aucune observation. Importez un export de l’application Android.'));
  for (const d of all) recent.append(createRow(d));
  const timeline=$('timeline');
  timeline.replaceChildren();
  if (!state.dailyCounts.length) {
    timeline.classList.add('empty-chart');
    timeline.append(element('p','','La chronologie apparaîtra après importation de données horodatées.'));
    $('timeline-range').textContent='Aucune donnée';
    return;
  }
  timeline.classList.remove('empty-chart');
  const days=state.dailyCounts.slice(-10);
  const counts=new Map(days.map(item=>[item.date,item.count]));
  const dates=days.map(d=>d.date);
  const max=Math.max(...days.map(d=>d.count));
  $('timeline-range').textContent=dates.length+' jour(s)';
  for (const date of dates) {
    const col=element('div','chart-col');
    col.title=date + ' : ' + counts.get(date)+' observations';
    col.append(element('strong','',counts.get(date)));
    const track=element('div','bar-track');
    const bar=element('div','bar');
    bar.style.height=Math.max(2,100*counts.get(date)/max)+'%';
    track.append(bar);col.append(track);
    col.append(element('small','',date.slice(5)));
    timeline.append(col);
  }
}
function renderDevices() {
  const devices=currentDevices();
  $('device-list').replaceChildren();
  $('list-count').textContent=devices.length+' résultat(s) · '+state.observations+' observation(s) importée(s)';
  if (!devices.length) $('device-list').append(element('p','empty-state',state.devices.length ? 'Aucune radio ne correspond aux filtres.' : 'Aucun relevé chargé.'));
  devices.slice(0,state.limit).forEach(d=>$('device-list').append(createRow(d)));
  $('load-more').hidden=devices.length<=state.limit;
  $('export-csv').disabled=!devices.length;
  $('export-json').disabled=!devices.length;
}
function view(name) {
  if (!titles[name]) return;
  state.view=name;
  for(const n of document.querySelectorAll('.panel-view')) n.hidden=n.id!=='view-'+name;
  for(const n of document.querySelectorAll('[data-view]')) {
    const selected=n.dataset.view===name;
    n.classList.toggle('active',selected);
    if(selected) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current');
  }
  $('page-title').textContent=titles[name];
  if(name==='map') requestAnimationFrame(drawMap);
  if(name==='devices') renderDevices();
}
function drawMap() {
  const canvas=$('map-canvas'), ctx=canvas.getContext('2d');
  const rect=canvas.getBoundingClientRect();
  if(rect.width<1 || rect.height<1) return;
  const ratio=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(rect.width*ratio);
  canvas.height=Math.round(rect.height*ratio);
  ctx.scale(ratio,ratio);
  const w=rect.width,h=rect.height;
  ctx.fillStyle='#101a20';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#263a41';ctx.lineWidth=1;
  for(let x=22;x<w;x+=44){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=22;y<h;y+=44){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const pts=state.devices.filter(d=>d.position).map(d=>d.position);
  $('map-count').textContent=pts.length+' position(s)';
  $('map-empty').hidden=!state.privacy && pts.length>0;
  $('map-empty').textContent=state.privacy
    ? 'Affichage GPS désactivé en mode confidentialité. Désactivez Confidentialité pour afficher les positions.'
    : 'Importez des observations avec coordonnées GPS pour visualiser leurs positions.';
  // The canvas must not reveal GPS patterns with privacy turned on.
  if(state.privacy || !pts.length) return;
  const bounds=geographicBounds(pts);
  if(!bounds)return;
  const {minLat,maxLat,minLon,maxLon}=bounds;
  const latRange=Math.max(.0002,maxLat-minLat),lonRange=Math.max(.0002,maxLon-minLon);
  // Keep the drawing cost bounded on phones with very large radio histories.
  const stride=Math.max(1,Math.ceil(pts.length/12000));
  for(let i=0;i<pts.length;i+=stride){
    const p=pts[i];
    const x=30+(w-60)*(.5+(p.lon-(minLon+maxLon)/2)/lonRange);
    const y=30+(h-60)*(.5-(p.lat-(minLat+maxLat)/2)/latRange);
    ctx.fillStyle='#b5ee6840';ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#b5ee68';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#a2b6ba';ctx.font='12px system-ui';
  ctx.fillText('N ↑  ·  représentation relative, sans fond de carte',18,24);
  if(!state.privacy) ctx.fillText('GPS : '+minLat.toFixed(4)+' à '+maxLat.toFixed(4)+' / '+minLon.toFixed(4)+' à '+maxLon.toFixed(4),18,h-16);
}
function refresh() {
  renderOverview();renderDevices();if(state.view==='map')drawMap();
  const has=state.files.length>0;
  $('file-status').textContent=has ? state.files.join(', ') + ' · ' +state.observations+' observations' : 'Aucun fichier chargé';
  $('clear-data').disabled=!has;
  $('status-text').textContent=has ? state.devices.length+' radios analysées sur cet appareil' : 'En attente de relevés · aucun transfert de données';
}
async function processOffMain(files) {
  if (typeof Worker !== 'function') return processFiles(files);
  let worker;
  try {
    worker = new Worker(new URL('./import-worker.mjs', import.meta.url), {type:'module'});
  } catch {
    // Older embedded webviews without module Worker support.
    return processFiles(files);
  }
  return new Promise((resolve,reject)=>{
    const finish=()=>worker.terminate();
    worker.addEventListener('message',event=>{
      if(event.data?.id!==1)return;
      finish();
      if(event.data.ok)resolve(event.data.result);
      else reject(new Error(event.data.error || 'Importation impossible.'));
    });
    worker.addEventListener('error',()=>{
      finish();
      reject(new Error('Le module de traitement est indisponible. Rechargez Watch et réessayez.'));
    });
    worker.addEventListener('messageerror',()=>{
      finish();
      reject(new Error('Le résultat du traitement ne peut pas être reçu.'));
    });
    try { worker.postMessage({id:1,files}); }
    catch(error){ finish(); reject(error); }
  });
}
async function importFiles(fileList){
  const files=Array.from(fileList).filter(f=>f && f.name);
  if(!files.length)return;
  if(state.importing){notify('Une importation est déjà en cours.',true);return;}
  state.importing=true;
  $('import-input').disabled=true;
  $('clear-data').disabled=true;
  $('status-text').textContent='Analyse des relevés en cours sur cet appareil…';
  try {
    const result=await processOffMain(files);
    state.devices=result.devices;
    state.observations=result.observations;
    state.dailyCounts=result.dailyCounts;
    state.files=result.files;
    state.limit=100;
    refresh();
    notify(result.observations+' observations importées. '+result.devices.length+' radios distinctes.'+(result.ignored?' '+result.ignored+' ligne(s) ignorée(s).':''));
    view('overview');
  } catch(err){
    notify('Import impossible : '+(err?.message||'format invalide'),true);
  } finally {
    state.importing=false;
    $('import-input').disabled=false;
    $('import-input').value='';
    refresh();
  }
}
function privacyDevices(devices){
  const namespace=state.privacy ? crypto.randomUUID() : '';
  return exportDevices(devices,state.privacy,namespace);
}
function download(content,name,mime){
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportData(format){
  const devices=privacyDevices(currentDevices());
  if(!devices.length)return;
  const stamp=new Date().toISOString().slice(0,10);
  if(format==='csv')download(toCsv(devices,!state.privacy),'watch-export-'+stamp+'.csv','text/csv;charset=utf-8');
  else download(JSON.stringify({source:'Watch - derived Fieldwatch export',privacyMasked:state.privacy,devices},null,2),
    'watch-export-'+stamp+'.json','application/json');
  notify('Export '+format.toUpperCase()+' créé'+(state.privacy?' (identifiants et GPS masqués).':'.'));
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.go)));
$('import-input').addEventListener('change',e=>importFiles(e.target.files));

/* Browser-local receipt of an OS-selected shared file. The inbox cache is
   deleted before parsing so sensitive observations cannot outlive the import. */
async function consumeIncomingShare(){
  const params=new URLSearchParams(location.search);
  if(!params.has('shared'))return;
  history.replaceState(null,'',location.pathname+location.hash);
  if(params.get('shared')!=='1'){
    notify('Le fichier partagé est absent. Certaines versions de Chrome Android perdent les pièces jointes ; utilisez Importer.',true);
    return;
  }
  try{
    const cache=await caches.open('watch-share-inbox-v1');
    const key=new URL('./__watch_incoming_file__',location.href).href;
    const response=await cache.match(key);
    if(!response)throw Error('Aucun fichier reçu. Utilisez Importer.');
    await cache.delete(key);
    const age=Date.now()-Number(response.headers.get('X-Watch-At'));
    if(!Number.isFinite(age)||age<0||age>600000)throw Error('Partage expiré. Réessayez depuis Fieldwatch.');
    const name=decodeURIComponent(response.headers.get('X-Watch-Name')||'fieldwatch-log.jsonl');
    if(!/\.(csv|jsonl|ndjson|json)$/i.test(name))throw Error('Format non reconnu.');
    const blob=await response.blob();
    if(!blob.size||blob.size>40*1024*1024)throw Error('Le fichier est vide ou trop volumineux.');
    await importFiles([new File([blob],name,{type:blob.type})]);
  }catch(err){notify('Import par partage impossible : '+(err?.message||'erreur'),true);}
}

$('drop-zone').addEventListener('click',()=>$('import-input').click());
$('drop-zone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('import-input').click();}});
for(const name of ['dragenter','dragover'])$('drop-zone').addEventListener(name,e=>{e.preventDefault();e.currentTarget.classList.add('dragging');});
for(const name of ['dragleave','drop'])$('drop-zone').addEventListener(name,e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');});
$('drop-zone').addEventListener('drop',e=>importFiles(e.dataTransfer.files));
$('privacy-toggle').addEventListener('change',e=>{state.privacy=e.target.checked;refresh();});
$('device-search').addEventListener('input',e=>{state.query=e.target.value;state.limit=100;renderDevices();});
$('kind-filter').addEventListener('change',e=>{state.filter=e.target.value;state.limit=100;renderDevices();});
$('sort-filter').addEventListener('change',e=>{state.sort=e.target.value;state.limit=100;renderDevices();});
$('load-more').addEventListener('click',()=>{state.limit+=100;renderDevices();});
$('export-csv').addEventListener('click',()=>exportData('csv'));
$('export-json').addEventListener('click',()=>exportData('json'));
$('clear-data').addEventListener('click',()=>{if(state.importing)return;state.observations=0;state.dailyCounts=[];state.devices=[];state.files=[];refresh();notify('Données effacées de cette session.');});
$('close-dialog').addEventListener('click',()=>$('device-dialog').close());
window.addEventListener('resize',()=>{if(state.view==='map')drawMap();});
// Secure contexts include HTTPS and the loopback origin used for local development.
if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});
refresh();

consumeIncomingShare();
