"""GBM(幾何ブラウン運動)モンテカルロ・シミュレーション。

S_t = S_0 · exp((μ − σ²/2)·t + σ·√t·Z),  Z ~ N(0, 1)

日次パスを生成し、ホライズン終端の価格分布(分位点・期待値・元本割れ確率)と、
ファンチャート用の日次分位点バンドを返す。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from .. import config

# ホライズン文字列 → 営業日数。
_HORIZON_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([dwmy])\s*$", re.IGNORECASE)
_UNIT_TRADING_DAYS = {
    "d": 1,
    "w": 5,
    "m": config.TRADING_DAYS / 12,
    "y": config.TRADING_DAYS,
}


def parse_horizon(horizon: str) -> int:
    """'1y' '6m' '3w' '10d' などを営業日数(int, 最低 1)へ変換。"""
    m = _HORIZON_RE.match(horizon)
    if not m:
        raise ValueError(
            f"ホライズン '{horizon}' を解釈できません。例: 1m, 6m, 1y, 3y, 10d"
        )
    qty = float(m.group(1))
    unit = m.group(2).lower()
    return max(1, round(qty * _UNIT_TRADING_DAYS[unit]))


@dataclass
class ForecastResult:
    spot: float
    horizon_days: int
    mu: float
    sigma: float
    paths: int
    # 終端分位点。
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    expected: float
    prob_loss: float  # P(終端価格 < spot)
    # ファンチャート用の日次分位点バンド(0..horizon_days を含む配列)。
    band_days: np.ndarray = field(repr=False)
    band_p10: np.ndarray = field(repr=False)
    band_p50: np.ndarray = field(repr=False)
    band_p90: np.ndarray = field(repr=False)

    @property
    def expected_return(self) -> float:
        return self.expected / self.spot - 1.0


def simulate(
    spot: float,
    mu: float,
    sigma: float,
    horizon_days: int,
    paths: int = config.DEFAULT_PATHS,
    seed: int | None = None,
) -> ForecastResult:
    """GBM パスを生成して予測結果を返す。"""
    if spot <= 0:
        raise ValueError("現在値 spot は正である必要があります。")
    rng = np.random.default_rng(seed)
    dt = 1.0 / config.TRADING_DAYS
    drift = (mu - 0.5 * sigma**2) * dt

    # 日次対数リターンを生成して累積 → パス行列 (paths, horizon_days+1)。
    shocks = sigma * np.sqrt(dt) * rng.standard_normal((paths, horizon_days))
    log_steps = drift + shocks
    cum = np.cumsum(log_steps, axis=1)
    cum = np.concatenate([np.zeros((paths, 1)), cum], axis=1)
    price_paths = spot * np.exp(cum)

    terminal = price_paths[:, -1]
    p10, p25, p50, p75, p90 = np.percentile(terminal, [10, 25, 50, 75, 90])

    band_p10 = np.percentile(price_paths, 10, axis=0)
    band_p50 = np.percentile(price_paths, 50, axis=0)
    band_p90 = np.percentile(price_paths, 90, axis=0)

    return ForecastResult(
        spot=float(spot),
        horizon_days=int(horizon_days),
        mu=float(mu),
        sigma=float(sigma),
        paths=int(paths),
        p10=float(p10),
        p25=float(p25),
        p50=float(p50),
        p75=float(p75),
        p90=float(p90),
        expected=float(np.mean(terminal)),
        prob_loss=float(np.mean(terminal < spot)),
        band_days=np.arange(horizon_days + 1),
        band_p10=band_p10,
        band_p50=band_p50,
        band_p90=band_p90,
    )
