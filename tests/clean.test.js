const test = require('node:test');
const assert = require('node:assert');
const Clean = require('../clean.js');
const EWS = require('../ews.js');

const col = (res, name) => res.headers.indexOf(name);
const get = (res, r, name) => res.rows[r][col(res, name)];

test('找到非第一列的標題、拆血壓、去單位、範圍檢查', () => {
  const aoa = [
    ['XX醫院 7A 病房 生命徵象紀錄'],
    ['列印日期：2026/10/01'],
    [],
    ['床號', '病歷號', '日期時間', 'BT', 'PR', 'RR', 'BP', 'SpO2', 'O2', '意識'],
    ['01', 'A001', '10/01 08:00', '36.5℃', '88 bpm', '18次', '120/80', '98%', 'RA', '清醒'],
    ['02', 'A002', '10/01 08:00', '９８.６', '１１０', '２２', '９０／６０', 0.93, 'NC 3L', 'E3V4M6'],
    ['03', 'A003', '10/01 08:00', '365', '--', '20', '80/130', '97', '無', 'A'],
    ['床號', '病歷號', '日期時間', 'BT', 'PR', 'RR', 'BP', 'SpO2', 'O2', '意識'],
    ['01', 'A001', '10/01 08:00', '36.5℃', '88 bpm', '18次', '120/80', '98%', 'RA', '清醒'],
  ];
  const res = Clean.cleanTable(aoa);
  assert.strictEqual(res.info.headerRow, 4);
  assert.strictEqual(res.rows.length, 3);
  assert.strictEqual(res.info.dropped.header, 1);
  assert.strictEqual(res.info.dropped.duplicate, 1);
  assert.deepStrictEqual(res.headers.slice(0, 3), ['床號', '病歷號', '日期時間']);

  assert.strictEqual(get(res, 0, '體溫(°C)'), 36.5);
  assert.strictEqual(get(res, 0, '心跳'), 88);
  assert.strictEqual(get(res, 0, '呼吸'), 18);
  assert.strictEqual(get(res, 0, '收縮壓'), 120);
  assert.strictEqual(get(res, 0, '舒張壓'), 80);
  assert.strictEqual(get(res, 0, 'SpO2(%)'), 98);
  assert.strictEqual(get(res, 0, '氧氣'), '否');
  assert.strictEqual(get(res, 0, '意識'), 'A');

  assert.strictEqual(get(res, 1, '體溫(°C)'), 37); // 98.6°F
  assert.strictEqual(get(res, 1, '收縮壓'), 90);
  assert.strictEqual(get(res, 1, 'SpO2(%)'), 93);
  assert.strictEqual(get(res, 1, '氧氣'), '是');
  assert.strictEqual(get(res, 1, '意識'), null);
  assert.strictEqual(get(res, 1, 'GCS'), 13);

  assert.strictEqual(get(res, 2, '體溫(°C)'), null); // 365 不合理
  assert.strictEqual(get(res, 2, '心跳'), null);
  assert.strictEqual(get(res, 2, '收縮壓'), 130); // 顛倒對調
  assert.strictEqual(get(res, 2, '舒張壓'), 80);
  assert.ok(res.log.some((l) => l.row === 7 && /超出合理範圍/.test(l.note)));

  // 整理後的表格可以直接計分
  const map = EWS.autoMap(res.headers);
  for (const k of ['temp', 'hr', 'rr', 'sbp', 'spo2', 'onO2', 'consciousness', 'gcs']) assert.ok(map[k] !== undefined, k);
});

test('解析一格內的多項生命徵象', () => {
  const p = Clean.parseCombined('T:36.8 P:92 R:20 BP:132/84 SpO2:95% O2 2L/min GCS E4V5M6');
  assert.deepStrictEqual(p, { sbp: '132', dbp: '84', temp: '36.8', hr: '92', rr: '20', spo2: '95', gcs: 'E4V5M6', onO2: '2L/min' });
  const q = Clean.parseCombined('體溫 37.9 脈搏 118 呼吸 24 血壓 98/60 血氧 91 意識 混亂');
  assert.deepStrictEqual(q, { sbp: '98', dbp: '60', temp: '37.9', hr: '118', rr: '24', spo2: '91', consciousness: '混亂' });

  const aoa = [
    ['病歷號', '時間', '生命徵象', '備註'],
    ['B001', '08:00', 'T:36.8 P:92 R:20 BP:132/84 SpO2:95%', ''],
    ['B002', '08:00', 'T 39.2 HR 128 RR 26 BP 88/50 SpO2 89% O2 NC 3L LOC V', '發燒'],
  ];
  const res = Clean.cleanTable(aoa);
  assert.strictEqual(res.info.combinedColumn, '生命徵象');
  assert.deepStrictEqual(res.headers.slice(0, 3), ['病歷號', '時間', '備註']);
  assert.strictEqual(get(res, 1, '體溫(°C)'), 39.2);
  assert.strictEqual(get(res, 1, '心跳'), 128);
  assert.strictEqual(get(res, 1, '收縮壓'), 88);
  assert.strictEqual(get(res, 1, '氧氣'), '是');
  assert.strictEqual(get(res, 1, '意識'), 'V');
  assert.strictEqual(get(res, 0, '氧氣'), null);
});

test('兩列標題（合併儲存格）與 E/V/M 分欄', () => {
  const aoa = [
    ['病歷號', '體溫', '血壓', '血壓', 'GCS', 'GCS', 'GCS'],
    ['', '', '收縮', '舒張', 'E', 'V', 'M'],
    ['C001', 37, 118, 76, 4, 5, 6],
    ['C002', 36.4, 102, 64, 2, 'T', 5],
  ];
  const res = Clean.cleanTable(aoa);
  assert.strictEqual(res.info.headerRows, 2);
  assert.strictEqual(get(res, 0, '收縮壓'), 118);
  assert.strictEqual(get(res, 0, '舒張壓'), 76);
  assert.strictEqual(get(res, 0, 'GCS'), 15);
  assert.strictEqual(get(res, 1, 'GCS'), 'E2VTM5');
});
