# EconoLens

実体経済イベント駆動型 株価予測・シミュレーションツール。

過去のチャートだけでなく「世の中の出来事(例: TSMC 熊本進出)→ 経済・地域への波及 → 需要 → 企業業績 → 株価」という因果連鎖を読み、定量モデル(GBM モンテカルロ)と統合して予測する。日本・米国・中国の個別株、指数(S&P500・日経225 等)、ETF・投信プロキシ(オルカン= ACWI 等)に対応。全体設計は [PLAN.md](PLAN.md)。

**公開 URL: https://econolens.vercel.app/**

---

## 2 つのサーフェス

| | Web 版(Vercel) | CLI 版(Python) |
|---|---|---|
| 用途 | 日常利用・共有 | 研究・バッチ |
| 予測 | GBM モンテカルロ(ブラウザ内 JS) | GBM モンテカルロ |
| 質的分析 | 外部 **Deep Research** の貼り付け | 未実装(Phase 2 以降) |
| API キー | **不要** | 不要 |

---

## Web 版(Vercel)

ブラウザで動き、3 つの機能を提供する。**アプリは LLM の API を呼ばない**。質的な調査は利用者のサブスク **Deep Research**(ChatGPT / Gemini / Claude 等)に委ね、その出力(構造化 JSON)を貼り込んで定量化する(= API 追加課金ゼロ・キー不要)。

- **今のおすすめ** — 調査プロンプトを生成 → Deep Research で実行 → 結果を貼り付け → 市場の主要イベントと「今の買い/売り」を根拠付きでランキング。
- **イベント分析** — 「TSMC が熊本に第3工場を建設」のような出来事のプロンプトを生成 → 結果を貼り付け → 因果連鎖(1〜3次波及)と影響銘柄を表示。
- **個別銘柄予測** — ティッカーと期間から価格分布(P10/P50/P90)とファンチャートを表示。ランキングの銘柄をクリックすると、そのインパクトを織り込んだ**イベント調整後**の予測に飛ぶ。

操作の流れ(「今のおすすめ」「イベント分析」共通):

1. **① 調査プロンプトを生成** → コピー
2. お使いの Deep Research に貼って実行
3. 出力(末尾の ` ```json ` ブロックを含む)を貼り付け → **③ 取り込んで分析**
4. 必要なら **2巡目の深掘りプロンプト**で精度を上げる(織り込み度の再検証・見落とし候補の追加)

アプリの役割は「データの集約 + 定量化(ランキング・予測ドリフト注入)」、質的推論は外部 Deep Research が担う。

### Web 版をローカルで動かす

```bash
npm install
npm run dev      # http://localhost:3000
```

`dev-server.mjs` が `public/`(静的)と `api/prices`(Yahoo 価格プロキシ)を Vercel と同等に提供する。デプロイ手順は [DEPLOY.md](DEPLOY.md)。

### Web 版の構成

- `public/` — フロントエンド(`index.html` / `app.js` / `styles.css`)
  - `public/quant.js` — GBM モンテカルロ・統計推定・イベント α 注入(`eventAlpha` / `applyImpact`)
  - `public/research.js` — Deep Research 用プロンプト生成 + 貼り付け結果の解析・サニタイズ
- `api/prices.js` — Yahoo Finance 価格取得のサーバーレス・プロキシ(キー不要)

---

## CLI 版(Python)

実装範囲は **Phase 0-1**(プロジェクト基盤 + 定量予測ベースライン)。パッケージ管理は **uv**。

```bash
uv sync
```

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

### テスト

```bash
uv run pytest      # ネットワーク非依存
```

---

## 注意・免責

- 出力は情報に基づく仮説生成・シミュレーションであり、投資助言ではありません。投資判断は自己責任です。
- 価格は Yahoo Finance(非公式 API)経由で取得します(個人利用前提・遅延あり)。
- 投資信託(オルカン等)は ACWI / VT などの ETF をプロキシとして扱います(為替・信託報酬で乖離あり)。
- 中国 A 株(.SS / .SZ)はデータ欠損が起きる場合があります。
- イベント α の予測ドリフト注入は簡易ヒューリスティックです(上限あり)。
