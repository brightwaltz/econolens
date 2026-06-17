// Deep Research ブリッジ: プロンプト生成 + 貼り付け結果の解析(API レス)。
//
// アプリは LLM API を一切呼ばない。代わりに、ユーザーが自分のサブスク Deep Research
// (ChatGPT / Gemini / Claude 等)で実行するためのプロンプトを生成し、その出力(厳密な
// JSON ブロック)を貼り付けてもらって解析する。質的推論は外部 Deep Research が担い、
// アプリは「データの集約 + 定量化(ランキング・予測ドリフト注入)」を担当する。

const MARKET_LABEL = { all: "すべて(日米中・指数・ETF)", jp: "日本株", us: "米国株", cn: "中国株" };
const FENCE = "```"; // ダブルクォート文字列内のバッククォートはリテラル

function marketLabel(m) {
  return MARKET_LABEL[m] || m;
}

// プロンプトに埋め込む銘柄ユニバース(市場で絞り込み)。
export function universeForPrompt(instruments, market) {
  return market && market !== "all"
    ? instruments.filter((i) => i.market === market)
    : instruments;
}

function universeLines(list) {
  return list
    .map((i) => `${i.code} | ${i.name} | ${i.market} | ${i.sector || ""} | ${(i.theme || []).join(";")}`)
    .join("\n");
}

// impacts 1件分の出力スキーマ例(プロンプトに提示)。
const IMPACT_EXAMPLE =
  '{"code":"1959.T","direction":"up","magnitude":0.6,"confidence":0.7,"already_priced_in":0.4,"horizon_months":12,"rationale":"根拠(1-2文、日本語)"}';

const IMPACT_RULES = `- magnitude / confidence / already_priced_in は 0.0〜1.0 の数値、horizon_months は整数(月)。
- direction は "up"(買い材料)または "down"(売り材料)。
- code は必ず下記ユニバースに存在するものだけを使う。ユニバース外の銘柄は出力しない。
- 「良いニュース=買い」ではない。既に大きく報道され株価が動いた銘柄は already_priced_in を高く(=妙味は小さい)。まだ織り込みが浅い銘柄を相対的に高く評価する。
- 確度の高いものに絞る。不確実性が高い場合は confidence を下げる。`;

// 「今のおすすめ」用プロンプト(現在の市場を動かす出来事を調査 → 買い/売り集約)。
export function buildRecommendPrompt(instruments, market) {
  const list = universeForPrompt(instruments, market);
  return `あなたは日本・米国・中国の株式市場に精通したアナリストです。Deep Research 機能を使い、本日時点で直近約2週間に市場を動かしている主要な出来事を、一次情報・複数ソースで多角的に調査してください。そのうえで、下記「候補ユニバース」から「今の買い/売り」を選定します。

# 考え方
出来事 → 経済・地域・人の変化 → 新たな需要 → 企業業績 → 株価、の波及で評価する。負の影響(競合・コスト増・規制)も挙げる。

# 評価ルール
${IMPACT_RULES}
- 買い・売り合計で目安 8〜14 件に絞る。

# 対象市場
${marketLabel(market)}

# 候補ユニバース(この code のみ使用可。「コード | 名称 | 市場 | セクター | テーマ」)
${universeLines(list)}

# 出力形式(厳守)
調査の本文・出典を書いたうえで、**最後に説明とは別に、次のスキーマに厳密に従う JSON を ${FENCE}json コードブロックで1つだけ** 出力してください。余分なキー・コメントを含めないこと。
${FENCE}json
{
  "market_summary": "現在の地合いの要約(2-3文、日本語)",
  "key_events": [{"title":"出来事の見出し","why_matters":"なぜ市場に効くか(1-2文)"}],
  "impacts": [${IMPACT_EXAMPLE}]
}
${FENCE}`;
}

// 「イベント分析」用プロンプト(指定イベントの因果連鎖 → 影響銘柄)。
export function buildEventPrompt(instruments, market, eventText) {
  const list = universeForPrompt(instruments, market);
  return `あなたは日本・米国・中国の株式市場とサプライチェーン分析に精通したアナリストです。Deep Research 機能を使い、次の「出来事・シナリオ」が実体経済と株価に及ぼす影響を、関連する事実・前例・サプライチェーンを調査しながら分析してください。

# 出来事・シナリオ
${eventText}

# 分析の観点(因果連鎖)
- 1次波及(直接需要): その出来事が直接生む需要・受注。
- 2次波及(人と地域の変化): 雇用・人口流入・住宅・金融・交通・小売など地域経済の変化。
- 3次波及(構造変化): 賃金/地価上昇による負の影響、関連産業の集積、期待の先行織り込み等。

# 評価ルール
${IMPACT_RULES}
- 影響が薄い銘柄は無理に挙げず、確度の高いものに絞る(目安5〜12件)。

# 対象市場
${marketLabel(market)}

# 候補ユニバース(この code のみ使用可。「コード | 名称 | 市場 | セクター | テーマ」)
${universeLines(list)}

# 出力形式(厳守)
分析の本文・出典を書いたうえで、**最後に説明とは別に、次のスキーマに厳密に従う JSON を ${FENCE}json コードブロックで1つだけ** 出力してください。余分なキー・コメントを含めないこと。tier は 1=直接需要, 2=人と地域, 3=構造変化。
${FENCE}json
{
  "summary": "この出来事の株式市場への影響の要約(2-3文、日本語)",
  "causal_chain": [{"tier":1,"title":"波及の見出し","description":"説明(1-2文)"}],
  "impacts": [${IMPACT_EXAMPLE}]
}
${FENCE}`;
}

// 2巡目(深掘り)プロンプト: 上位銘柄の織り込み度を最新の値動きで再検証 + 見落としを追加。
export function buildDrillPrompt(instruments, market, currentImpacts) {
  const codes = (currentImpacts || []).map((i) => `${i.code}(${i.name})`).join(", ") || "(なし)";
  const list = universeForPrompt(instruments, market);
  return `先の分析の精度を上げるための追加調査(2巡目)です。Deep Research 機能で最新の株価の値動きとニュースを確認してください。

# 現在の候補
${codes}

# 依頼
1. 上記候補について、直近の値動き・報道量から already_priced_in(織り込み済み度)を再評価する(急騰/急落済みなら高く)。
2. 先の分析で見落とした、いま注目すべき銘柄を候補ユニバースから追加する。
3. 確度の低い候補は除外する。

# 評価ルール
${IMPACT_RULES}

# 対象市場
${marketLabel(market)}

# 候補ユニバース(この code のみ使用可。「コード | 名称 | 市場 | セクター | テーマ」)
${universeLines(list)}

# 出力形式(厳守)
更新後の全候補を、**最後に説明とは別に、次のスキーマに厳密に従う JSON を ${FENCE}json コードブロックで1つだけ** 出力してください。
${FENCE}json
{
  "market_summary": "更新後の地合い要約(2-3文)",
  "key_events": [{"title":"出来事の見出し","why_matters":"なぜ市場に効くか(1-2文)"}],
  "impacts": [${IMPACT_EXAMPLE}]
}
${FENCE}`;
}

// ---- パーサ ----

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 貼り付けテキストから JSON オブジェクトを抽出する。
// 1) ```json フェンス(最後に出現する妥当なもの)を優先 → 2) 平衡した {...} の最長を採用。
function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (let i = fences.length - 1; i >= 0; i--) {
    const p = tryParse(fences[i]);
    if (p && typeof p === "object") return p;
  }
  // 平衡ブレース走査(文字列中のブレースは考慮しないが、本スキーマでは実用上十分)。
  const candidates = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    const p = tryParse(c);
    if (p && typeof p === "object") return p;
  }
  return null;
}

export class ResearchParseError extends Error {}

// 貼り付け結果を解析して { ...obj } を返す(impacts の存在を検証)。サニタイズは呼び出し側。
export function parseResearchJson(text) {
  if (!text || !text.trim()) {
    throw new ResearchParseError("結果が空です。Deep Research の出力を貼り付けてください。");
  }
  const obj = extractJson(text);
  if (!obj) {
    throw new ResearchParseError(
      "JSON を検出できませんでした。Deep Research の出力末尾の ```json … ``` ブロックを含めて貼り付けてください。"
    );
  }
  if (!Array.isArray(obj.impacts)) {
    throw new ResearchParseError(
      "JSON に impacts 配列が見つかりません。出力形式の指示どおり生成されているか確認してください。"
    );
  }
  return obj;
}

function clamp01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ユニバース外 code を除去し、数値をクランプ、銘柄名を補完(ハルシネーション対策)。
export function sanitizeImpacts(impacts, instruments) {
  const byCode = new Map(instruments.map((i) => [i.code.toUpperCase(), i]));
  const out = [];
  for (const im of impacts || []) {
    if (!im || !im.code) continue;
    const inst = byCode.get(String(im.code).toUpperCase());
    if (!inst) continue;
    const hm = Number(im.horizon_months);
    out.push({
      code: inst.code,
      name: inst.name,
      direction: im.direction === "down" ? "down" : "up",
      magnitude: clamp01(im.magnitude),
      confidence: clamp01(im.confidence),
      already_priced_in: clamp01(im.already_priced_in),
      horizon_months: Number.isFinite(hm) ? Math.max(1, Math.round(hm)) : 12,
      rationale: String(im.rationale || ""),
    });
  }
  return out;
}
