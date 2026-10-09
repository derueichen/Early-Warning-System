/*
 * 原始資料整理：找標題列、拆血壓、解析合併的生命徵象欄、去單位、檢查合理範圍。
 * 輸入二維陣列（Excel 每列），輸出標準化欄位的新表格與整理紀錄。純函式，可在 Node.js 測試。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ews.js'));
  else root.Clean = factory(root.EWS);
})(typeof self !== 'undefined' ? self : this, function (EWS) {
  'use strict';

  // 標準化後的生命徵象欄位（欄名可被 EWS.autoMap 直接辨識）
  const STD = [
    ['temp', '體溫(°C)'], ['hr', '心跳'], ['rr', '呼吸'], ['sbp', '收縮壓'], ['dbp', '舒張壓'],
    ['spo2', 'SpO2(%)'], ['onO2', '氧氣'], ['consciousness', '意識'], ['gcs', 'GCS'],
  ];
  const LABEL = Object.fromEntries(STD);

  // 合理範圍；超出者視為缺漏並記錄
  const RANGE = { temp: [25, 45], hr: [20, 250], rr: [3, 80], sbp: [40, 300], dbp: [20, 200], spo2: [50, 100] };

  const EMPTY = new Set(['', '-', '--', '---', '—', '/', '.', 'na', 'n/a', 'nil', 'null', 'none', 'x', '?', '未測', '未量', '未測量', '拒測', '拒絕', '無法測量', '測不到']);
  const DBP_ALIASES = ['dbp', 'diastolic', 'diastolicbp', '舒張壓', '舒張', '血壓舒張壓', '舒張壓mmhg'];
  const COMBINED_ALIASES = ['生命徵象', 'vitalsigns', 'vitalsign', 'vital', 'vs', 'tpr', 'tprbp', '生命跡象'];

  // 全形轉半形、統一符號
  function normText(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v;
    const s = v
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/　/g, ' ')
      .replace(/[／∕]/g, '/')
      .replace(/℃/g, '°C')
      .replace(/℉/g, '°F')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
  }

  function isEmpty(v) {
    if (v === null || v === undefined) return true;
    return typeof v === 'string' && EMPTY.has(v.trim().toLowerCase());
  }

  const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[（(].*?[)）]/g, '').replace(/[\s_\-:：%°℃.]/g, '');

  // ---------- 合併欄位（一格內含多項生命徵象）解析 ----------

  const NB = '(?<![A-Za-z])'; // 前面不能是英文字母，避免 BP 的 P、SpO2 的 O2 被誤認
  const SEP = '\\s*[:：=]?\\s*';
  const PATTERNS = {
    bp: new RegExp(`${NB}(?:NBP|ABP|BP|血壓)${SEP}(\\d{2,3})\\s*/\\s*(\\d{2,3})`, 'i'),
    temp: new RegExp(`${NB}(?:BT|TEMP|T|體溫)${SEP}(\\d{2,3}(?:\\.\\d+)?)\\s*(°?\\s*[CF])?`, 'i'),
    hr: new RegExp(`${NB}(?:HR|PR|P|PULSE|脈搏|心跳|心率)${SEP}(\\d{2,3})`, 'i'),
    rr: new RegExp(`${NB}(?:RR|R|RESP|呼吸)${SEP}(\\d{1,2})`, 'i'),
    spo2: new RegExp(`${NB}(?:SPO2|SAO2|SAT|O2\\s*SAT|血氧)${SEP}(\\d{2,3}(?:\\.\\d+)?)\\s*%?`, 'i'),
    gcs: new RegExp(`${NB}GCS${SEP}(E\\s*\\d\\s*V\\s*[\\dTAED]\\s*M\\s*\\d|\\d{1,2})`, 'i'),
    o2: new RegExp(`${NB}(?:O2|氧氣|FIO2)${SEP}((?:\\d+(?:\\.\\d+)?\\s*(?:L|LPM|%)?(?:/MIN)?)|NC|MASK|NRM|HFNC|RA|ROOM AIR|AIR)`, 'i'),
    loc: new RegExp(`${NB}(?:LOC|AVPU|ACVPU|意識|神智)${SEP}([A-Za-z]+|[\\u4e00-\\u9fff]+)`, 'i'),
  };

  function parseCombined(text) {
    const s = normText(String(text));
    const out = {};
    let m;
    if ((m = s.match(PATTERNS.bp))) { out.sbp = m[1]; out.dbp = m[2]; }
    if ((m = s.match(PATTERNS.temp))) out.temp = m[1] + (m[2] ? m[2].replace(/\s/g, '') : '');
    if ((m = s.match(PATTERNS.hr))) out.hr = m[1];
    if ((m = s.match(PATTERNS.rr))) out.rr = m[1];
    if ((m = s.match(PATTERNS.spo2))) out.spo2 = m[1];
    if ((m = s.match(PATTERNS.gcs))) out.gcs = m[1].replace(/\s/g, '');
    if ((m = s.match(PATTERNS.o2))) out.onO2 = m[1];
    if ((m = s.match(PATTERNS.loc))) out.consciousness = m[1];
    return out;
  }

  // ---------- 標題列偵測 ----------

  function headerScore(row) {
    const headers = row.map((c) => (c === null || c === undefined ? '' : String(normText(c))));
    const nonEmpty = headers.filter((h) => h).length;
    if (!nonEmpty) return 0;
    // 數字比例高的列不是標題
    const numeric = row.filter((c) => typeof c === 'number').length;
    if (numeric > nonEmpty / 2) return 0;
    const mapped = Object.keys(EWS.autoMap(headers)).length;
    const extra = headers.some((h) => DBP_ALIASES.some((a) => normHeader(h).includes(a))) ? 1 : 0;
    const combined = headers.some((h) => COMBINED_ALIASES.includes(normHeader(h))) ? 2 : 0;
    return mapped + extra + combined;
  }

  function findHeader(aoa) {
    let best = { idx: 0, score: -1, headers: aoa[0] || [], rowsUsed: 1 };
    const limit = Math.min(aoa.length, 20);
    for (let i = 0; i < limit; i++) {
      const row = aoa[i] || [];
      const single = headerScore(row);
      if (single > best.score) best = { idx: i, score: single, headers: row, rowsUsed: 1 };
      // 兩列標題（例如上列「血壓」、下列「收縮／舒張」）
      const lower = aoa[i + 1] || [];
      const lowerFilled = lower.filter((c) => c !== null && c !== undefined && c !== '');
      if (lowerFilled.length && lower.filter((c) => typeof c === 'number').length <= lowerFilled.length / 2) {
        const width = Math.max(row.length, lower.length);
        const merged = Array.from({ length: width }, (_, c) => {
          const up = row[c] ?? '';
          const lo = lower[c] ?? '';
          return String(up) === String(lo) ? String(up) : `${up}${lo}`;
        });
        const score = headerScore(merged);
        if (score > best.score && score > single && score > headerScore(lower)) {
          best = { idx: i, score, headers: merged, rowsUsed: 2 };
        }
      }
    }
    return best;
  }

  // ---------- 單一數值清理 ----------

  function cleanNumber(field, raw) {
    if (isEmpty(raw)) return { value: null, note: raw === null || raw === undefined || raw === '' ? '' : '空白/未測，視為缺漏' };
    let s = normText(raw);
    if (typeof s === 'number') return rangeCheck(field, s, '');
    const n = EWS.toNumber(s);
    if (n === null) return { value: null, note: '無法判讀，視為缺漏' };
    let value = n;
    let note = String(s) === String(n) || Number(s) === n ? '' : '移除單位/符號';
    if (field === 'temp' && (/°?\s*F\b/i.test(s) || (n >= 86 && n <= 113))) {
      value = Math.round(((n - 32) * 5) / 9 * 10) / 10;
      note = '華氏轉攝氏';
    }
    return rangeCheck(field, value, note);
  }

  function rangeCheck(field, value, note) {
    if (field === 'temp' && value >= 86 && value <= 113 && !note) {
      value = Math.round(((value - 32) * 5) / 9 * 10) / 10;
      note = '華氏轉攝氏';
    }
    if (field === 'spo2' && value > 0 && value <= 1) {
      value = Math.round(value * 1000) / 10;
      note = '小數轉百分比';
    }
    const r = RANGE[field];
    if (r && (value < r[0] || value > r[1])) return { value: null, note: `超出合理範圍（${r[0]}–${r[1]}），視為缺漏`, warn: true };
    return { value, note };
  }

  function cleanOxygen(raw) {
    if (raw === null || raw === undefined || raw === '') return { value: null, note: '' };
    const s = normText(raw);
    const o = EWS.parseOxygen(s);
    if (o === null) return { value: null, note: '無法判讀是否給氧，視為缺漏' };
    const value = o ? '是' : '否';
    return { value, note: String(s) === value ? '' : '統一為 是/否' };
  }

  function cleanConsciousness(raw) {
    if (raw === null || raw === undefined || raw === '') return { value: null, gcs: null, note: '' };
    const s = normText(raw);
    const c = EWS.parseConsciousness(s);
    if (c) return { value: c, gcs: null, note: String(s).toUpperCase() === c ? '' : `統一為 ${c}` };
    const g = EWS.parseGCS(s);
    if (g) return { value: null, gcs: g.total ?? String(s).replace(/\s/g, '').toUpperCase(), note: '意識欄內為 GCS，移至 GCS 欄' };
    return { value: null, gcs: null, note: '無法判讀意識狀態，視為缺漏' };
  }

  function cleanGCS(raw) {
    if (raw === null || raw === undefined || raw === '') return { value: null, note: '' };
    const s = normText(raw);
    const g = EWS.parseGCS(s);
    if (!g) return { value: null, note: '無法判讀 GCS，視為缺漏' };
    if (g.intubated) return { value: String(s).replace(/\s/g, '').toUpperCase(), note: '' };
    return { value: g.total, note: String(s) === String(g.total) ? '' : 'GCS 加總為總分' };
  }

  // ---------- 主流程 ----------

  /**
   * @param {any[][]} aoa 工作表二維陣列（第一層為列）
   * @returns {{headers: string[], rows: any[][], log: object[], info: object}}
   */
  function cleanTable(aoa) {
    aoa = aoa.map((r) => (r || []).map(normText));
    const h = findHeader(aoa);
    const width = Math.max(h.headers.length, ...aoa.map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => {
      const v = h.headers[i];
      return v === null || v === undefined || String(v).trim() === '' ? `欄位${i + 1}` : String(v).trim();
    });
    const log = [];
    const info = { headerRow: h.idx + 1, headerRows: h.rowsUsed, dropped: { empty: 0, header: 0, duplicate: 0 }, fixes: 0, warnings: 0 };

    // 欄位對應：舒張壓先找，避免被「血壓」別名搶走
    const dbpCol = headers.findIndex((x) => DBP_ALIASES.some((a) => normHeader(x) === a || (a.length >= 2 && normHeader(x).includes(a))));
    const forMap = headers.map((x, i) => (i === dbpCol ? '' : x));
    const map = EWS.autoMap(forMap);
    if (dbpCol >= 0) map.dbp = dbpCol;

    // 合併欄：標題像「生命徵象」，或內容常含 2 項以上生命徵象
    const dataRows = aoa.slice(h.idx + h.rowsUsed);
    const used = new Set(Object.values(map));
    let combinedCol = -1;
    let bestHits = 0;
    for (let c = 0; c < width; c++) {
      if (used.has(c) && !COMBINED_ALIASES.includes(normHeader(headers[c]))) continue;
      const cells = dataRows.map((r) => r[c]).filter((v) => typeof v === 'string' && v.length > 4);
      if (!cells.length) continue;
      const hits = cells.filter((v) => Object.keys(parseCombined(v)).length >= 2).length;
      if (hits / cells.length >= 0.3 && hits > bestHits) { bestHits = hits; combinedCol = c; }
    }
    if (combinedCol >= 0) {
      for (const k of Object.keys(map)) if (map[k] === combinedCol) delete map[k];
    }
    info.combinedColumn = combinedCol >= 0 ? headers[combinedCol] : null;
    info.mapped = Object.fromEntries(Object.entries(map).map(([k, i]) => [k, headers[i]]));

    // 要被標準欄位取代的原始欄（scale2 保留原樣）
    const consumed = new Set(Object.entries(map).filter(([k]) => k !== 'scale2').map(([, i]) => i));
    if (combinedCol >= 0) consumed.add(combinedCol);
    const keepCols = headers.map((_, i) => i).filter((i) => !consumed.has(i));

    const outHeaders = [...keepCols.map((i) => headers[i]), ...STD.map(([, l]) => l)];
    if (combinedCol >= 0) outHeaders.push(`原始${headers[combinedCol]}`);

    const headerKeys = new Set(headers.map(normHeader).filter(Boolean));
    const seen = new Set();
    const rows = [];

    dataRows.forEach((row, ri) => {
      const excelRow = h.idx + h.rowsUsed + ri + 1;
      if (!row.some((v) => !isEmpty(v))) { info.dropped.empty++; return; }
      // 中間重複出現的標題列（多頁匯出常見）
      const textCells = row.filter((v) => typeof v === 'string' && v);
      if (textCells.length >= 3 && textCells.filter((v) => headerKeys.has(normHeader(v))).length >= textCells.length * 0.6) {
        info.dropped.header++;
        log.push({ row: excelRow, column: '', original: '', value: '', note: '重複的標題列，已刪除', type: 'drop' });
        return;
      }
      const key = JSON.stringify(row.map((v) => (v instanceof Date ? v.getTime() : v)));
      if (seen.has(key)) {
        info.dropped.duplicate++;
        log.push({ row: excelRow, column: '', original: '', value: '', note: '與前面某列完全相同，已刪除', type: 'drop' });
        return;
      }
      seen.add(key);

      const combined = combinedCol >= 0 && row[combinedCol] ? parseCombined(row[combinedCol]) : {};
      const src = (field) => {
        if (map[field] !== undefined && !isEmpty(row[map[field]])) return { raw: row[map[field]], column: headers[map[field]] };
        if (combined[field] !== undefined) return { raw: combined[field], column: headers[combinedCol], fromCombined: true };
        if (map[field] !== undefined) return { raw: row[map[field]], column: headers[map[field]] };
        return { raw: null, column: '' };
      };
      const rec = {};
      const fromCombined = [];
      const note = (field, s, result) => {
        if (s.fromCombined) fromCombined.push(LABEL[field]);
        if (!result.note) return;
        const warn = result.warn || (result.value === null && !result.gcs);
        log.push({ row: excelRow, column: s.column, original: s.fromCombined ? `${LABEL[field]} ${s.raw}` : s.raw, value: result.value, note: result.note, type: warn ? 'warn' : 'fix' });
        warn ? info.warnings++ : info.fixes++;
      };

      // 血壓：收縮壓欄若為 120/80 則拆開
      const sbpSrc = src('sbp');
      const bpText = sbpSrc.raw !== null && typeof sbpSrc.raw === 'string' ? sbpSrc.raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/) : null;
      if (bpText) {
        const s1 = cleanNumber('sbp', bpText[1]);
        rec.sbp = s1.value;
        log.push({ row: excelRow, column: sbpSrc.column, original: sbpSrc.raw, value: `${s1.value ?? '–'} / ${bpText[2]}`, note: '血壓拆為收縮壓／舒張壓' + (s1.note ? '；收縮壓' + s1.note : ''), type: s1.warn ? 'warn' : 'fix' });
        s1.warn ? info.warnings++ : info.fixes++;
        const dbpSrc = map.dbp !== undefined && !isEmpty(row[map.dbp]) ? { raw: row[map.dbp], column: headers[map.dbp] } : { raw: bpText[2], column: sbpSrc.column };
        const d1 = cleanNumber('dbp', dbpSrc.raw);
        rec.dbp = d1.value;
        if (d1.note && dbpSrc.raw !== bpText[2]) note('dbp', dbpSrc, d1);
      } else {
        const s1 = cleanNumber('sbp', sbpSrc.raw);
        rec.sbp = s1.value;
        note('sbp', sbpSrc, s1);
        const dbpSrc = src('dbp');
        const d1 = cleanNumber('dbp', dbpSrc.raw);
        rec.dbp = d1.value;
        note('dbp', dbpSrc, d1);
      }
      if (rec.sbp !== null && rec.dbp !== null && rec.dbp >= rec.sbp) {
        log.push({ row: excelRow, column: '血壓', original: `${rec.sbp}/${rec.dbp}`, value: `${rec.dbp}/${rec.sbp}`, note: '舒張壓 ≥ 收縮壓，疑似欄位顛倒，已對調', type: 'warn' });
        info.warnings++;
        [rec.sbp, rec.dbp] = [rec.dbp, rec.sbp];
      }

      for (const field of ['temp', 'hr', 'rr', 'spo2']) {
        const s = src(field);
        const r = cleanNumber(field, s.raw);
        rec[field] = r.value;
        note(field, s, r);
      }

      const o = src('onO2');
      const or = cleanOxygen(o.raw);
      rec.onO2 = or.value;
      note('onO2', o, or);

      const c = src('consciousness');
      const cr = cleanConsciousness(c.raw);
      rec.consciousness = cr.value;
      note('consciousness', c, cr);

      // GCS：總分欄 > 合併欄 > 意識欄內的 GCS > E/V/M 分欄
      const g = src('gcs');
      let gr = cleanGCS(g.raw);
      if (gr.value === null && cr.gcs !== null) gr = { value: cr.gcs, note: '' };
      if (gr.value === null && ['gcsE', 'gcsV', 'gcsM'].some((k) => map[k] !== undefined)) {
        const parts = ['gcsE', 'gcsV', 'gcsM'].map((k) => (map[k] === undefined ? '' : String(normText(row[map[k]]) ?? '').trim()));
        if (parts.every((p) => p)) {
          const text = `E${parts[0]}V${parts[1]}M${parts[2]}`;
          const pr = cleanGCS(text);
          gr = { value: pr.value, note: pr.value === null ? pr.note : 'E/V/M 分欄合併為 GCS' };
          note('gcs', { raw: parts.join(' / '), column: 'GCS E/V/M' }, gr);
          gr.note = '';
        }
      }
      rec.gcs = gr.value;
      note('gcs', g, gr);

      if (fromCombined.length) {
        log.push({ row: excelRow, column: headers[combinedCol], original: row[combinedCol], value: '', note: `從合併欄位取出：${fromCombined.join('、')}`, type: 'fix' });
        info.fixes++;
      }

      const out = [...keepCols.map((i) => row[i] ?? null), ...STD.map(([k]) => rec[k] ?? null)];
      if (combinedCol >= 0) out.push(row[combinedCol] ?? null);
      rows.push(out);
    });

    info.rowsIn = dataRows.length;
    info.rowsOut = rows.length;
    return { headers: outHeaders, rows, log, info };
  }

  return { cleanTable, parseCombined, findHeader, normText, STD };
});
