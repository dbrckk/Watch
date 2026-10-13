import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,parseInput,aggregate,selectDevices,toCsv,summary,exportDevices,geographicBounds} from '../core.mjs';

test('ingère le vrai format JSONL Fieldwatch', () => {
  const x = parseInput('log.jsonl', '{"ts":1760200200000,"iso":"2026-10-11T18:30:00Z","kind":"WIFI","mac":"AA:BB:CC:DD:EE:FF","name":"AP","rssi":-65,"lat":46.78,"lon":4.85}\n');
  assert.equal(x.records[0].kind, 'WIFI');
  assert.deepEqual(x.records[0].position, {lat:46.78,lon:4.85});
});
test('importe CSV avec champs entre guillemets et saut de ligne', () => {
  const v = parseCsv('timestamp,kind,mac,name,rssi\n1760200200000,BLE,11:22:33,"A, B\nC",-80\n');
  assert.equal(v[0].name, 'A, B\nC');
  assert.equal(parseInput('a.csv', 'timestamp,kind,mac,name,rssi\n1760200200000,BLE,11:22:33,Balise,-80').records.length, 1);
});
test('regroupe par radio et préserve le signal maximal', () => {
  const x = parseInput('a.json', JSON.stringify([{kind:'BLE',mac:'1',ts:1000000000000,rssi:-83},{kind:'BLE',mac:'1',ts:1000000001000,rssi:-65}]));
  const d = aggregate(x.records);
  assert.equal(d.length, 1);
  assert.equal(d[0].hits, 2);
  assert.equal(d[0].rssi, -65);
});
test('rejette les positions GPS invalides et les catégories inconnues', () => {
  const x = parseInput('a.json', JSON.stringify([{kind:'WIFI',mac:'a',lat:150,lon:3},{kind:'NFC',mac:'b'}]));
  assert.equal(x.ignored, 1);
  assert.equal(x.records[0].position, null);
});
test('filtre, trie, exporte avec protection contre les formules CSV', () => {
  const d = aggregate(parseInput('a.json', JSON.stringify([
    {kind:'WIFI',mac:'a',name:'=cmd',rssi:-10},{kind:'BLE',mac:'b',name:'beacon',rssi:-50}
  ])).records);
  assert.equal(selectDevices(d,'BEA','BLE')[0].mac,'B');
  assert.equal(selectDevices(d,'','ALL','signal')[0].mac,'A');
  assert.match(toCsv(d), /"'=cmd"/);
  assert.equal(summary(d,2).total,2);
});
test('CSV malformé échoue explicitement', () => {
  assert.throws(() => parseCsv('timestamp,kind,mac,name\n1,WIFI,a,"bad'), /guillemet/);
});

test('privacy: JSON export never exposes internal kind:MAC keys or GPS', () => {
  const mac='AA:BB:CC:DD:EE:FF';
  const d=aggregate(parseInput('sample.json',JSON.stringify([
    {kind:'WIFI',mac,name:'Home',lat:46.8,lon:4.8}
  ])).records);
  const safe=exportDevices(d,true);
  const json=JSON.stringify(safe);
  assert.equal(safe.length,1);
  assert.equal(safe[0].position,null);
  assert.equal(Object.hasOwn(safe[0],'key'),false);
  assert.equal(json.includes(mac),false);
  assert.equal(json.includes('46.8'),false);
  assert.equal(d[0].mac,mac,'raw session data must remain unchanged');
  const raw=exportDevices(d,false)[0];
  assert.equal(raw.mac,mac);
  assert.equal(raw.position.lat,46.8);
  assert.equal(Object.hasOwn(raw,'key'),false);
});
test('large GPS datasets have exact bounds without spread/argument overflow', () => {
  const n=160000;
  const points=Array.from({length:n},(_,i)=>({
    lat:46+(i/n),lon:4+(i/n)
  }));
  const bounds=geographicBounds(points);
  assert.equal(bounds.count,n);
  assert.equal(bounds.minLat,46);
  assert.equal(bounds.minLon,4);
  assert.ok(bounds.maxLat>46.99);
});
test('invalid timestamp is ignored instead of crashing CSV exports', () => {
  const x=parseInput('data.json',JSON.stringify([
    {kind:'BLE',mac:'test',ts:100000000000000000,first_seen:100000000000000000}
  ]));
  assert.equal(x.records[0].lastSeen,null);
  assert.doesNotThrow(()=>toCsv(x.records));
});

test('Watch CSV export can be re-imported without losing dates or GPS', () => {
  const raw = parseInput('source.jsonl',
    '{"ts":1760200200000,"kind":"WIFI","mac":"AA:BB:CC:DD:EE:FF","name":"AP","rssi":-61,"lat":46.78,"lon":4.85}\n');
  const devices = aggregate(raw.records);
  const imported = parseInput('watch.csv', toCsv(exportDevices(devices,false)));
  assert.equal(imported.records.length,1);
  const observed=imported.records[0];
  assert.equal(observed.lastSeen,1760200200000);
  assert.equal(observed.firstSeen,1760200200000);
  assert.deepEqual(observed.position,{lat:46.78,lon:4.85});
  assert.equal(observed.mac,'AA:BB:CC:DD:EE:FF');
});

test('Watch JSON export preserves timestamps and coordinates on re-import', () => {
  const raw = parseInput('source.jsonl',
    '{"ts":1760200200000,"kind":"BLE","mac":"AA:BB:CC:DD:EE:FF","rssi":-70,"lat":46.78,"lon":4.85}\n');
  const safe = exportDevices(aggregate(raw.records),false);
  const imported = parseInput('watch.json',JSON.stringify({devices:safe,privacyMasked:false}));
  assert.equal(imported.records[0].lastSeen,1760200200000);
  assert.deepEqual(imported.records[0].position,{lat:46.78,lon:4.85});
  assert.equal(imported.records[0].kind,'BLE');
});

test('private JSON exports must remain without GPS after re-import', () => {
  const raw = aggregate(parseInput('source.json',JSON.stringify([
    {kind:'BLE',mac:'AA:BB:CC:DD:EE:FF',lat:46.78,lon:4.85,ts:1760200200000}
  ])).records);
  const incoming = parseInput('safe.json', JSON.stringify({devices:exportDevices(raw,true)}));
  assert.equal(incoming.records[0].position,null);
  assert.notEqual(incoming.records[0].mac,'AA:BB:CC:DD:EE:FF');
});

test('private exports keep opaque MAC aliases unique across shared-prefix devices', () => {
  const raw=aggregate(parseInput('radios.json',JSON.stringify([
    {kind:'BLE',mac:'AA:BB:CC:11:22:33',name:'AA:BB:CC:11:22:33'},
    {kind:'BLE',mac:'AA:BB:CC:44:55:66',name:'Beacon'},
  ])).records);
  const safe=exportDevices(raw,true,'session01');
  assert.equal(safe.length,2);
  assert.notEqual(safe[0].mac,safe[1].mac);
  assert.ok(safe.every(d=>d.mac.startsWith('WATCH-session01-')));
  const json=JSON.stringify(safe);
  for(const d of raw)assert.equal(json.includes(d.mac),false);
  assert.equal(safe[0].name,safe[0].mac);
  assert.equal(safe[0].position,null);
  assert.notEqual(safe[0].mac,exportDevices(raw,true,'session02')[0].mac);
  assert.equal(aggregate(parseInput('watch.csv',toCsv(safe)).records).length,2);
  assert.equal(aggregate(parseInput('watch.json',JSON.stringify({devices:safe})).records).length,2);
});

test('imports real Fieldwatch GeoExport WiGLE CSV with UTC FirstSeen, Wi-Fi/BLE and GPS', () => {
  const source = [
    'WigleWifi-1.4,appRelease=Fieldwatch 1.1.26,device=test-device',
    'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type',
    'AA:BB:CC:DD:EE:01,"Radio, with comma",[ESS],2026-10-11 18:30:00,6,-51,46.780000,4.850000,0,0,WIFI',
    '11:22:33:44:55:66,BLE beacon,,2026-10-11 19:31:42,0,-79,46.790000,4.840000,0,0,BLE',
    '',
  ].join('\n');
  const result = parseInput('Fieldwatch-geo-wigle.csv', source);
  assert.equal(result.ignored, 0);
  assert.equal(result.records.length, 2);
  const [wifi, ble] = result.records;
  assert.equal(wifi.kind, 'WIFI');
  assert.equal(wifi.name, 'Radio, with comma');
  assert.equal(wifi.channel, 6);
  assert.equal(wifi.rssi, -51);
  assert.deepEqual(wifi.position, {lat:46.78, lon:4.85});
  assert.equal(wifi.firstSeen, Date.UTC(2026, 9, 11, 18, 30));
  assert.equal(wifi.lastSeen, Date.UTC(2026, 9, 11, 18, 30));
  assert.equal(ble.kind, 'BLE');
  assert.equal(ble.lastSeen, Date.UTC(2026, 9, 11, 19, 31, 42));
  assert.deepEqual(ble.position, {lat:46.79, lon:4.84});
  assert.equal(aggregate(result.records).length, 2);
});
test('FirstSeen-only normal exports also get a valid timeline endpoint', () => {
  const d = parseInput('watch.json', JSON.stringify({devices:[{
    kind:'BLE', mac:'AA:00', firstSeen:'2026-10-11T18:30:00Z', hits:8,
  }]})).records[0];
  assert.equal(d.firstSeen, Date.UTC(2026,9,11,18,30));
  assert.equal(d.lastSeen, d.firstSeen);
  assert.equal(d.hits, 8);
});

test('newest radio RSSI wins regardless of file order, not strongest historical reading', () => {
  const old={kind:'WIFI',mac:'AA:11',name:'old',ts:1760200200000,rssi:-21,channel:1,lat:45,lon:3};
  const recent={kind:'WIFI',mac:'AA:11',name:'current',ts:1760200300000,rssi:-78,channel:11,lat:46,lon:4};
  for (const rows of [[old,recent],[recent,old]]) {
    const result=aggregate(parseInput('log.json',JSON.stringify(rows)).records);
    assert.equal(result.length,1);
    assert.equal(result[0].rssi,-78);
    assert.equal(result[0].name,'current');
    assert.equal(result[0].lastSeen,1760200300000);
    assert.equal(result[0].firstSeen,1760200200000);
    assert.equal(result[0].channel,11);
    assert.deepEqual(result[0].position,{lat:46,lon:4});
    assert.equal(result[0].hits,2);
  }
});
test('missing RSSI on newest row allows fallback without losing timestamp', () => {
  const rows=[
    {kind:'BLE',mac:'AA:11',name:'Recent',ts:1760200300000,channel:7},
    {kind:'BLE',mac:'AA:11',name:'Outdated',ts:1760200200000,rssi:-60,channel:2},
  ];
  const d=aggregate(parseInput('log.json',JSON.stringify(rows)).records)[0];
  assert.equal(d.rssi,-60);
  assert.equal(d.name,'Recent');
  assert.equal(d.channel,7);
  assert.equal(d.lastSeen,1760200300000);
});
test('signal sorting uses each radio latest RSSI, not its historical peak', () => {
  const rows=[
    {kind:'WIFI',mac:'AA',ts:1760200200000,rssi:-10},
    {kind:'WIFI',mac:'BB',ts:1760200300000,rssi:-49},
    {kind:'WIFI',mac:'AA',ts:1760200400000,rssi:-90},
  ];
  const ranked=selectDevices(aggregate(parseInput('log.json',JSON.stringify(rows)).records),'','ALL','signal');
  assert.deepEqual(ranked.map(d=>d.mac),['BB','AA']);
  assert.deepEqual(ranked.map(d=>d.rssi),[-49,-90]);
});
