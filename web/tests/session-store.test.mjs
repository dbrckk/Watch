import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot,SNAPSHOT_VERSION} from '../session-store.mjs';
import {parseInput,aggregate} from '../core.mjs';

function checkpoint() {
  const devices=aggregate(parseInput('data.json',JSON.stringify([
    {kind:'WIFI',mac:'AA:BB:CC:DD:EE:FF',name:'AP',ts:1760200200000,rssi:-52,lat:46.78,lon:4.85},
    {kind:'BLE',mac:'11:22:33:44:55:66',name:'Beacon',ts:1760200200000,rssi:-69},
  ])).records);
  return {version:SNAPSHOT_VERSION,savedAt:1760200500000,observations:2,
    devices,dailyCounts:[{date:'2026-10-11',count:2}],files:['observations.json']};
}

test('explicit session checkpoint validation accepts complete Android observation metadata',()=>{
  const snapshot=checkpoint();
  assert.strictEqual(validateSnapshot(snapshot),snapshot);
  assert.deepEqual(snapshot.devices[0].position,{lat:46.78,lon:4.85});
  assert.equal(snapshot.devices[0].mac,'AA:BB:CC:DD:EE:FF');
});
test('corrupt or incompatible local checkpoints fail closed',()=>{
  const cases=[
    {version:0},{observations:-1},{observations:250001},
    {savedAt:0},{files:['']},{files:['a'.repeat(301)]},
    {dailyCounts:[{date:'2026-10-11',count:3}]},
    {dailyCounts:[{date:'not-a-day',count:1}]},
    {devices:[{kind:'BLE',mac:'X'}]},
  ];
  for(const changes of cases){
    assert.throws(()=>validateSnapshot({...checkpoint(),...changes}),/Sauvegarde|Chronologie/,
      'Invalid local checkpoint must not overwrite current session');
  }
});
test('a checkpoint with invalid identifiers, signal metadata or GPS is rejected',()=>{
  for(const edit of [
    d=>{d.key='WIFI:other';},
    d=>{d.name=42;},
    d=>{d.hits=0;},
    d=>{d.lastSeen=Infinity;},
    d=>{d.position={lat:95,lon:4};},
    d=>{d.rssi=NaN;},
  ]) {
    const snapshot=checkpoint();
    edit(snapshot.devices[0]);
    assert.throws(()=>validateSnapshot(snapshot),/radio invalide/);
  }
});
