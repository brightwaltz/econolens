"""価格取得層: yfinance での日足取得 + SQLite キャッシュ(差分取得)。

yfinance は Yahoo Finance の非公式 API。本層に全ての外部 I/O を隔離し、
上位の定量モデルはネットワークに依存せずテストできるようにする。
"""

from __future__ import annotations

import datetime as dt
import time

import pandas as pd

from .. import config, db


class PriceFetchError(RuntimeError):
    """価格取得に失敗(通信エラー / 不正ティッカー / データ欠損)。"""


def _cached_range(conn, code: str) -> tuple[str | None, str | None]:
    """キャッシュ済みの最古・最新日付を返す。"""
    row = conn.execute(
        "SELECT MIN(date) AS mn, MAX(date) AS mx FROM prices WHERE code = ?",
        (code,),
    ).fetchone()
    return (row["mn"], row["mx"])


def _download(code: str, start: dt.date, end: dt.date) -> pd.DataFrame:
    """yfinance から日足を取得。リトライ 1 回。空なら PriceFetchError。"""
    import yfinance as yf

    last_err: Exception | None = None
    for attempt in range(2):
        try:
            df = yf.download(
                code,
                start=start.isoformat(),
                end=(end + dt.timedelta(days=1)).isoformat(),
                interval="1d",
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if df is not None and not df.empty:
                # 単一ティッカーでも (Price, Ticker) の MultiIndex 列に
                # なることがあるため、先頭レベル(Open/High/.../Volume)へ平坦化。
                if isinstance(df.columns, pd.MultiIndex):
                    df = df.copy()
                    df.columns = df.columns.get_level_values(0)
                return df
        except Exception as e:  # noqa: BLE001 — yfinance は多様な例外を投げる
            last_err = e
        time.sleep(0.8)
    if last_err is not None:
        raise PriceFetchError(
            f"'{code}' の価格取得で通信エラーが発生しました: {last_err}"
        ) from last_err
    raise PriceFetchError(
        f"'{code}' のデータが空でした。ティッカーが正しいか、"
        f"(中国A株 .SS/.SZ などで)データが提供されているか確認してください。"
    )


def _store(conn, code: str, df: pd.DataFrame) -> None:
    """取得した DataFrame を prices テーブルへ upsert。"""
    rows: list[tuple] = []
    for idx, r in df.iterrows():
        date = (idx.date() if hasattr(idx, "date") else idx).isoformat()
        rows.append(
            (
                code,
                date,
                _cell(r, "Open"),
                _cell(r, "High"),
                _cell(r, "Low"),
                _cell(r, "Close"),
                _cell(r, "Volume"),
            )
        )
    conn.executemany(
        """
        INSERT INTO prices (code, date, open, high, low, close, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code, date) DO UPDATE SET
            open=excluded.open, high=excluded.high, low=excluded.low,
            close=excluded.close, volume=excluded.volume
        """,
        rows,
    )


def _cell(row: pd.Series, field: str) -> float | None:
    """平坦化済みの行(Open/High/Low/Close/Volume)から値を取り出す。"""
    if field not in row.index:
        return None
    val = row[field]
    # 同名列が複数あると Series になり得るため先頭を採用。
    if isinstance(val, pd.Series):
        val = val.iloc[0] if not val.empty else None
    if val is None or pd.isna(val):
        return None
    return float(val)


def get_prices(code: str, lookback_years: int | None = None) -> pd.Series:
    """指定銘柄の調整後終値を Series(index=日付, 昇順)で返す。

    キャッシュに最新分が無ければ差分取得して補完する。
    """
    lookback_years = lookback_years or config.PRICE_LOOKBACK_YEARS
    today = dt.date.today()
    desired_start = today - dt.timedelta(days=int(lookback_years * 365.25) + 5)

    db.init_db()
    with db.connect() as conn:
        cached_min, cached_max = _cached_range(conn, code)

        if cached_max is None:
            _store(conn, code, _download(code, desired_start, today))
        else:
            last = dt.date.fromisoformat(cached_max)
            # 最新が 3 営業日以上古ければ差分取得。
            if (today - last).days > 3:
                _store(conn, code, _download(code, last, today))
            # 必要な開始日までキャッシュが遡れていなければ前方も補完。
            cmin = dt.date.fromisoformat(cached_min) if cached_min else today
            if cmin > desired_start + dt.timedelta(days=7):
                _store(conn, code, _download(code, desired_start, cmin))

        rows = conn.execute(
            "SELECT date, close FROM prices "
            "WHERE code = ? AND date >= ? AND close IS NOT NULL ORDER BY date",
            (code, desired_start.isoformat()),
        ).fetchall()

    if not rows:
        raise PriceFetchError(f"'{code}' の終値データを取得できませんでした。")

    s = pd.Series(
        data=[r["close"] for r in rows],
        index=pd.to_datetime([r["date"] for r in rows]),
        name=code,
        dtype="float64",
    )
    return s
