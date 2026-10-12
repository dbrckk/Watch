import {parseInput,aggregate,selectDevices,toCsv,summary} from './core.mjs';

const $ = id => document.getElementById(id);
const state = {records:[],devices:[],files:[],privacy:true,filter:'ALL',sort:'recent',query:'',limit:100,view:'overview'};
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
    ['Meilleur RSSI',d.rssi === null ? 'Inconnu' : d.rssi + ' dBm'],
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
  const s=summary(state.devices,state.records.length);
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
  const valid=state.records.filter(d=>d.lastSeen && Number.isFinite(d.lastSeen) && Math.abs(d.lastSeen)<=8640000000000000);
  if (!valid.length) {
    timeline.classList.add('empty-chart');
    timeline.append(element('p','','La chronologie apparaîtra après importation de données horodatées.'));
    $('timeline-range').textContent='Aucune donnée';
    return;
  }
  timeline.classList.remove('empty-chart');
  const counts=new Map();
  for (const d of valid) {
    const date=new Date(d.lastSeen).toISOString().slice(0,10);
    counts.set(date,(counts.get(date)||0)+1);
  }
  const dates=[...counts.keys()].sort().slice(-10);
  const max=Math.max(...dates.map(d=>counts.get(d)));
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
  $('list-count').textContent=devices.length+' résultat(s) · '+state.records.length+' observation(s) importée(s)';
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
  $('map-empty').hidden=pts.length>0;
  if(!pts.length) return;
  let minLat=Math.min(...pts.map(p=>p.lat)),maxLat=Math.max(...pts.map(p=>p.lat));
  let minLon=Math.min(...pts.map(p=>p.lon)),maxLon=Math.max(...pts.map(p=>p.lon));
  const latRange=Math.max(.0002,maxLat-minLat),lonRange=Math.max(.0002,maxLon-minLon);
  for(const p of pts){
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
  $('file-status').textContent=has ? state.files.join(', ') + ' · ' +state.records.length+' observations' : 'Aucun fichier chargé';
  $('clear-data').disabled=!has;
  $('status-text').textContent=has ? state.devices.length+' radios analysées sur cet appareil' : 'En attente de relevés · aucun transfert de données';
}
async function importFiles(fileList){
  const files=Array.from(fileList).filter(f=>f && f.name);
  if(!files.length)return;
  if(files.length>20){notify('20 fichiers maximum par import.',true);return;}
  if(files.some(f=>f.size>40*1024*1024)){notify('Un fichier dépasse la limite de 40 Mo.',true);return;}
  if(files.reduce((a,b)=>a+b.size,0)>80*1024*1024){notify('Import total limité à 80 Mo.',true);return;}
  try{
    const rows=[];const names=[];
    let ignored=0;
    for(const f of files){
      const r=parseInput(f.name,await f.text());
      rows.push(...r.records);
      ignored+=r.ignored;
      names.push(f.name);
      if(rows.length>250000)throw new Error('250 000 observations maximum par session.');
    }
    state.records=rows;state.devices=aggregate(rows);state.files=names;state.limit=100;
    refresh();
    notify(rows.length+' observations importées. '+state.devices.length+' radios distinctes.'+(ignored?' '+ignored+' ligne(s) ignorée(s).':''));
    view('overview');
  } catch(err){notify('Import impossible : '+(err?.message||'format invalide'),true);}
  $('import-input').value='';
}
function privacyDevices(devices){
  if(!state.privacy)return devices;
  return devices.map(d=>({...d,mac:shortId(d.mac),position:null}));
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
$('clear-data').addEventListener('click',()=>{state.records=[];state.devices=[];state.files=[];refresh();notify('Données effacées de cette session.');});
$('close-dialog').addEventListener('click',()=>$('device-dialog').close());
window.addEventListener('resize',()=>{if(state.view==='map')drawMap();});
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
refresh();
