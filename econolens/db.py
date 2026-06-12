"""SQLite 接続とスキーマ管理。

スキーマ(Phase 0-1 で使用するもの):
  - instruments : 銘柄マスタ
  - prices      : 日足 OHLCV キャッシュ
  - forecasts   : 予測実行履歴(前向き検証の土台 — PLAN.md §8)

Phase 2 以降で news / events / impact_scores / knowledge_edges /
recommendations を追加する想定。
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS instruments (
    code         TEXT PRIMARY KEY,   -- yfinance ティッカー (例 7203.T, AAPL, ^GSPC)
    market       TEXT NOT NULL,      -- jp / us / cn / index / etf
    name         TEXT NOT NULL,
    sector       TEXT,
    region_tags  TEXT,               -- カンマ区切り (例 "熊本,九州")
    theme_tags   TEXT,               -- カンマ区切り (例 "半導体")
    currency     TEXT,               -- JPY / USD / HKD / CNY
    note         TEXT
);

CREATE TABLE IF NOT EXISTS prices (
    code    TEXT NOT NULL,
    date    TEXT NOT NULL,           -- ISO 日付 YYYY-MM-DD
    open     REAL,
    high     REAL,
    low      REAL,
    close    REAL,
    volume   REAL,
    PRIMARY KEY (code, date)
);

CREATE TABLE IF NOT EXISTS forecasts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,       -- 実行日時 (ISO)
    code        TEXT NOT NULL,
    horizon     TEXT NOT NULL,       -- 入力ホライズン文字列 (例 1y)
    spot        REAL NOT NULL,       -- 実行時点の現在値
    mu          REAL,                -- 推定ドリフト(年率)
    sigma       REAL,                -- 推定ボラ(年率)
    p10         REAL,
    p25         REAL,
    p50         REAL,
    p75         REAL,
    p90         REAL,
    expected    REAL,                -- 期待値
    prob_loss   REAL                 -- 元本割れ確率
);
"""


def init_db() -> None:
    """データディレクトリとスキーマを初期化する(冪等)。"""
    config.ensure_data_dir()
    with connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """SQLite 接続のコンテキストマネージャ。コミット/クローズを面倒見る。"""
    config.ensure_data_dir()
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
