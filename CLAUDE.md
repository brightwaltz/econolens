# CLAUDE.md — EconoLens 開発ガイド

## このプロジェクトは何か
実体経済イベント駆動型の株価予測・シミュレーションツール。**マスター設計は [PLAN.md](PLAN.md)** にあり、全 7 フェーズで構成される。実装は PLAN.md の Phase 番号を起点に進める。

現在の実装範囲: **Phase 0-1**(基盤 + 定量予測ベースライン)。Phase 2 以降(ニュース収集・LLM 因果連鎖推論・recommend・simulate・backtest)は未実装。

## 環境・コマンド
パッケージ管理は **uv**。

```bash
uv sync                 # 依存インストール
uv run econolens ...     # CLI 実行
uv run pytest            # テスト(ネットワーク非依存)
```

`uv` が PATH に無い場合は `export PATH="$HOME/.local/bin:$PATH"`。

## アーキテクチャ(層構成)
PLAN.md §3 の 5 層に対応:
- `econolens/data/` — ① データ収集層。`instruments.py`(銘柄マスタ)、`prices.py`(yfinance + SQLite キャッシュ)。**外部 I/O はここに隔離**し、上位層はネット非依存でテストする。
- `econolens/quant/` — ③ 定量予測層。`stats.py`(ドリフト/ボラ推定)、`montecarlo.py`(GBM)。
- `econolens/report/` — ⑤ 出力層。`terminal.py`(rich)、`fanchart.py`(plotly)。
- `econolens/forecast_service.py` — パイプライン統合(取得→推定→シミュ→保存)。Phase 3+ で LLM インパクトスコア注入を足す箇所。
- `econolens/cli.py` — typer エントリポイント。CLI は薄く保ち、ロジックは service / quant に置く。
- `econolens/db.py` — SQLite スキーマ。Phase 2+ で news/events/impact_scores テーブルを追加予定。

## 規約
- 日本語でコメント・ドキュメント・ユーザー向け出力を書く(ユーザーは日本語話者)。
- 新しい外部データソースは必ず `data/` 層に閉じ込め、戻り値は pandas / dataclass に正規化する。
- 予測実行は `forecasts` テーブルにスナップショット保存する(前向き検証の土台 — PLAN.md §8)。
- 全ユーザー向け出力に免責文言(`econolens.DISCLAIMER`)を付す。
- テストはネットワーク非依存(合成系列・一時 DB)。yfinance 呼び出しはモックするか `prices.py` に隔離したまま検証する。

## データ保存先
`~/.econolens/econolens.db`(`ECONOLENS_HOME` で上書き可)。テストは `tmp_path` を `ECONOLENS_HOME` に設定して隔離。
