// Vercel サーバーレス関数: イベント駆動の因果連鎖分析(PLAN.md Phase 2 のWeb版)。
//
// 自然文のイベント(例「TSMCが熊本に第3工場を建設」)を入力に、Claude が
//   実体経済イベント → 経済・地域への波及 → 企業業績 → 株価
// の因果連鎖を推論し、銘柄ごとのインパクトスコアを返す。
//
// API キーはサーバー側の環境変数 ANTHROPIC_API_KEY からのみ読む(クライアントに露出しない)。
//
// POST /api/analyze  body: { event: string, market?: "jp"|"us"|"cn"|"all" }
//   -> { summary, causal_chain: [...], impacts: [...] }

import {
  MODEL,
  IMPACT_ITEM_SCHEMA,
  getClient,
  hasApiKey,
  loadUniverse,
  universeForPrompt,
  sanitizeImpacts,
} from "./_lib.js";

// Claude に返させる JSON スキーマ(構造化出力で形を固定)。
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "このイベントの株式市場への影響の要約(2-3文、日本語)" },
    causal_chain: {
      type: "array",
      description: "実体経済への波及の因果連鎖。1次(直接需要)→2次(人と地域の変化)→3次(構造変化)の順。",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tier: { type: "integer", description: "波及の次数。1=直接需要, 2=人と地域の変化, 3=構造変化" },
          title: { type: "string", description: "波及の見出し(短く)" },
          description: { type: "string", description: "その波及の説明(日本語、1-2文)" },
        },
        required: ["tier", "title", "description"],
      },
    },
    impacts: {
      type: "array",
      description: "影響を受ける銘柄ごとのインパクトスコア。候補ユニバースに含まれる code のみを使うこと。",
      items: IMPACT_ITEM_SCHEMA,
    },
  },
  required: ["summary", "causal_chain", "impacts"],
};

const SYSTEM_PROMPT = `あなたは日本・米国・中国の株式市場とサプライチェーン分析に精通したアナリストです。
与えられた「実体経済のイベント」について、次の因果連鎖を推論します:

  イベント → 経済・地域コミュニティ・人の変化 → 新規需要の発生 → 企業業績への影響 → 株価への影響

分析の観点(必ず複数の観点から考える):
- 1次波及(直接需要): そのイベントが直接生む需要・受注。
- 2次波及(人と地域の変化): 雇用・人口流入・住宅・金融・交通・小売など地域経済の変化。
- 3次波及(構造変化): 賃金/地価の上昇による負の影響、関連産業の集積、期待の先行織り込みなど。
- 負の影響も挙げる(競合・コスト上昇・代替で不利になる銘柄は direction=down)。

重要な原則:
- 「良いニュース=買い」ではない。発表時に既に急騰済みなら妙味は小さい → already_priced_in を高く見積もる。
- 銘柄は必ず与えられた候補ユニバースの code のみを使う。ユニバースに無い銘柄は挙げない。
- 中国本土ソース由来の不確実性が高い場合は confidence を下げる。
- 影響が薄い銘柄は無理に挙げず、確度の高いものに絞る(目安5〜12件)。

出力は必ず指定された JSON スキーマに従うこと。`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST で呼び出してください" });
    return;
  }
  if (!hasApiKey()) {
    res.status(503).json({
      error:
        "サーバーに ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数に設定してください(イベント分析機能に必要)。",
    });
    return;
  }

  const body = req.body || {};
  const event = String(body.event || "").trim();
  const market = body.market || "all";
  if (!event) {
    res.status(400).json({ error: "event(分析したいイベントの説明)が必要です" });
    return;
  }
  if (event.length > 600) {
    res.status(400).json({ error: "event が長すぎます(600文字以内)" });
    return;
  }

  try {
    const universe = await loadUniverse(req);
    const universeList = universeForPrompt(universe, market);

    const client = getClient();

    const userContent =
      `# 分析対象のイベント\n${event}\n\n` +
      `# 対象市場\n${market}\n\n` +
      `# 候補ユニバース(この中の code のみ使用可)\n` +
      JSON.stringify(universeList);

    // 構造化出力 + adaptive thinking。長めの推論になり得るため streaming で接続を維持する。
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

    // 構造化出力では text ブロックに JSON が入る(thinking ブロックの後)。
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("モデルから有効な応答が得られませんでした");
    const parsed = JSON.parse(textBlock.text);

    // ハルシネーション対策: ユニバース外の code を除去し、各銘柄に名前を補う。
    parsed.impacts = sanitizeImpacts(parsed.impacts, universe);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ event, market, model: MODEL, ...parsed });
  } catch (e) {
    const status = e?.status && Number.isInteger(e.status) ? e.status : 502;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: `分析に失敗しました: ${e?.message || String(e)}`,
    });
  }
}
