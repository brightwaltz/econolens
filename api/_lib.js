// サーバーレス関数の共有ヘルパー。
// 先頭が "_" のファイルは Vercel のルーティング対象外(関数化されない)。

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";

// インパクトスコア1件分の JSON スキーマ(analyze / recommend で共通)。
export const IMPACT_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", description: "候補ユニバースに存在するティッカー(例 1959.T, AAPL)。ユニバース外は出力しない。" },
    direction: { type: "string", enum: ["up", "down"], description: "株価への方向。up=買い材料, down=売り材料" },
    magnitude: { type: "number", description: "業績への影響の大きさ 0.0〜1.0" },
    horizon_months: { type: "integer", description: "効果が顕在化するまでの月数" },
    confidence: { type: "number", description: "推論の確信度 0.0〜1.0" },
    already_priced_in: { type: "number", description: "既に株価に織り込み済みと推定される度合い 0.0〜1.0。報道済みで急騰/急落済みなら高い。" },
    rationale: { type: "string", description: "なぜこの銘柄がこの方向に動くかの根拠(日本語、1-2文)" },
  },
  required: ["code", "direction", "magnitude", "horizon_months", "confidence", "already_priced_in", "rationale"],
};

export function getClient() {
  return new Anthropic();
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// 同一オリジンの静的アセット instruments.json を取得してユニバースを得る。
export async function loadUniverse(req) {
  const host = req.headers.host;
  const proto =
    req.headers["x-forwarded-proto"] ||
    (host && host.startsWith("localhost") ? "http" : "https");
  const r = await fetch(`${proto}://${host}/instruments.json`);
  if (!r.ok) throw new Error(`銘柄ユニバースの取得に失敗しました (HTTP ${r.status})`);
  return r.json();
}

// プロンプトに渡す軽量な銘柄ユニバース表現(市場で絞り込み可)。
export function universeForPrompt(universe, market) {
  const filtered =
    market && market !== "all"
      ? universe.filter((i) => i.market === market)
      : universe;
  return filtered.map((i) => ({
    code: i.code,
    name: i.name,
    market: i.market,
    sector: i.sector,
    theme: i.theme,
    region: i.region,
  }));
}

// インパクト配列の後処理: ユニバース外コードを除去し、銘柄名を補う(ハルシネーション対策)。
export function sanitizeImpacts(impacts, universe) {
  const byCode = new Map(universe.map((i) => [i.code, i]));
  const validCodes = new Set(universe.map((i) => i.code));
  return (impacts || [])
    .filter((im) => validCodes.has(im.code))
    .map((im) => ({ ...im, name: byCode.get(im.code)?.name || im.code }));
}
