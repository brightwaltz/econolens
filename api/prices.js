// Vercel サーバーレス関数: Yahoo Finance から日足終値を取得して返す。
//
// ブラウザから Yahoo を直接叩くと CORS で弾かれるため、サーバー側で代理取得する。
// 元の Python 実装(econolens/data/prices.py)の yfinance 取得に相当。
//
// GET /api/prices?code=7203.T
//   -> { code, currency, exchange, spot, prices: [{date, close}, ...] }

const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";

// Yahoo の range は 1d/5d/1mo/3mo/6mo/1y/2y/5y/10y/ytd/max のみ(3y は不可)。
// ドリフト/ボラ推定に十分な 5 年分を取得し、絞り込みはフロント側で行う。
const RANGE = "5y";

export default async function handler(req, res) {
  const code = String(req.query.code || "").trim();
  if (!code) {
    res.status(400).json({ error: "code パラメータが必要です(例: 7203.T)" });
    return;
  }

  const url =
    `${YF_CHART}${encodeURIComponent(code)}` +
    `?range=${RANGE}&interval=1d&includeAdjustedClose=true`;

  try {
    const r = await fetch(url, {
      headers: {
        // Yahoo は UA 無しだと弾くことがある。
        "User-Agent":
          "Mozilla/5.0 (compatible; EconoLens/0.1; +https://github.com)",
        Accept: "application/json",
      },
    });

    if (!r.ok) {
      res
        .status(502)
        .json({ error: `Yahoo Finance 応答エラー: HTTP ${r.status}` });
      return;
    }

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const msg = data?.chart?.error?.description || "データが見つかりません";
      res.status(404).json({ error: `'${code}': ${msg}` });
      return;
    }

    const ts = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    // 調整後終値(配当・分割調整)を優先。無ければ素の終値。
    const adj = result.indicators?.adjclose?.[0]?.adjclose;
    const closeArr = adj || quote.close || [];

    const prices = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closeArr[i];
      if (c == null || Number.isNaN(c)) continue;
      const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      prices.push({ date, close: c });
    }

    if (prices.length < 30) {
      res.status(404).json({
        error:
          `'${code}' の有効な価格データが不足しています。` +
          `ティッカーが正しいか、(中国A株 .SS/.SZ などで)データが` +
          `提供されているか確認してください。`,
      });
      return;
    }

    // Vercel エッジで 1 時間キャッシュ(価格は日次更新のため十分)。
    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );
    res.status(200).json({
      code,
      currency: result.meta?.currency || null,
      exchange: result.meta?.exchangeName || null,
      spot: prices[prices.length - 1].close,
      prices,
    });
  } catch (e) {
    res.status(502).json({ error: `取得に失敗しました: ${String(e)}` });
  }
}
