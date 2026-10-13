import test from 'node:test';
import assert from 'node:assert/strict';
import {processFiles, FILE_LIMIT, FILE_BYTES_LIMIT, TOTAL_BYTES_LIMIT, OBSERVATION_LIMIT} from '../import-processor.mjs';

function file(name, text) {
  return {name, size: Buffer.byteLength(text), text: async () => text};
}

test('multiple Fieldwatch exports import transactionally with correct daily counts', async () => {
  const input = [
    file('one.jsonl',
      '{"ts":1760200200000,"kind":"WIFI","mac":"AA:BB","name":"AP","rssi":-60}\n' +
      '{"ts":1760200500000,"kind":"WIFI","mac":"AA:BB","name":"AP","rssi":-50}\n'),
    file('two.csv', 'timestamp,kind,mac,name,rssi\n1760286600000,BLE,CC:DD,BLE beacon,-70\n'),
  ];
  const result = await processFiles(input);
  assert.equal(result.observations, 3);
  assert.equal(result.devices.length, 2);
  assert.equal(result.devices.find(x => x.kind === 'WIFI').hits, 2);
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.dailyCounts.map(x => x.count), [2, 1]);
});

test('one malformed file rejects a whole batch and never returns partial data', async () => {
  await assert.rejects(processFiles([
    file('valid.jsonl', '{"ts":1760200200000,"kind":"WIFI","mac":"AA"}\n'),
    file('invalid.jsonl', '{"broken":\n'),
  ]), /JSONL invalide/);
});

test('large single-file imports avoid argument-spread stack overflow', async () => {
  const n = 125000;
  const line = '{"ts":1760200200000,"kind":"BLE","mac":"AA:BB"}\n';
  const result = await processFiles([file('long.jsonl', line.repeat(n))]);
  assert.equal(result.observations, n);
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].hits, n);
  assert.deepEqual(result.dailyCounts.map(x=>x.count), [n]);
});

test('input limits are checked before reading file contents', async () => {
  const notRead = {name:'big.jsonl',size:FILE_BYTES_LIMIT+1,text:async()=>{throw Error('should not read');}};
  await assert.rejects(processFiles([notRead]), /40 Mo/);
  const tooMany=Array.from({length:FILE_LIMIT+1},()=>file('a.jsonl',''));
  await assert.rejects(processFiles(tooMany), /20 fichiers/);
  const a={name:'a.jsonl',size:FILE_BYTES_LIMIT,text:async()=>{throw Error('not read');}};
  const b={name:'b.jsonl',size:FILE_BYTES_LIMIT,text:async()=>{throw Error('not read');}};
  const c={name:'c.jsonl',size:1,text:async()=>{throw Error('not read');}};
  await assert.rejects(processFiles([a,b,c]), /80 Mo/);
  assert.equal(OBSERVATION_LIMIT,250000);
  assert.equal(TOTAL_BYTES_LIMIT,2*FILE_BYTES_LIMIT);
});

test('empty files return an empty data set with no stale records', async () => {
  const res=await processFiles([]);
  assert.equal(res.observations,0);
  assert.equal(res.devices.length,0);
  assert.deepEqual(res.dailyCounts,[]);
});

test('WiGLE GeoExport rows contribute to the daily timeline', async () => {
  const csv = [
    'WigleWifi-1.4,appRelease=Fieldwatch 1.1.26',
    'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type',
    'AA:BB:CC:DD:EE:FF,Router,[ESS],2026-10-11 22:35:00,6,-48,46.780000,4.850000,0,0,WIFI',
    'AA:BB:CC:DD:EE:FE,Beacon,,2026-10-12 01:15:00,0,-65,46.780000,4.850000,0,0,BLE',
    '',
  ].join('\n');
  const result = await processFiles([file('geographical-wigle.csv',csv)]);
  assert.equal(result.observations,2);
  assert.equal(result.devices.length,2);
  assert.deepEqual(result.dailyCounts,[
    {date:'2026-10-11',count:1},
    {date:'2026-10-12',count:1},
  ]);
});
