import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,parseInput,aggregate,selectDevices,toCsv,summary} from '../core.mjs';

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
