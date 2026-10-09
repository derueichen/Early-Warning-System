const test = require('node:test');
const assert = require('node:assert');
const EWS = require('../ews.js');

const normal = { rr: 16, spo2: 98, onO2: '否', sbp: 125, hr: 78, consciousness: 'A', temp: 36.8 };

test('NEWS2 正常生命徵象為 0 分', () => {
  const r = EWS.calculate(normal, 'NEWS2');
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.risk.level, 'none');
});

test('NEWS2 各參數邊界', () => {
  const n = EWS.news2;
  assert.deepStrictEqual([8, 9, 11, 12, 20, 21, 24, 25].map(n.rr), [3, 1, 1, 0, 0, 2, 2, 3]);
  assert.deepStrictEqual([91, 92, 93, 94, 95, 96].map(n.spo2Scale1), [3, 2, 2, 1, 1, 0]);
  assert.deepStrictEqual([90, 91, 100, 101, 110, 111, 219, 220].map(n.sbp), [3, 2, 2, 1, 1, 0, 0, 3]);
  assert.deepStrictEqual([40, 41, 50, 51, 90, 91, 110, 111, 130, 131].map(n.hr), [3, 1, 1, 0, 0, 1, 1, 2, 2, 3]);
  assert.deepStrictEqual([35, 35.1, 36, 36.1, 38, 38.1, 39, 39.1].map(n.temp), [3, 1, 1, 0, 0, 1, 1, 2]);
  assert.deepStrictEqual([83, 84, 86, 88, 92].map((x) => n.spo2Scale2(x, true)), [3, 2, 1, 0, 0]);
  assert.deepStrictEqual([93, 95, 97].map((x) => n.spo2Scale2(x, true)), [1, 2, 3]);
  assert.deepStrictEqual([93, 97].map((x) => n.spo2Scale2(x, false)), [0, 0]);
});

test('NEWS2 風險分級', () => {
  const sick = EWS.calculate({ rr: 26, spo2: 90, onO2: '是', sbp: 88, hr: 128, consciousness: 'C', temp: 39.3 }, 'NEWS2');
  assert.strictEqual(sick.total, 3 + 3 + 2 + 3 + 2 + 3 + 2);
  assert.strictEqual(sick.risk.level, 'high');
  const single3 = EWS.calculate({ ...normal, rr: 8 }, 'NEWS2');
  assert.strictEqual(single3.total, 3);
  assert.strictEqual(single3.risk.level, 'low-medium');
  const med = EWS.calculate({ ...normal, rr: 22, hr: 115, temp: 38.5 }, 'NEWS2');
  assert.strictEqual(med.total, 5);
  assert.strictEqual(med.risk.level, 'medium');
});

test('缺漏值不計總分並列出缺漏項', () => {
  const r = EWS.calculate({ ...normal, rr: null, temp: '' }, 'NEWS2');
  assert.strictEqual(r.total, null);
  assert.strictEqual(r.risk, null);
  assert.deepStrictEqual(r.missing.sort(), ['rr', 'temp']);
});

test('MEWS 計分', () => {
  assert.strictEqual(EWS.calculate(normal, 'MEWS').total, 1); // RR 16 → 1
  const r = EWS.calculate({ sbp: 75, hr: 135, rr: 31, temp: 38.6, consciousness: 'P' }, 'MEWS');
  assert.strictEqual(r.total, 2 + 3 + 3 + 2 + 2);
  assert.strictEqual(r.risk.level, 'high');
  assert.ok(!('spo2' in r.scores));
});

test('輸入值解析', () => {
  assert.strictEqual(EWS.toNumber('120/80'), 120);
  assert.strictEqual(EWS.toNumber('36.5°C'), 36.5);
  assert.strictEqual(EWS.parseOxygen('2 L/min'), true);
  assert.strictEqual(EWS.parseOxygen(0), false);
  assert.strictEqual(EWS.parseOxygen('Room air'), false);
  assert.strictEqual(EWS.parseConsciousness('清醒'), 'A');
  assert.strictEqual(EWS.parseConsciousness('Voice'), 'V');
  assert.strictEqual(EWS.parseConsciousness(15), 'A');
  assert.notStrictEqual(EWS.parseConsciousness(12), 'A');
});

test('欄位自動對應', () => {
  const h = ['病歷號', '姓名', '測量時間', '體溫', '心跳', '呼吸', '收縮壓', '舒張壓', 'SpO2', '氧氣', '意識'];
  assert.deepStrictEqual(EWS.autoMap(h), { temp: 3, hr: 4, rr: 5, sbp: 6, spo2: 8, onO2: 9, consciousness: 10 });
  const e = ['Patient ID', 'Temp (°C)', 'HR', 'RR', 'SBP', 'DBP', 'SpO2 (%)', 'O2 therapy', 'AVPU'];
  assert.deepStrictEqual(EWS.autoMap(e), { temp: 1, hr: 2, rr: 3, sbp: 4, spo2: 6, onO2: 7, consciousness: 8 });
});
