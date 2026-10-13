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
