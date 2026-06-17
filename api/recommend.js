// Vercel サーバーレス関数: 「今のおすすめ」(PLAN.md の recommend / Phase 2 ニュース収集)。
//
// 直近の市場ニュース(Google News RSS)をサーバー側で自動取得し、Claude が
// 「いま市場を動かしている主要イベント」を特定 → 候補ユニバースから買い/売りを
// 集約ランキングして返す。
//
// POST /api/recommend  body: { market?: "jp"|"us"|"cn"|"all" }
//   -> { as_of, market, market_summary, key_events: [...], impacts: [...], headlines_used }

import {
  MODEL,
  IMPACT_ITEM_SCHEMA,
  getClient,
  hasApiKey,
  loadUniverse,
  universeForPrompt,
  sanitizeImpacts,
} from "./_lib.js";

// 市場ごとのニュース検索クエリ + Google News ロケール。
const NEWS = {
  jp: { q: "日経平均 OR 東証 OR 半導体 OR 決算 OR 金利 OR 円相場", hl: "ja", gl: "JP", ceid: "JP:ja" },
  us: { q: "stock market OR Nasdaq OR S&P 500 OR earnings OR Federal Reserve OR rates", hl: "en-US", gl: "US", ceid: "US:en" },
  cn: { q: "中国 株式 OR 上海総合 OR ハンセン OR 不動産 OR 半導体規制", hl: "ja", gl: "JP", ceid: "JP:ja" },
  all: { q: "株式市場 OR 日経平均 OR Nasdaq OR 半導体 OR 金利 OR 為替", hl: "ja", gl: "JP", ceid: "JP:ja" },
};

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Google News RSS から直近の見出しを取得(キー不要)。失敗時は空配列。
async function fetchHeadlines(market, limit = 35) {
  const cfg = NEWS[market] || NEWS.all;
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(cfg.q + " when:4d")}` +
    `&hl=${cfg.hl}&gl=${cfg.gl}&ceid=${cfg.ceid}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EconoLens/0.1)" },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < limit) {
      const block = m[1];
      const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const date = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim();
      if (title) items.push({ title, date });
    }
    return items;
  } catch {
    return [];
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    market_summary: { type: "string", description: "直近ニュースから読み取れる現在の市場の地合いの要約(2-3文、日本語)" },
    key_events: {
      type: "array",
      description: "いま市場を動かしている主要な出来事(3〜6件)。",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "出来事の見出し(短く、日本語)" },
          why_matters: { type: "string", description: "なぜ市場に効くか(1-2文、日本語)" },
        },
        required: ["title", "why_matters"],
      },
    },
    impacts: {
      type: "array",
      description: "上記イベントを踏まえた『今の買い/売り』候補。候補ユニバースに含まれる code のみを使うこと。",
      items: IMPACT_ITEM_SCHEMA,
    },
  },
  required: ["market_summary", "key_events", "impacts"],
};

const SYSTEM_PROMPT = `あなたは日本・米国・中国の株式市場に精通したアナリストです。
直近の市場ニュース見出しと候補ユニバースを渡します。次を行ってください:

1. 見出しから「いま市場を動かしている主要な出来事」を3〜6件特定する。
2. それらを踏まえ、候補ユニバースの中から「今、買い」「今、売り」の銘柄を選び、インパクトスコアを付ける。

重要な原則:
- 「良いニュース=買い」ではない。既に大きく報道され株価が動いた銘柄は already_priced_in を高くする(=いまから入る妙味は小さい)。
- 逆に、波及がこれから顕在化する銘柄(まだ織り込みが浅い)を相対的に高く評価する。
- 銘柄は必ず与えられたユニバースの code のみ。確度の高いものに絞る(買い・売り合わせて目安8〜14件)。
- 見出しが古い/関連が薄い場合は confidence を下げる。中国本土関連の不確実性が高い場合も confidence を下げる。
- 見出しはタイトルのみで本文が無い点に注意し、過度な断定を避ける。

出力は必ず指定された JSON スキーマに従うこと。`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST で呼び出してください" });
    return;
  }
  if (!hasApiKey()) {
    res.status(503).json({
      error:
        "サーバーに ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数に設定してください(おすすめ機能に必要)。",
    });
    return;
  }

  const market = (req.body && req.body.market) || "all";

  try {
    const [universe, headlines] = await Promise.all([
      loadUniverse(req),
      fetchHeadlines(market),
    ]);
    const universeList = universeForPrompt(universe, market);

    if (headlines.length === 0) {
      res.status(502).json({ error: "ニュースの取得に失敗しました。少し時間をおいて再試行してください。" });
      return;
    }

    const client = getClient();
    const userContent =
      `# 直近の市場ニュース見出し(新しい順)\n` +
      headlines.map((h, i) => `${i + 1}. ${h.title}${h.date ? ` (${h.date})` : ""}`).join("\n") +
      `\n\n# 対象市場\n${market}\n\n` +
      `# 候補ユニバース(この中の code のみ使用可)\n` +
      JSON.stringify(universeList);

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    });
    const message = await stream.finalMessage();

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("モデルから有効な応答が得られませんでした");
    const parsed = JSON.parse(textBlock.text);
    parsed.impacts = sanitizeImpacts(parsed.impacts, universe);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      as_of: new Date().toISOString(),
      market,
      model: MODEL,
      headlines_used: headlines.length,
      ...parsed,
    });
  } catch (e) {
    const status = e?.status && Number.isInteger(e.status) ? e.status : 502;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: `おすすめの生成に失敗しました: ${e?.message || String(e)}`,
    });
  }
}
