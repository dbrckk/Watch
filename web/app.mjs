import {selectDevices,toCsv,summary,exportDevices,geographicBounds,redactRadioText} from './core.mjs';
import {processFiles} from './import-processor.mjs';
import {saveSnapshot,loadSnapshot,hasSnapshot,removeSnapshot} from './session-store.mjs';

const $ = id => document.getElementById(id);
const state = {observations:0,dailyCounts:[],devices:[],files:[],importing:false,privacy:true,filter:'ALL',sort:'recent',query:'',limit:100,view:'overview',saved:null,localBusy:false,localAvailable:true,localStatus:'Recherche d’une sauvegarde locale…'};
const titles = {overview:"Vue d'ensemble",devices:"Observations",map:"Positions",setup:"Installer / partager",guide:"Guide & sécurité"};
let selectedRadio = null;

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
  return state.privacy ? 'Identifiant masqué' : mac;
}
function privateText(text, mac) {
  return state.privacy ? redactRadioText(text, mac) : text;
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
  info.append(element('strong','',privateText(d.name, d.mac) || (d.hidden ? 'Réseau masqué' : 'Radio sans nom')));
  info.append(element('small','',shortId(d.mac) + (d.vendor ? ' · ' + privateText(d.vendor, d.mac) : '')));
  row.append(info);
  const extra = element('div','radio-extra');
  extra.append(element('strong','',d.rssi === null ? '—' : d.rssi + ' dBm'));
  extra.append(element('small','',prettyDate(d.lastSeen)));
  row.append(extra);
  row.setAttribute('aria-label','Détails : ' + (privateText(d.name, d.mac) || d.kind) + ', ' + shortId(d.mac));
  row.addEventListener('click', () => openRadio(d));
  return row;
}
function openRadio(d) {
  selectedRadio = d;
  $('dialog-title').textContent = privateText(d.name, d.mac) || 'Radio ' + d.kind;
  const grid = element('div','details-grid');
  const fields = [
    ['Type',d.kind === 'BLE' ? 'Bluetooth LE' : 'Wi-Fi'],
    ['Identifiant',shortId(d.mac)],['Fabricant',privateText(d.vendor, d.mac) || 'Non identifié'],
    ['Dernier RSSI observé',d.rssi === null ? 'Inconnu' : d.rssi + ' dBm'],
    ['Première observation',prettyDate(d.firstSeen)],
    ['Dernière observation',prettyDate(d.lastSeen)],
    ['Occurrences dans les exports',d.hits],
    ['Canal',d.channel ?? '—'],['Fréquence',d.freq ? d.freq + ' MHz' : '—'],
    ['Coordonnées du téléphone',d.position && !state.privacy ?
      d.position.lat.toFixed(6) + ', ' + d.position.lon.toFixed(6) : 'Masquées ou non renseignées'],
    ['Signatures / groupes',privateText(d.fleets, d.mac) || '—']
  ];
  for (const [label,value] of fields) {
    const item=element('div','detail');
    item.append(element('label','',label),element('strong','',value));
    grid.append(item);
  }
  $('dialog-details').replaceChildren(grid);
  if (!$('device-dialog').open) $('device-dialog').showModal();
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
  $('clear-data').disabled=!has || state.importing || state.localBusy;
  $('import-input').disabled=state.importing || state.localBusy;
  $('save-local').disabled=!has || state.importing || state.localBusy || !state.localAvailable || state.saved===null;
  $('restore-local').disabled=state.saved!==true || state.importing || state.localBusy || !state.localAvailable;
  $('delete-local').disabled=state.saved!==true || state.importing || state.localBusy || !state.localAvailable;
  $('local-save-status').textContent=state.localStatus;
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
  if(state.importing || state.localBusy){notify('Une autre opération est déjà en cours.',true);return;}
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
async function initializeLocalSession() {
  try {
    state.saved=await hasSnapshot();
    state.localStatus=state.saved ? 'Une session enregistrée est disponible sur cet appareil.' :
      'Aucune sauvegarde locale. Rien ne sera enregistré automatiquement.';
  } catch {
    state.saved=false;
    state.localAvailable=false;
    state.localStatus='Stockage local inaccessible (mode privé ou navigateur incompatible).';
  }
  refresh();
}
async function saveLocalSession() {
  if (!state.files.length || state.importing || state.localBusy || !state.localAvailable) return;
  if (!confirm('Enregistrer ces observations sur cet appareil ? Les adresses MAC complètes et les coordonnées GPS éventuelles resteront dans ce navigateur, sans chiffrement supplémentaire. Ne pas utiliser sur un appareil partagé.')) return;
  state.localBusy=true;
  refresh();
  try {
    const at=await saveSnapshot({
      devices:state.devices,observations:state.observations,
      dailyCounts:state.dailyCounts,files:state.files,
    });
    state.saved=true;
    state.localStatus='Session enregistrée localement le '+prettyDate(at)+'.';
    notify('Sauvegarde enregistrée sur cet appareil uniquement.');
  } catch (err) {
    notify('Enregistrement impossible : '+(err?.message||'stockage indisponible'),true);
  } finally {
    state.localBusy=false;
    refresh();
  }
}
async function restoreLocalSession() {
  if (state.saved!==true || state.importing || state.localBusy) return;
  if (state.files.length && !confirm('Remplacer la session actuellement affichée par la sauvegarde locale ?')) return;
  state.localBusy=true;
  refresh();
  try {
    const saved=await loadSnapshot();
    if (!saved) throw new Error('Sauvegarde introuvable.');
    // Validate before modifying any displayed data: failed restores are atomic.
    state.devices=saved.devices;
    state.observations=saved.observations;
    state.dailyCounts=saved.dailyCounts;
    state.files=saved.files;
    state.limit=100;
    state.query='';state.filter='ALL';state.sort='recent';
    $('device-search').value='';
    $('kind-filter').value='ALL';
    $('sort-filter').value='recent';
    state.localStatus='Session enregistrée le '+prettyDate(saved.savedAt)+' disponible.';
    view('overview');
    notify('Session locale rechargée : '+saved.observations+' observations.');
  } catch (err) {
    notify('Rechargement impossible : '+(err?.message||'sauvegarde invalide'),true);
  } finally {
    state.localBusy=false;
    refresh();
  }
}
async function deleteLocalSession() {
  if (state.saved!==true || state.importing || state.localBusy) return;
  if (!confirm('Supprimer définitivement la sauvegarde de ce navigateur ? Les données de la session affichée resteront ouvertes jusqu’à leur effacement.')) return;
  state.localBusy=true;
  refresh();
  try {
    await removeSnapshot();
    state.saved=false;
    state.localStatus='Sauvegarde supprimée. Rien n’est conservé entre les sessions.';
    notify('Sauvegarde locale supprimée.');
  } catch (err) {
    notify('Suppression impossible : '+(err?.message||'stockage indisponible'),true);
  } finally {
    state.localBusy=false;
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
$('privacy-toggle').addEventListener('change',e=>{
  state.privacy=e.target.checked;
  refresh();
  if ($('device-dialog').open && selectedRadio) openRadio(selectedRadio);
});
$('device-search').addEventListener('input',e=>{state.query=e.target.value;state.limit=100;renderDevices();});
$('kind-filter').addEventListener('change',e=>{state.filter=e.target.value;state.limit=100;renderDevices();});
$('sort-filter').addEventListener('change',e=>{state.sort=e.target.value;state.limit=100;renderDevices();});
$('load-more').addEventListener('click',()=>{state.limit+=100;renderDevices();});
$('save-local').addEventListener('click',saveLocalSession);
$('restore-local').addEventListener('click',restoreLocalSession);
$('delete-local').addEventListener('click',deleteLocalSession);
/* Installability is controlled by the browser. Never claim native APK or PWA
   installation succeeded just because a button was tapped. */
let pendingPwaInstall = null;
function updateInstallStatus(message,canPrompt=false){
  $('pwa-install-status').textContent=message;
  $('install-pwa').hidden=!canPrompt;
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches ||
  navigator.standalone === true;
if (isStandalone()) updateInstallStatus('Console Web déjà ouverte en mode application.');
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  pendingPwaInstall=event;
  updateInstallStatus('Chrome propose une installation directe.',true);
});
window.addEventListener('appinstalled',()=>{
  pendingPwaInstall=null;
  updateInstallStatus('Console Web installée sur cet appareil.');
});
$('install-pwa').addEventListener('click',async()=>{
  const prompt=pendingPwaInstall;
  if(!prompt)return;
  pendingPwaInstall=null;
  $('install-pwa').hidden=true;
  try{
    await prompt.prompt();
    const result=await prompt.userChoice;
    updateInstallStatus(result?.outcome==='accepted'
      ? 'Installation acceptée dans Chrome. Vérifiez l’écran d’accueil.'
      : 'Installation annulée. Utilisez le menu de Chrome pour réessayer.');
  }catch{
    updateInstallStatus('Installation automatique indisponible. Utilisez le menu ⋮ de Chrome.');
  }
});
$('setup-import').addEventListener('click',()=>{
  view('overview');
  $('import-input').click();
});
document.querySelectorAll('[data-copy-source]').forEach(button=>{
  button.addEventListener('click',async()=>{
    const source=$(button.dataset.copySource);
    if(!source)return;
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(source.textContent.trim());
      notify('Commande copiée. Vérifiez le script et gardez votre clé privée.');
    }catch{
      notify('Copie indisponible. Sélectionnez la commande manuellement.',true);
    }
  });
});
$('export-csv').addEventListener('click',()=>exportData('csv'));
$('export-json').addEventListener('click',()=>exportData('json'));
$('clear-data').addEventListener('click',()=>{if(state.importing||state.localBusy)return;state.observations=0;state.dailyCounts=[];state.devices=[];state.files=[];refresh();notify('Session en mémoire effacée. Une sauvegarde locale éventuelle reste disponible séparément.');});
$('close-dialog').addEventListener('click',()=>$('device-dialog').close());
window.addEventListener('resize',()=>{if(state.view==='map')drawMap();});
// Secure contexts include HTTPS and the loopback origin used for local development.
if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});
refresh();
initializeLocalSession();

consumeIncomingShare();
