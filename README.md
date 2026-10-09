# 臨床早期預警分數（EWS）計算器

上傳病人生命徵象 Excel，自動計算 **NEWS2** 或 **MEWS** 分數，並下載含分數與統計的新 Excel。

- 純前端網頁，**資料不會離開您的電腦**（不需伺服器、可離線使用）
- 支援 `.xlsx` / `.xls` / `.csv`，可選擇工作表
- 自動辨識中英文欄位名稱（體溫、心跳、呼吸、收縮壓、SpO2、氧氣、意識…），也可手動調整
- 資料缺漏的列會標示「資料不完整」並列出缺漏項目，不會誤算成低分

## 使用方式（不需任何帳號）

**方法一：網址（GitHub Pages）**
開啟 https://derueichen.github.io/Early-Warning-System/ 即可使用。
（首次需由 repo 擁有者到 Settings → Pages → Source 選「Deploy from a branch」，
分支選 `claude/clinical-ews-calculator-jkcb8b`、資料夾 `/ (root)`，按 Save，約 1 分鐘後生效。）

**方法二：單一離線檔**
把 [`dist/ews-calculator-offline.html`](dist/ews-calculator-offline.html) 下載後傳給別人（LINE、Email、隨身碟皆可），
對方雙擊即可用瀏覽器開啟，完全不需網路，適合醫院內網。

**操作步驟**
1. 選擇評分系統（NEWS2 或 MEWS）。
2. 上傳 Excel（或先按「下載範例檔」看格式）。網頁一開始會顯示範例資料。
3. 確認欄位對應 → 查看結果 → 按「下載結果 Excel」。

所有計算都在使用者自己的瀏覽器中進行，病人資料不會上傳到任何伺服器。

## Excel 輸入格式

第一列為標題，每一列為一次測量。欄位順序不限，例如：

| 病歷號 | 測量時間 | 體溫 | 心跳 | 呼吸 | 收縮壓 | SpO2 | 氧氣 | 意識 |
|---|---|---|---|---|---|---|---|---|
| A001 | 2026-10-01 08:00 | 36.8 | 78 | 16 | 125 | 98 | 否 | A |

可接受的寫法：

- **血壓**：`125` 或 `125/78`（取收縮壓）
- **氧氣**：是/否、Y/N、O2/Air、或流量如 `2 L/min`（0 = 未給氧）
- **意識**：A/C/V/P/U、Alert、清醒、混亂、對聲音、對疼痛、無反應
- **GCS**：可放在意識欄、獨立的 GCS 欄（GCS、昏迷指數），或分成 E/V/M 三欄；格式可為 `13`、`E3V4M6`、`3/4/6`、`E2VTM5`
  - 意識欄有 AVPU 時優先使用；空白或無法判讀時改用 GCS
  - 換算 AVPU：15 = A、13–14 = V、9–12 = P、3–8 = U（換算範圍定義於 `ews.js` 的 `GCS_AVPU`）
  - NEWS2：GCS < 15 一律為非清醒（3 分）
  - V 為 T（插管）或 A（失語）時無法得出總分：NEWS2 以非清醒計 3 分；MEWS 標示「需人工判定」
  - 結果表的「意識判定」欄會寫出換算依據，例如 `GCS 13 → V`
- **SpO₂ Scale 2**（NEWS2 選填）：可用一欄標示個別病人（是/否），或勾選「所有病人皆使用 Scale 2」

## 輸出 Excel 內容

| 工作表 | 內容 |
|---|---|
| `NEWS2結果` / `MEWS結果` | 原始資料 + 各參數分數 + 總分 + 風險等級（顏色標示）+ 建議處置 + 缺漏項目 |
| `統計摘要` | 總筆數、平均/最高總分、各風險等級人次與百分比、總分分布、各參數異常筆數 |
| `病人統計` | 有對應病歷號時產生：每位病人的紀錄數、最高/平均/最後總分、最高風險等級、高風險次數 |
| `評分標準` | 本次使用的評分表 |

## 評分標準

**NEWS2**（Royal College of Physicians, 2017）：呼吸、SpO₂（Scale 1/2）、空氣或氧氣、收縮壓、心跳、意識（ACVPU）、體溫。
風險分級：0 分；1–4 低風險；任一單項 3 分為低-中風險；5–6 中風險；≥7 高風險。

**MEWS**（Subbe et al., QJM 2001）：收縮壓、心跳、呼吸、體溫、意識（AVPU；新發混亂 C 比照 V）。
風險分級：0–2 低風險；3–4 中風險；≥5 高風險。
各醫院 MEWS 版本與閾值不盡相同，如需調整請修改 `ews.js` 中的 `mews` 與 `mewsRisk`。

## 檔案結構

```
index.html              網頁介面
app.js                  檔案讀寫、欄位對應、表格與 Excel 匯出
ews.js                  NEWS2 / MEWS 計分邏輯（純函式）
style.css               樣式
vendor/xlsx.bundle.js   xlsx-js-style 1.2.0（Apache-2.0），讀寫含格式的 Excel
tests/ews.test.js       計分單元測試
scripts/build-artifact.js  產生 dist/ 下的單檔版本
dist/ews-calculator-offline.html  完整離線單一檔（含 Excel 程式庫）
dist/ews-calculator.html          claude.ai Artifact 版（程式庫由 CDN 載入）
```

修改程式後執行 `node scripts/build-artifact.js` 重新產生 `dist/` 檔案。

執行測試：`node --test tests/*.test.js`

> 本工具僅供臨床輔助參考，不能取代專業醫療判斷。
