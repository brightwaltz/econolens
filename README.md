# EconoLens

実体経済イベント駆動型 株価予測・シミュレーションツール。

過去のチャートだけでなく「世の中の出来事(例: TSMC 熊本進出)→ 経済・地域への波及 → 需要 → 企業業績 → 株価」という因果連鎖を LLM で推論し、定量モデル(モンテカルロ)と統合して予測する。全体設計は [PLAN.md](PLAN.md) を参照。

## Web 版(Vercel)

ブラウザで動く Web 版があり、3 つの機能を提供する。**LLM の API は使わず**、質的な調査は利用者のサブスク **Deep Research**(ChatGPT / Gemini / Claude 等)に委ね、その結果を貼り込んで定量化する(= API 追加課金ゼロ・キー不要)。

- **今のおすすめ** — 「調査プロンプトを生成」→ お使いの Deep Research で実行 → 出力(末尾の JSON ブロック)を貼り付け → アプリが「今の買い/売り」をランキング。市場の主要イベントと根拠付き。
- **イベント分析** — 「TSMC が熊本に第3工場を建設」のような出来事の調査プロンプトを生成 → Deep Research の結果を貼り付け → 因果連鎖(1〜3次波及)と影響銘柄を表示。
- **個別銘柄予測** — ティッカーと期間から GBM モンテカルロで価格分布(P10/P50/P90)とファンチャートを表示。ランキングの銘柄をクリックすると、そのインパクトを織り込んだ**イベント調整後**の予測に飛ぶ。

アプリの役割は「データの集約 + 定量化(ランキング・予測ドリフト注入)」。質的推論は外部 Deep Research が担う。仕組み: プロンプト生成・貼り付け解析は `public/research.js`、価格は `api/prices.js`(Yahoo, キー不要)。ローカルは `npm run dev`。デプロイ手順は [DEPLOY.md](DEPLOY.md)。

## CLI 版(Python)

CLI 版の実装範囲は **Phase 0-1**(プロジェクト基盤 + 定量予測ベースライン)。CLI 側の LLM 分析(Phase 2 以降)は未実装のため、CLI は API キー不要で動作する。

## セットアップ

```bash
uv sync
```

## 使い方

```bash
# 銘柄マスタ一覧(市場 / テーマ / 地域で絞り込み可)
uv run econolens instruments list
uv run econolens instruments list --theme 半導体
uv run econolens instruments list --region 熊本

# 個別銘柄の任意期間後の価格分布予測(GBM モンテカルロ)
uv run econolens forecast 7203.T --horizon 1y     # トヨタ
uv run econolens forecast AAPL --horizon 6m       # Apple
uv run econolens forecast 0700.HK --horizon 1y    # テンセント
uv run econolens forecast ^GSPC --horizon 3y      # S&P500 指数
uv run econolens forecast ACWI --horizon 3y       # オルカン代替(全世界株 ETF)

# ファンチャート(HTML)も出力
uv run econolens forecast 6258.T --horizon 6m --chart fan.html
```

## テスト

```bash
uv run pytest
```

## 注意・免責

- 出力は情報に基づく仮説生成・シミュレーションであり、投資助言ではありません。投資判断は自己責任です。
- 価格は yfinance(Yahoo Finance 非公式 API)経由で取得します(個人利用前提)。
- 投資信託(オルカン等)は ACWI/VT などの ETF をプロキシとして扱います(為替・信託報酬で乖離あり)。
- 中国 A 株(.SS/.SZ)はデータ欠損が起きる場合があります。
