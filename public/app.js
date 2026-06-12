// EconoLens Web — UI コントローラ。
// 価格は /api/prices(サーバーレス)から取得し、計算はブラウザ内(quant.js)。

import { parseHorizon, estimate, simulate, TRADING_DAYS } from "./quant.js";

const els = {
  code: document.getElementById("code"),
  codeHint: document.getElementById("code-hint"),
  horizon: document.getElementById("horizon"),
  paths: document.getElementById("paths"),
  run: document.getElementById("run"),
  datalist: document.getElementById("instrument-list"),
  quickChips: document.getElementById("quick-chips"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  resultTitle: document.getElementById("result-title"),
  resultMeta: document.getElementById("result-meta"),
  qtableBody: document.querySelector("#quantile-table tbody"),
  paramsNote: document.getElementById("params-note"),
  fanchart: document.getElementById("fanchart"),
};

const CCY_SYMBOL = { JPY: "¥", USD: "$", HKD: "HK$", CNY: "¥" };
const HORIZON_LABEL = {
  "1m": "1ヶ月",
  "3m": "3ヶ月",
  "6m": "6ヶ月",
  "1y": "1年",
  "2y": "2年",
  "3y": "3年",
  "5y": "5年",
};
const QUICK = [
  { code: "7203.T", label: "トヨタ" },
  { code: "8035.T", label: "東エレク" },
  { code: "6258.T", label: "平田機工" },
  { code: "AAPL", label: "Apple" },
  { code: "NVDA", label: "NVIDIA" },
  { code: "0700.HK", label: "テンセント" },
  { code: "^GSPC", label: "S&P500" },
  { code: "ACWI", label: "オルカン代替" },
];

let instruments = [];

init();

async function init() {
  // クイック選択チップ。
  for (const q of QUICK) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = q.label;
    b.addEventListener("click", () => {
      els.code.value = q.code;
      updateCodeHint();
      runForecast();
    });
    els.quickChips.appendChild(b);
  }

  els.run.addEventListener("click", runForecast);
  els.code.addEventListener("change", updateCodeHint);
  els.code.addEventListener("input", updateCodeHint);
  els.code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runForecast();
  });

  // 銘柄マスタ(補完候補)。
  try {
    const r = await fetch("./instruments.json");
    instruments = await r.json();
    for (const it of instruments) {
      const opt = document.createElement("option");
      opt.value = it.code;
      opt.label = `${it.name}(${it.market}）`;
      els.datalist.appendChild(opt);
    }
  } catch {
    // 補完は無くても動作する。
  }
}

function findInstrument(code) {
  const c = code.trim().toUpperCase();
  return instruments.find((i) => i.code.toUpperCase() === c) || null;
}

function updateCodeHint() {
  const it = findInstrument(els.code.value);
  els.codeHint.textContent = it
    ? `${it.name} · ${it.sector || it.market}${it.theme?.length ? " · " + it.theme.join("/") : ""}`
    : "";
}

function showStatus(message, kind = "loading") {
  els.status.hidden = false;
  els.status.className = `status ${kind}`;
  els.status.textContent = message;
}
function hideStatus() {
  els.status.hidden = true;
}

function fmtPrice(value, ccy) {
  const sym = CCY_SYMBOL[ccy] || "";
  const digits = ccy === "JPY" || ccy === "CNY" ? 0 : 2;
  return `${sym}${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
function fmtPct(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

async function runForecast() {
  const code = els.code.value.trim();
  if (!code) {
    showStatus("ティッカーを入力してください(例: 7203.T)", "error");
    return;
  }
  const horizon = els.horizon.value;
  const paths = parseInt(els.paths.value, 10);

  els.run.disabled = true;
  els.result.hidden = true;
  showStatus(`${code} の価格を取得中…`, "loading");

  try {
    const res = await fetch(`./api/prices?code=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `取得エラー(HTTP ${res.status}）`);

    const closes = data.prices.map((p) => p.close);
    const spot = data.spot;
    const ccy = data.currency || guessCurrency(code);

    showStatus(`${paths.toLocaleString()} パスでシミュレーション中…`, "loading");
    // UI 更新を挟んでから計算(重い処理の前に描画を反映)。
    await new Promise((r) => setTimeout(r, 20));

    const { mu, sigma, nObs } = estimate(closes);
    const days = parseHorizon(horizon);
    const result = simulate(spot, mu, sigma, days, paths);

    hideStatus();
    renderResult(code, horizon, ccy, result, nObs, data);
  } catch (e) {
    showStatus(String(e.message || e), "error");
  } finally {
    els.run.disabled = false;
  }
}

function guessCurrency(code) {
  const c = code.toUpperCase();
  if (c.endsWith(".T")) return "JPY";
  if (c.endsWith(".HK")) return "HKD";
  if (c.endsWith(".SS") || c.endsWith(".SZ")) return "CNY";
  return "USD";
}

function renderResult(code, horizon, ccy, r, nObs, data) {
  const it = findInstrument(code);
  const name = it ? it.name : code;
  els.result.hidden = false;
  els.resultTitle.textContent = `${name}(${code}) — ${HORIZON_LABEL[horizon] || horizon}後の価格予測`;
  els.resultMeta.textContent =
    `現在値 ${fmtPrice(r.spot, ccy)}` +
    (data.exchange ? ` · ${data.exchange}` : "") +
    ` · 観測 ${nObs.toLocaleString()} 日`;

  const rows = [
    { label: "現在値", price: r.spot, base: true },
    { section: true },
    { label: "P10(悲観)", price: r.p10 },
    { label: "P25", price: r.p25 },
    { label: "P50(中央値)", price: r.p50, highlight: true },
    { label: "P75", price: r.p75 },
    { label: "P90(楽観)", price: r.p90 },
    { section: true },
    { label: "期待値(平均)", price: r.expected },
  ];

  els.qtableBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    // セクション区切りは価格セルを持たない空行として描画。
    if (row.section) {
      tr.className = "section-row";
      tr.innerHTML = `<td colspan="3"></td>`;
      els.qtableBody.appendChild(tr);
      continue;
    }
    if (row.highlight) tr.className = "highlight";
    const ret = row.base ? null : row.price / r.spot - 1;
    const retCell = row.base
      ? "—"
      : `<span class="${ret >= 0 ? "pos" : "neg"}">${fmtPct(ret)}</span>`;
    tr.innerHTML = `
      <td>${row.label}</td>
      <td class="num">${fmtPrice(row.price, ccy)}</td>
      <td class="num">${retCell}</td>`;
    els.qtableBody.appendChild(tr);
  }
  // 元本割れ確率の行。
  const lossTr = document.createElement("tr");
  lossTr.innerHTML = `
    <td>元本割れ確率</td>
    <td class="num">${(r.probLoss * 100).toFixed(1)}%</td>
    <td class="num">—</td>`;
  els.qtableBody.appendChild(lossTr);

  els.paramsNote.textContent =
    `推定: ドリフト μ=${fmtPct(r.mu)}/年, ボラ σ=${(r.sigma * 100).toFixed(1)}%/年, ` +
    `${r.paths.toLocaleString()} パスの GBM モンテカルロ。`;

  drawFanChart(name, code, horizon, ccy, r);
}

function drawFanChart(name, code, horizon, ccy, r) {
  const x = r.band.days;
  const fill = "rgba(79,143,247,0.18)";
  const line = "rgb(79,143,247)";

  const traces = [];

  // サンプルパス(スパゲッティ)を薄く。
  for (let i = 0; i < r.samples.length; i++) {
    traces.push({
      x,
      y: r.samples[i],
      mode: "lines",
      line: { color: "rgba(154,163,176,0.18)", width: 1 },
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  // P90 上限 → P10 まで塗りつぶし。
  traces.push({
    x,
    y: r.band.p90,
    mode: "lines",
    line: { width: 0 },
    name: "P90(楽観)",
    hoverinfo: "skip",
    showlegend: false,
  });
  traces.push({
    x,
    y: r.band.p10,
    mode: "lines",
    line: { width: 0 },
    fill: "tonexty",
    fillcolor: fill,
    name: "P10–P90 レンジ",
  });
  // P50 中央値。
  traces.push({
    x,
    y: r.band.p50,
    mode: "lines",
    line: { color: line, width: 2 },
    name: "P50(中央値)",
  });

  const layout = {
    title: {
      text: `${name}(${code}) — ${HORIZON_LABEL[horizon] || horizon}後までの価格分布`,
      font: { size: 14, color: "#e7e9ee" },
    },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#9aa3b0", size: 12 },
    margin: { l: 56, r: 16, t: 40, b: 40 },
    xaxis: { title: "営業日(今日 = 0)", gridcolor: "#2a2f3a", zeroline: false },
    yaxis: { title: `価格(${ccy}）`, gridcolor: "#2a2f3a", zeroline: false },
    showlegend: true,
    legend: { orientation: "h", y: 1.12, x: 1, xanchor: "right", font: { size: 11 } },
    shapes: [
      {
        type: "line",
        x0: 0,
        x1: r.days,
        y0: r.spot,
        y1: r.spot,
        line: { color: "#9aa3b0", width: 1, dash: "dash" },
      },
    ],
  };

  Plotly.react(els.fanchart, traces, layout, {
    displayModeBar: false,
    responsive: true,
  });
}
