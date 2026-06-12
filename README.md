# EconoLens

実体経済イベント駆動型 株価予測・シミュレーションツール。

過去のチャートだけでなく「世の中の出来事(例: TSMC 熊本進出)→ 経済・地域への波及 → 需要 → 企業業績 → 株価」という因果連鎖を LLM で推論し、定量モデル(モンテカルロ)と統合して予測する。全体設計は [PLAN.md](PLAN.md) を参照。

現在の実装範囲は **Phase 0-1**(プロジェクト基盤 + 定量予測ベースライン)。LLM 分析(Phase 2 以降)は未実装のため、本フェーズは API キー不要で動作する。

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
