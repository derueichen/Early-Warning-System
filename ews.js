/*
 * 臨床早期預警分數計算核心（NEWS2 / MEWS）
 * 純函式，不依賴瀏覽器，可在 Node.js 中測試。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EWS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 輸入值解析 ----------

  function toNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // 血壓可能寫成 "120/80"，取收縮壓（第一個數字）
  const parseSBP = toNumber;

  // 意識狀態 → 'A' | 'C' | 'V' | 'P' | 'U' | null
  function parseConsciousness(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    const table = [
      ['A', ['a', 'alert', '清醒', '清楚', '意識清楚', '意識清醒']],
      ['C', ['c', 'confusion', 'confused', 'new confusion', '混亂', '意識混亂', '新發混亂', '譫妄']],
      ['V', ['v', 'voice', 'verbal', '對聲音有反應', '聲音', '對聲音']],
      ['P', ['p', 'pain', '對疼痛有反應', '疼痛', '對痛', '對痛有反應']],
      ['U', ['u', 'unresponsive', '無反應', '昏迷', '無意識']],
    ];
    for (const [code, words] of table) if (words.includes(s)) return code;
    // GCS 數值：15 視為清醒
    const n = toNumber(s);
    if (n !== null && /^\d+$/.test(s) && n >= 3 && n <= 15) return n === 15 ? 'A' : 'GCS<15';
    return null;
  }

  // 是否使用氧氣 → true | false | null
  function parseOxygen(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    const yes = ['y', 'yes', 'true', 'o2', 'oxygen', '是', '有', '使用', '給氧', '氧氣', 'nc', 'mask', 'nrm', 'hfnc'];
    const no = ['n', 'no', 'false', 'air', 'ra', 'room air', '否', '無', '沒有', '未使用', '室內空氣', '空氣'];
    if (yes.includes(s)) return true;
    if (no.includes(s)) return false;
    const n = toNumber(s); // 氧氣流量（L/min）或 FiO2
    if (n !== null) {
      if (n === 0 || n === 21) return false;
      return n > 0;
    }
    if (/l\/?min|鼻導管|面罩/.test(s)) return true;
    return null;
  }

  function parseBool(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return ['y', 'yes', 'true', '1', '是', '有', 'scale 2', 'scale2', '2', 'copd'].includes(s);
  }

  // ---------- NEWS2（英國皇家內科醫學會 2017） ----------

  const news2 = {
    rr: (x) => (x <= 8 ? 3 : x <= 11 ? 1 : x <= 20 ? 0 : x <= 24 ? 2 : 3),
    spo2Scale1: (x) => (x <= 91 ? 3 : x <= 93 ? 2 : x <= 95 ? 1 : 0),
    spo2Scale2: (x, onO2) => {
      if (x <= 83) return 3;
      if (x <= 85) return 2;
      if (x <= 87) return 1;
      if (x <= 92 || !onO2) return 0;
      return x <= 94 ? 1 : x <= 96 ? 2 : 3;
    },
    oxygen: (onO2) => (onO2 ? 2 : 0),
    sbp: (x) => (x <= 90 ? 3 : x <= 100 ? 2 : x <= 110 ? 1 : x <= 219 ? 0 : 3),
    hr: (x) => (x <= 40 ? 3 : x <= 50 ? 1 : x <= 90 ? 0 : x <= 110 ? 1 : x <= 130 ? 2 : 3),
    consciousness: (c) => (c === 'A' ? 0 : 3),
    temp: (x) => (x <= 35 ? 3 : x <= 36 ? 1 : x <= 38 ? 0 : x <= 39 ? 1 : 2),
  };

  function news2Risk(total, anyThree) {
    if (total >= 7) return { level: 'high', label: '高風險', action: '緊急/急救團隊評估，考慮轉加護病房' };
    if (total >= 5) return { level: 'medium', label: '中風險', action: '緊急通知醫師評估，至少每小時監測' };
    if (anyThree) return { level: 'low-medium', label: '低-中風險（單項 3 分）', action: '通知醫師評估，至少每小時監測' };
    if (total >= 1) return { level: 'low', label: '低風險', action: '護理評估，至少每 4–6 小時監測' };
    return { level: 'none', label: '低風險（0 分）', action: '常規監測，至少每 12 小時' };
  }

  // ---------- MEWS（Subbe et al. 2001） ----------

  const mews = {
    sbp: (x) => (x <= 70 ? 3 : x <= 80 ? 2 : x <= 100 ? 1 : x <= 199 ? 0 : 2),
    hr: (x) => (x < 40 ? 2 : x <= 50 ? 1 : x <= 100 ? 0 : x <= 110 ? 1 : x <= 129 ? 2 : 3),
    rr: (x) => (x < 9 ? 2 : x <= 14 ? 0 : x <= 20 ? 1 : x <= 29 ? 2 : 3),
    temp: (x) => (x < 35 ? 2 : x < 38.5 ? 0 : 2),
    // MEWS 原版 AVPU：A=0, V=1, P=2, U=3；新發混亂（C）比照 V
    consciousness: (c) => ({ A: 0, C: 1, V: 1, P: 2, U: 3 }[c] ?? 1),
  };

  function mewsRisk(total) {
    if (total >= 5) return { level: 'high', label: '高風險', action: '立即通知醫師/快速反應小組' };
    if (total >= 3) return { level: 'medium', label: '中風險', action: '通知醫師評估，增加監測頻率' };
    return { level: 'low', label: '低風險', action: '常規監測' };
  }

  // ---------- 計算 ----------

  /**
   * @param {object} v 原始輸入：{ rr, spo2, onO2, sbp, hr, consciousness, temp, scale2 }
   * @param {'NEWS2'|'MEWS'} system
   * @returns {{scores: object, total: number|null, partialTotal: number, missing: string[], risk: object|null}}
   */
  function calculate(v, system) {
    const n = {
      rr: toNumber(v.rr),
      spo2: toNumber(v.spo2),
      onO2: parseOxygen(v.onO2),
      sbp: parseSBP(v.sbp),
      hr: toNumber(v.hr),
      consciousness: parseConsciousness(v.consciousness),
      temp: toNumber(v.temp),
      scale2: parseBool(v.scale2),
    };

    const scores = {};
    const missing = [];
    const add = (key, value, fn) => {
      if (value === null) { scores[key] = null; missing.push(key); }
      else scores[key] = fn(value);
    };

    if (system === 'MEWS') {
      add('rr', n.rr, mews.rr);
      add('sbp', n.sbp, mews.sbp);
      add('hr', n.hr, mews.hr);
      add('consciousness', n.consciousness, mews.consciousness);
      add('temp', n.temp, mews.temp);
    } else {
      add('rr', n.rr, news2.rr);
      if (n.scale2) add('spo2', n.spo2, (x) => news2.spo2Scale2(x, n.onO2 === true));
      else add('spo2', n.spo2, news2.spo2Scale1);
      add('onO2', n.onO2, news2.oxygen);
      add('sbp', n.sbp, news2.sbp);
      add('hr', n.hr, news2.hr);
      add('consciousness', n.consciousness, news2.consciousness);
      add('temp', n.temp, news2.temp);
    }

    const vals = Object.values(scores).filter((s) => s !== null);
    const partialTotal = vals.reduce((a, b) => a + b, 0);
    const complete = missing.length === 0;
    const total = complete ? partialTotal : null;
    let risk = null;
    if (complete) risk = system === 'MEWS' ? mewsRisk(total) : news2Risk(total, vals.includes(3));
    return { scores, total, partialTotal, missing, risk, parsed: n };
  }

  // ---------- 欄位自動對應 ----------

  const FIELDS = {
    rr: { label: '呼吸次數 (RR)', aliases: ['rr', 'resp', 'respiration', 'respiratory rate', 'respiratory', 'breath', '呼吸', '呼吸次數', '呼吸速率', '呼吸頻率', 'r'] },
    spo2: { label: '血氧 SpO₂ (%)', aliases: ['spo2', 'sp02', 'sao2', 'o2 sat', 'oxygen saturation', 'saturation', 'sat', '血氧', '血氧飽和度', '血氧濃度', '氧飽和度'] },
    onO2: { label: '是否使用氧氣', aliases: ['o2', 'oxygen', 'on o2', 'supplemental oxygen', 'o2 therapy', 'fio2', 'o2 flow', '氧氣', '給氧', '氧氣治療', '使用氧氣', '是否給氧', '氧氣流量', '供氧'] },
    sbp: { label: '收縮壓 SBP (mmHg)', aliases: ['sbp', 'systolic', 'systolic bp', 'sys', 'bp', 'blood pressure', '收縮壓', '血壓', '血壓收縮壓'] },
    hr: { label: '心跳 HR (次/分)', aliases: ['hr', 'pulse', 'heart rate', 'pr', 'p', '心跳', '脈搏', '心率', '心跳次數'] },
    consciousness: { label: '意識 (AVPU)', aliases: ['avpu', 'acvpu', 'consciousness', 'loc', 'level of consciousness', 'mental status', 'gcs', '意識', '意識狀態', '意識程度', '神智'] },
    temp: { label: '體溫 (°C)', aliases: ['temp', 'temperature', 'bt', 't', 'body temperature', '體溫', '溫度'] },
    scale2: { label: 'SpO₂ Scale 2（高碳酸血症）', aliases: ['scale2', 'scale 2', 'spo2 scale 2', 'hypercapnic', 'copd', '高碳酸', '高碳酸血症', '慢性阻塞性肺病'] },
  };

  function normalizeHeader(h) {
    return String(h ?? '').toLowerCase().replace(/[（(].*?[)）]/g, '').replace(/[\s_\-:：%°℃]/g, '').trim();
  }

  function autoMap(headers) {
    const map = {};
    const used = new Set();
    // 先精確比對，再做包含比對
    for (const pass of ['exact', 'contains']) {
      for (const [key, def] of Object.entries(FIELDS)) {
        if (map[key] !== undefined) continue;
        const aliases = def.aliases.map(normalizeHeader);
        const idx = headers.findIndex((h, i) => {
          if (used.has(i)) return false;
          const nh = normalizeHeader(h);
          if (!nh) return false;
          if (pass === 'exact') return aliases.includes(nh);
          return aliases.some((a) => a.length >= 2 && nh.includes(a));
        });
        if (idx >= 0) { map[key] = idx; used.add(idx); }
      }
    }
    return map;
  }

  return { calculate, autoMap, FIELDS, parseConsciousness, parseOxygen, toNumber, news2, mews };
});
