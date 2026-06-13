// 定量ロジック(econolens/quant/stats.py・montecarlo.py の JS 移植)。
// ブラウザ内で完結。外部依存なし。

export const TRADING_DAYS = 252;
const EWMA_LAMBDA = 0.94;

// ホライズン文字列 -> 営業日数。例: 1m, 6m, 1y, 3y, 10d。
const HORIZON_RE = /^\s*(\d+(?:\.\d+)?)\s*([dwmy])\s*$/i;
const UNIT_DAYS = { d: 1, w: 5, m: TRADING_DAYS / 12, y: TRADING_DAYS };

export function parseHorizon(horizon) {
  const m = HORIZON_RE.exec(horizon);
  if (!m) throw new Error(`ホライズン '${horizon}' を解釈できません(例: 1m, 6m, 1y, 3y）`);
  const qty = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  return Math.max(1, Math.round(qty * UNIT_DAYS[unit]));
}

// 終値配列 -> 対数リターン配列(非有限値を除去)。
export function logReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) {
      const x = Math.log(b / a);
      if (Number.isFinite(x)) r.push(x);
    }
  }
  return r;
}

// EWMA 日次ボラを年率化。
export function ewmaVol(returns, lam = EWMA_LAMBDA) {
  const n = returns.length;
  if (n === 0) return 0;
  const w = new Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    // 新しい観測ほど重い(i が大きいほど指数が小さい)。
    const wi = (1 - lam) * Math.pow(lam, n - 1 - i);
    w[i] = wi;
    wsum += wi;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += w[i] * returns[i];
  mean /= wsum;
  let varw = 0;
  for (let i = 0; i < n; i++) {
    const d = returns[i] - mean;
    varw += w[i] * d * d;
  }
  varw /= wsum;
  return Math.sqrt(varw) * Math.sqrt(TRADING_DAYS);
}

// 価格系列からドリフト(年率)とボラ(年率)を推定。
// mu は市場想定リターンへ縮約し、±muCap でクリップ。
export function estimate(closes, { shrinkTo = 0.05, shrinkWeight = 0.3, muCap = 0.4 } = {}) {
  // 直近 3 年に絞る(Python 版の PRICE_LOOKBACK_YEARS=3 に対応)。
  const recent = closes.slice(-Math.min(closes.length, TRADING_DAYS * 3 + 1));
  const r = logReturns(recent);
  if (r.length === 0) return { mu: shrinkTo, sigma: 0, nObs: 0 };
  let mean = 0;
  for (const x of r) mean += x;
  mean /= r.length;
  const rawMu = mean * TRADING_DAYS;
  const shrunk = (1 - shrinkWeight) * rawMu + shrinkWeight * shrinkTo;
  const mu = Math.max(-muCap, Math.min(muCap, shrunk));
  return { mu, sigma: ewmaVol(r), nObs: r.length };
}

function clamp01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// イベントのインパクトスコアを年率アルファ(ドリフト調整)へ変換する。
// PLAN.md §4.4: α = direction × magnitude × confidence × (1 − already_priced_in) × MAX_ALPHA
// MAX_ALPHA は「確度100%・影響度100%・未織り込みの好材料」が年率でどれだけドリフトを
// 押し上げるかの上限(既定 25%/年)。
export function eventAlpha(impact, { maxAlpha = 0.25 } = {}) {
  if (!impact) return 0;
  const sign = impact.direction === "down" ? -1 : 1;
  const mag = clamp01(impact.magnitude);
  const conf = clamp01(impact.confidence);
  const priced = clamp01(impact.already_priced_in);
  return sign * mag * conf * (1 - priced) * maxAlpha;
}

// インパクトを反映した (mu, sigma) を返す。
// ドリフトに α を加算し、不確実性(影響大 × 確信度低)の分だけボラを軽く上乗せする。
export function applyImpact(mu, sigma, impact, opts = {}) {
  const alpha = eventAlpha(impact, opts);
  const volBump = impact
    ? clamp01(impact.magnitude) * (1 - clamp01(impact.confidence)) * 0.5
    : 0;
  return { mu: mu + alpha, sigma: sigma * (1 + volBump), alpha };
}

// Box-Muller 法による標準正規乱数。
function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 破壊的分位点(配列を昇順ソートして線形補間)。
function quantileInPlace(arr, pct) {
  arr.sort();
  const n = arr.length;
  const idx = (pct / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}

// GBM モンテカルロ。S_t = S_0 * exp((mu - sigma^2/2)t + sigma√t Z)。
// 終端分位点・期待値・元本割れ確率と、日次分位点バンド・サンプルパスを返す。
export function simulate(spot, mu, sigma, days, paths, { samplePaths = 15 } = {}) {
  if (spot <= 0) throw new Error("現在値は正である必要があります");
  const dt = 1 / TRADING_DAYS;
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);
  const cols = days + 1;

  // 各日ごとの全パス価格を保持(日次分位点バンド計算に必要)。
  const dayBuf = [];
  for (let t = 0; t < cols; t++) dayBuf.push(new Float64Array(paths));

  const nSamples = Math.min(samplePaths, paths);
  const samples = [];

  for (let p = 0; p < paths; p++) {
    let logp = 0;
    dayBuf[0][p] = spot;
    const keep = p < nSamples ? [spot] : null;
    for (let t = 1; t < cols; t++) {
      logp += drift + vol * randn();
      const price = spot * Math.exp(logp);
      dayBuf[t][p] = price;
      if (keep) keep.push(price);
    }
    if (keep) samples.push(keep);
  }

  // 終端統計(ソート前に mean / 元本割れ確率を計算)。
  const term = dayBuf[cols - 1];
  let mean = 0;
  let loss = 0;
  for (let i = 0; i < paths; i++) {
    mean += term[i];
    if (term[i] < spot) loss++;
  }
  mean /= paths;
  const probLoss = loss / paths;

  // 日次分位点バンド(各日バッファは破壊的にソートしてよい)。
  const bandP10 = new Array(cols);
  const bandP50 = new Array(cols);
  const bandP90 = new Array(cols);
  // 終端の 5 分位は別途とるため、終端はコピーしてからソート。
  const termCopy = Float64Array.from(term);
  const p10 = quantileInPlace(Float64Array.from(term), 10);
  const p25 = quantileInPlace(Float64Array.from(term), 25);
  const p50 = quantileInPlace(Float64Array.from(term), 50);
  const p75 = quantileInPlace(Float64Array.from(term), 75);
  const p90 = quantileInPlace(termCopy, 90);

  for (let t = 0; t < cols; t++) {
    bandP10[t] = quantileInPlace(Float64Array.from(dayBuf[t]), 10);
    bandP50[t] = quantileInPlace(Float64Array.from(dayBuf[t]), 50);
    bandP90[t] = quantileInPlace(dayBuf[t], 90);
  }

  return {
    spot,
    days,
    paths,
    mu,
    sigma,
    p10,
    p25,
    p50,
    p75,
    p90,
    expected: mean,
    probLoss,
    expectedReturn: mean / spot - 1,
    band: { days: Array.from({ length: cols }, (_, i) => i), p10: bandP10, p50: bandP50, p90: bandP90 },
    samples,
  };
}
