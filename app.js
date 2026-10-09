/* global XLSX, EWS */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SCORE_COLUMNS = {
    NEWS2: [
      ['rr', '呼吸分數'], ['spo2', '血氧分數'], ['onO2', '氧氣分數'], ['sbp', '收縮壓分數'],
      ['hr', '心跳分數'], ['consciousness', '意識分數'], ['temp', '體溫分數'],
    ],
    MEWS: [
      ['sbp', '收縮壓分數'], ['hr', '心跳分數'], ['rr', '呼吸分數'], ['temp', '體溫分數'], ['consciousness', '意識分數'],
    ],
  };
  const REQUIRED = {
    NEWS2: ['rr', 'spo2', 'onO2', 'sbp', 'hr', 'consciousness', 'temp'],
    MEWS: ['sbp', 'hr', 'rr', 'temp', 'consciousness'],
  };
  const LEVELS = {
    NEWS2: [
      ['high', '高風險（≥7）'], ['medium', '中風險（5–6）'], ['low-medium', '低-中（單項 3 分）'],
      ['low', '低風險（1–4）'], ['none', '0 分'], ['na', '資料不完整'],
    ],
    MEWS: [['high', '高風險（≥5）'], ['medium', '中風險（3–4）'], ['low', '低風險（0–2）'], ['na', '資料不完整']],
  };
  const FILL = {
    high: 'FDE2E2', medium: 'FFEDD5', 'low-medium': 'FEF9C3', low: 'DCFCE7', none: 'DCFCE7', na: 'E5E7EB',
  };
  const ID_ALIASES = ['病歷號', '病歷號碼', '病歷', 'mrn', 'chartno', 'patientid', 'id', '病人編號', '床號', '姓名', 'name'];

  const state = { wb: null, fileName: '', headers: [], rows: [], map: {}, idCol: undefined, results: [] };

  // ---------- 檔案讀取 ----------

  function loadFile(file) {
    showMessage('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        state.wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      } catch (err) {
        showMessage('無法讀取這個檔案，請確認是 .xlsx、.xls 或 .csv 格式。（' + err.message + '）');
        return;
      }
      useWorkbook(file.name.replace(/\.[^.]+$/, ''), '已載入：' + file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  function useWorkbook(name, note) {
    state.fileName = name;
    $('fileName').textContent = note;
    const sel = $('sheet');
    sel.innerHTML = state.wb.SheetNames.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    sel.disabled = state.wb.SheetNames.length < 2;
    loadSheet(0);
  }

  function loadSheet(index) {
    const ws = state.wb.Sheets[state.wb.SheetNames[index]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
    const headerIdx = aoa.findIndex((r) => r.some((c) => c !== null && String(c).trim() !== ''));
    if (headerIdx < 0) { showMessage('這個工作表是空的，請選擇有資料的工作表。'); return; }
    const width = Math.max(...aoa.map((r) => r.length));
    state.headers = Array.from({ length: width }, (_, i) => {
      const h = aoa[headerIdx][i];
      return h === null || h === undefined || String(h).trim() === '' ? `欄位${i + 1}` : String(h).trim();
    });
    state.rows = aoa.slice(headerIdx + 1).filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
    state.map = EWS.autoMap(state.headers);
    const used = new Set(Object.values(state.map));
    const norm = (s) => s.toLowerCase().replace(/[\s_\-]/g, '');
    let idCol;
    for (const a of ID_ALIASES) {
      idCol = state.headers.findIndex((h, i) => !used.has(i) && norm(h).includes(a));
      if (idCol >= 0) break;
    }
    state.idCol = idCol >= 0 ? idCol : undefined;
    renderMapping();
    compute();
  }

  // ---------- 欄位對應 ----------

  function renderMapping() {
    const system = $('system').value;
    const opts = (selected) =>
      '<option value="">（無）</option>' +
      state.headers.map((h, i) => `<option value="${i}"${selected === i ? ' selected' : ''}>${esc(h)}</option>`).join('');
    const fields = Object.entries(EWS.FIELDS).filter(([k]) => system === 'NEWS2' || REQUIRED.MEWS.includes(k));
    let html = `<label><span>病人識別（病歷號／姓名，選填）</span><select data-key="__id">${opts(state.idCol)}</select></label>`;
    for (const [key, def] of fields) {
      const req = REQUIRED[system].includes(key) ? ' <span class="req">*</span>' : '（選填）';
      html += `<label><span>${def.label}${req}</span><select data-key="${key}">${opts(state.map[key])}</select></label>`;
    }
    $('mapping').innerHTML = html;
    $('globalScale2').parentElement.hidden = system !== 'NEWS2';
    $('mapSection').hidden = false;
  }

  $('mapping').addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    const val = e.target.value === '' ? undefined : Number(e.target.value);
    if (key === '__id') state.idCol = val;
    else state.map[key] = val;
    compute();
  });

  // ---------- 計算 ----------

  function compute() {
    const system = $('system').value;
    const global2 = $('globalScale2').checked;
    const get = (row, key) => (state.map[key] === undefined ? null : row[state.map[key]]);
    state.results = state.rows.map((row) => {
      const input = {};
      for (const key of Object.keys(EWS.FIELDS)) input[key] = get(row, key);
      if (global2) input.scale2 = true;
      return EWS.calculate(input, system);
    });
    renderResults();
  }

  function levelOf(r) { return r.risk ? r.risk.level : 'na'; }

  function stats() {
    const system = $('system').value;
    const counts = Object.fromEntries(LEVELS[system].map(([k]) => [k, 0]));
    const totals = [];
    for (const r of state.results) {
      counts[levelOf(r)]++;
      if (r.total !== null) totals.push(r.total);
    }
    const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    return { counts, n: state.results.length, complete: totals.length, mean, max: totals.length ? Math.max(...totals) : null };
  }

  const MISSING_LABEL = { rr: '呼吸', spo2: '血氧', onO2: '氧氣', sbp: '收縮壓', hr: '心跳', consciousness: '意識', temp: '體溫' };

  function outputRow(row, r, system) {
    const scores = SCORE_COLUMNS[system].map(([k]) => r.scores[k]);
    return [
      ...state.headers.map((_, i) => (row[i] === undefined ? null : row[i])),
      ...scores,
      r.total !== null ? r.total : null,
      r.risk ? r.risk.label : '資料不完整',
      r.risk ? r.risk.action : `已知部分總分 ${r.partialTotal}，請補齊資料`,
      r.missing.map((k) => MISSING_LABEL[k]).join('、'),
    ];
  }

  function outputHeaders(system) {
    return [...state.headers, ...SCORE_COLUMNS[system].map(([, l]) => l), `${system} 總分`, '風險等級', '建議處置', '缺漏項目'];
  }

  function renderResults() {
    const system = $('system').value;
    const s = stats();
    $('summary').innerHTML =
      `<div class="stat"><b>${s.n}</b>總筆數</div>` +
      `<div class="stat"><b>${s.mean === null ? '–' : s.mean.toFixed(2)}</b>平均總分</div>` +
      LEVELS[system].map(([k, label]) =>
        `<div class="stat lvl-${k}"><b>${s.counts[k]}</b>${label}${s.n ? `（${((s.counts[k] / s.n) * 100).toFixed(1)}%）` : ''}</div>`
      ).join('');

    const filter = $('filter').value;
    const headers = outputHeaders(system);
    const nOrig = state.headers.length;
    const nScore = SCORE_COLUMNS[system].length;
    let html = '<thead><tr>' + headers.map((h, i) => `<th class="${i >= nOrig && i < nOrig + nScore + 1 ? 'score' : ''}">${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    let shown = 0;
    state.rows.forEach((row, idx) => {
      const r = state.results[idx];
      const lvl = levelOf(r);
      if (filter === 'high' && lvl !== 'high') return;
      if (filter === 'medium' && lvl !== 'high' && lvl !== 'medium') return;
      if (filter === 'incomplete' && lvl !== 'na') return;
      if (++shown > 2000) return;
      const out = outputRow(row, r, system);
      html += '<tr>' + out.map((v, i) => {
        if (i < nOrig) return `<td>${esc(fmt(v))}</td>`;
        if (i < nOrig + nScore) return `<td class="score${v === 3 ? ' s3' : v === 2 ? ' s2' : ''}">${v === null ? '–' : v}</td>`;
        if (i === nOrig + nScore) return `<td class="score lvl-${lvl}"><b>${v === null ? '–' : v}</b></td>`;
        if (i === nOrig + nScore + 1) return `<td class="lvl-${lvl}">${esc(v)}</td>`;
        return `<td>${esc(v)}</td>`;
      }).join('') + '</tr>';
    });
    html += '</tbody>';
    if (shown > 2000) html += `<caption class="muted">畫面僅顯示前 2000 筆，下載的 Excel 包含全部 ${shown} 筆。</caption>`;
    $('table').innerHTML = html;
    $('resultSection').hidden = false;
  }

  // ---------- 匯出 ----------

  const border = { style: 'thin', color: { rgb: 'D9E2EC' } };
  const cellBorder = { top: border, bottom: border, left: border, right: border };
  const headStyle = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: cellBorder };

  function styleSheet(ws, widths) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = headStyle;
    }
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  }

  function download() {
    const system = $('system').value;
    const headers = outputHeaders(system);
    const nOrig = state.headers.length;
    const nScore = SCORE_COLUMNS[system].length;
    const data = [headers, ...state.rows.map((row, i) => outputRow(row, state.results[i], system))];
    const ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true });

    state.results.forEach((r, i) => {
      const lvl = levelOf(r);
      for (let c = 0; c < headers.length; c++) {
        const ref = XLSX.utils.encode_cell({ r: i + 1, c });
        if (!ws[ref]) ws[ref] = { t: 'z' };
        const cell = ws[ref];
        if (cell.t === 'd') cell.z = 'yyyy-mm-dd hh:mm';
        const s = { border: cellBorder };
        if (c >= nOrig && c < nOrig + nScore) {
          s.alignment = { horizontal: 'center' };
          if (cell.v === 3) s.font = { bold: true, color: { rgb: '9B1C1C' } };
          else if (cell.v === 2) s.font = { color: { rgb: '9A3412' } };
        } else if (c === nOrig + nScore || c === nOrig + nScore + 1) {
          s.fill = { fgColor: { rgb: FILL[lvl] } };
          s.font = { bold: true };
          if (c === nOrig + nScore) s.alignment = { horizontal: 'center' };
        }
        cell.s = s;
      }
    });
    styleSheet(ws, headers.map((h, c) => (c >= nOrig + nScore + 2 ? 30 : c >= nOrig ? 11 : Math.max(10, String(h).length * 2 + 2))));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${system}結果`);
    XLSX.utils.book_append_sheet(wb, summarySheet(system), '統計摘要');
    if (state.idCol !== undefined) XLSX.utils.book_append_sheet(wb, patientSheet(system), '病人統計');
    XLSX.utils.book_append_sheet(wb, criteriaSheet(system), '評分標準');
    const stamp = new Date().toISOString().slice(0, 10);
    saveWorkbook(wb, `${state.fileName || 'EWS'}_${system}_${stamp}.xlsx`);
  }

  function summarySheet(system) {
    const s = stats();
    const aoa = [['項目', '數值', '百分比']];
    aoa.push(['評分系統', system, null]);
    aoa.push(['總筆數', s.n, null]);
    aoa.push(['資料完整筆數', s.complete, s.n ? s.complete / s.n : null]);
    aoa.push(['平均總分', s.mean === null ? null : Math.round(s.mean * 100) / 100, null]);
    aoa.push(['最高總分', s.max, null]);
    aoa.push([null, null, null]);
    aoa.push(['風險等級', '筆數', '百分比']);
    const levelRowStart = aoa.length;
    for (const [k, label] of LEVELS[system]) aoa.push([label, s.counts[k], s.n ? s.counts[k] / s.n : null]);
    aoa.push([null, null, null]);
    aoa.push(['總分分布', '筆數', '百分比']);
    const dist = {};
    for (const r of state.results) if (r.total !== null) dist[r.total] = (dist[r.total] || 0) + 1;
    for (const k of Object.keys(dist).map(Number).sort((a, b) => a - b)) aoa.push([`${k} 分`, dist[k], s.n ? dist[k] / s.n : null]);
    aoa.push([null, null, null]);
    aoa.push(['各參數得分 ≥ 1 的筆數', '筆數', '百分比']);
    for (const [k, l] of SCORE_COLUMNS[system]) {
      const c = state.results.filter((r) => r.scores[k] > 0).length;
      aoa.push([l.replace('分數', ''), c, s.n ? c / s.n : null]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleSheet(ws, [28, 12, 12]);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = 1; r <= range.e.r; r++) {
      const pct = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      if (pct && pct.t === 'n') pct.z = '0.0%';
      const a = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (a && ['風險等級', '總分分布', '各參數得分 ≥ 1 的筆數'].includes(a.v)) {
        for (let c = 0; c < 3; c++) ws[XLSX.utils.encode_cell({ r, c })].s = headStyle;
      }
    }
    LEVELS[system].forEach(([k], i) => {
      ws[XLSX.utils.encode_cell({ r: levelRowStart + i, c: 0 })].s = { fill: { fgColor: { rgb: FILL[k] } }, font: { bold: true } };
    });
    return ws;
  }

  function patientSheet(system) {
    const groups = new Map();
    state.rows.forEach((row, i) => {
      const id = fmt(row[state.idCol]) || '（未填）';
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(state.results[i]);
    });
    const order = LEVELS[system].map(([k]) => k);
    const aoa = [[state.headers[state.idCol], '紀錄筆數', '最高總分', '平均總分', '最後一筆總分', '最高風險等級', '高風險次數']];
    for (const [id, rs] of groups) {
      const totals = rs.map((r) => r.total).filter((t) => t !== null);
      const worst = rs.reduce((w, r) => (order.indexOf(levelOf(r)) < order.indexOf(levelOf(w)) ? r : w), rs[0]);
      const last = rs[rs.length - 1];
      aoa.push([
        id, rs.length,
        totals.length ? Math.max(...totals) : null,
        totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100 : null,
        last.total,
        worst.risk ? worst.risk.label : '資料不完整',
        rs.filter((r) => levelOf(r) === 'high').length,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleSheet(ws, [18, 10, 10, 10, 12, 22, 10]);
    let r = 1;
    for (const rs of groups.values()) {
      const worst = rs.reduce((w, x) => (order.indexOf(levelOf(x)) < order.indexOf(levelOf(w)) ? x : w), rs[0]);
      ws[XLSX.utils.encode_cell({ r, c: 5 })].s = { fill: { fgColor: { rgb: FILL[levelOf(worst)] } }, font: { bold: true } };
      r++;
    }
    return ws;
  }

  // ---------- 評分標準 ----------

  const CRITERIA = {
    NEWS2: {
      head: ['參數', '3', '2', '1', '0', '1', '2', '3'],
      rows: [
        ['呼吸 (次/分)', '≤8', '', '9–11', '12–20', '', '21–24', '≥25'],
        ['SpO₂ Scale 1 (%)', '≤91', '92–93', '94–95', '≥96', '', '', ''],
        ['SpO₂ Scale 2 (%)', '≤83', '84–85', '86–87', '88–92 或 ≥93（空氣）', '93–94（給氧）', '95–96（給氧）', '≥97（給氧）'],
        ['空氣或氧氣', '', '氧氣', '', '空氣', '', '', ''],
        ['收縮壓 (mmHg)', '≤90', '91–100', '101–110', '111–219', '', '', '≥220'],
        ['心跳 (次/分)', '≤40', '', '41–50', '51–90', '91–110', '111–130', '≥131'],
        ['意識', '', '', '', 'A（清醒）', '', '', 'C/V/P/U'],
        ['體溫 (°C)', '≤35.0', '', '35.1–36.0', '36.1–38.0', '38.1–39.0', '≥39.1', ''],
      ],
      notes: ['總分 0：低風險；1–4：低風險；任一單項 3 分：低-中風險；5–6：中風險；≥7：高風險', '資料來源：Royal College of Physicians, NEWS2 (2017)'],
    },
    MEWS: {
      head: ['參數', '3', '2', '1', '0', '1', '2', '3'],
      rows: [
        ['收縮壓 (mmHg)', '≤70', '71–80', '81–100', '101–199', '', '≥200', ''],
        ['心跳 (次/分)', '', '<40', '41–50', '51–100', '101–110', '111–129', '≥130'],
        ['呼吸 (次/分)', '', '<9', '', '9–14', '15–20', '21–29', '≥30'],
        ['體溫 (°C)', '', '<35', '', '35.0–38.4', '', '≥38.5', ''],
        ['意識 (AVPU)', '', '', '', 'A（清醒）', 'V（對聲音）／C', 'P（對疼痛）', 'U（無反應）'],
      ],
      notes: ['總分 0–2：低風險；3–4：中風險；≥5：高風險（各院閾值可能不同，請依院內規範）', '資料來源：Subbe CP et al. QJM 2001;94:521-6'],
    },
  };

  function criteriaSheet(system) {
    const c = CRITERIA[system];
    const ws = XLSX.utils.aoa_to_sheet([c.head, ...c.rows, [], ...c.notes.map((n) => [n])]);
    styleSheet(ws, [20, 10, 10, 12, 22, 16, 16, 14]);
    return ws;
  }

  function renderCriteria() {
    $('criteria').innerHTML = Object.entries(CRITERIA).map(([name, c]) =>
      `<h3>${name}</h3><div class="tableWrap"><table><thead><tr>${c.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
      c.rows.map((r) => '<tr>' + r.map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') +
      `</tbody></table></div>${c.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join('')}`
    ).join('') +
      '<p class="muted">意識欄可填 A/C/V/P/U、Alert、清醒、混亂、對聲音、對疼痛、無反應，或 GCS 數值（15 視為清醒，&lt;15 視為非清醒）。' +
      '氧氣欄可填 是/否、Y/N、O2/Air、或氧氣流量（L/min，0 視為未給氧）。血壓欄可填「120/80」，會取收縮壓。</p>';
  }

  // ---------- 範例檔 ----------

  function sampleWorkbook() {
    const aoa = [
      ['病歷號', '姓名', '測量時間', '體溫', '心跳', '呼吸', '收縮壓', '舒張壓', 'SpO2', '氧氣', '意識'],
      ['A001', '王小明', '2026-10-01 08:00', 36.8, 78, 16, 125, 78, 98, '否', 'A'],
      ['A001', '王小明', '2026-10-01 14:00', 38.4, 104, 22, 108, 66, 94, '否', 'A'],
      ['A002', '李美華', '2026-10-01 08:00', 39.3, 128, 26, 88, 52, 90, '是', 'C'],
      ['A003', '陳大同', '2026-10-01 08:00', 35.8, 48, 10, 142, 88, 95, '否', 'A'],
      ['A004', '林小芳', '2026-10-01 08:00', 37.2, 92, 18, 132, 80, 97, '2 L/min', 'V'],
      ['A005', '張志強', '2026-10-01 08:00', 36.5, 70, 14, 118, 72, 99, '否', '清醒'],
      ['A006', '黃淑芬', '2026-10-01 08:00', 37.0, 85, null, 120, 76, 96, '否', 'A'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '生命徵象');
    return wb;
  }

  function loadSample() {
    state.wb = sampleWorkbook();
    useWorkbook('EWS_範例', '目前顯示範例資料（7 筆虛構病人）。上傳您的 Excel 即可取代。');
  }

  // 在 claude.ai Artifact 中瀏覽器下載會被封鎖，改用平台的 downloads 功能；一般瀏覽器則直接下載
  const downloadsReady = window.claude && window.claude.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  async function saveWorkbook(wb, filename) {
    showMessage('');
    const downloads = await downloadsReady;
    if (!downloads) { XLSX.writeFile(wb, filename); return; }
    try {
      const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      await downloads.save({ filename, data });
    } catch (err) {
      if (err && err.code === 'declined') return;
      if (err && err.code === 'rate_limited') showMessage('已有一個下載確認視窗開啟中，請先完成它。');
      else showMessage('此環境無法下載檔案，請改用電腦瀏覽器開啟。');
    }
  }

  function showMessage(text) {
    const el = $('message');
    el.textContent = text;
    el.hidden = !text;
  }

  // ---------- 工具 ----------

  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const p = (n) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}` +
        (v.getHours() || v.getMinutes() ? ` ${p(v.getHours())}:${p(v.getMinutes())}` : '');
    }
    return String(v);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 事件 ----------

  $('file').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
  $('sheet').addEventListener('change', (e) => loadSheet(Number(e.target.value)));
  $('system').addEventListener('change', () => { if (state.wb) { renderMapping(); compute(); } });
  $('globalScale2').addEventListener('change', () => state.wb && compute());
  $('filter').addEventListener('change', () => state.wb && renderResults());
  $('download').addEventListener('click', download);
  $('sample').addEventListener('click', () => saveWorkbook(sampleWorkbook(), 'EWS_範例.xlsx'));
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  renderCriteria();
  loadSample();
})();
