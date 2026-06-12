"""アプリケーション設定。

環境変数で上書き可能なものは os.environ から読む。デフォルトはユーザーの
ホーム配下にデータディレクトリを作成する。
"""

from __future__ import annotations

import os
from pathlib import Path

# データ格納先(SQLite DB / キャッシュ)。ECONOLENS_HOME で上書き可能。
DATA_DIR = Path(os.environ.get("ECONOLENS_HOME", Path.home() / ".econolens"))
DB_PATH = DATA_DIR / "econolens.db"

# パッケージ同梱の初期銘柄マスタ。
SEED_INSTRUMENTS_CSV = Path(__file__).parent / "data" / "seed_instruments.csv"

# モンテカルロのデフォルトパス数。
DEFAULT_PATHS = 10_000

# 価格履歴の取得期間(ドリフト/ボラ推定に十分な長さ)。
PRICE_LOOKBACK_YEARS = 3

# EWMA ボラティリティの減衰係数(RiskMetrics 標準)。
EWMA_LAMBDA = 0.94

# 年間営業日数(年率化に使用)。
TRADING_DAYS = 252


def ensure_data_dir() -> None:
    """データディレクトリが無ければ作成する。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
