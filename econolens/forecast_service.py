"""予測パイプラインのオーケストレーション。

価格取得 → 統計推定 → モンテカルロ → スナップショット保存 をまとめ、
CLI を薄く保つ。Phase 3 以降ではここに LLM インパクトスコアの注入が入る。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from . import config, db
from .data import prices as price_data
from .data.instruments import Instrument, get_instrument
from .quant import stats
from .quant.montecarlo import ForecastResult, parse_horizon, simulate


@dataclass
class ForecastBundle:
    code: str
    instrument: Instrument | None
    currency: str | None
    horizon: str
    result: ForecastResult


def run_forecast(
    code: str,
    horizon: str,
    paths: int | None = None,
    seed: int | None = None,
    save: bool = True,
) -> ForecastBundle:
    """1 銘柄の予測を実行して結果を返す(必要なら履歴保存)。"""
    paths = paths or config.DEFAULT_PATHS
    horizon_days = parse_horizon(horizon)

    instrument = get_instrument(code)
    currency = instrument.currency if instrument else None

    series = price_data.get_prices(code)
    spot = float(series.iloc[-1])
    dv = stats.estimate(series)
    result = simulate(
        spot=spot,
        mu=dv.mu,
        sigma=dv.sigma,
        horizon_days=horizon_days,
        paths=paths,
        seed=seed,
    )

    if save:
        _save_snapshot(code, horizon, result)

    return ForecastBundle(
        code=code,
        instrument=instrument,
        currency=currency,
        horizon=horizon,
        result=result,
    )


def _save_snapshot(code: str, horizon: str, r: ForecastResult) -> None:
    """予測結果を forecasts テーブルへ保存(前向き検証の土台)。"""
    db.init_db()
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO forecasts
                (created_at, code, horizon, spot, mu, sigma,
                 p10, p25, p50, p75, p90, expected, prob_loss)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dt.datetime.now().isoformat(timespec="seconds"),
                code,
                horizon,
                r.spot,
                r.mu,
                r.sigma,
                r.p10,
                r.p25,
                r.p50,
                r.p75,
                r.p90,
                r.expected,
                r.prob_loss,
            ),
        )
