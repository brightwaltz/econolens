"""ヒストリカル統計: ドリフトとボラティリティの推定。

ドリフト μ(年率): 過去 lookback 年の対数リターン平均を年率化。極端な推定は
市場想定リターン(shrink_to)へ縮約してノイズを抑える(簡易ベイズ縮約)。
ボラ σ(年率): EWMA(指数加重移動平均)分散の年率化。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .. import config


@dataclass(frozen=True)
class DriftVol:
    mu: float  # 年率ドリフト(対数リターンベース)
    sigma: float  # 年率ボラティリティ
    n_obs: int  # 使用したリターン観測数


def log_returns(prices: pd.Series) -> np.ndarray:
    """終値 Series から対数リターン配列を返す(NaN/inf を除去)。"""
    p = pd.to_numeric(prices, errors="coerce").dropna()
    if len(p) < 2:
        return np.array([], dtype="float64")
    r = np.diff(np.log(p.to_numpy(dtype="float64")))
    return r[np.isfinite(r)]


def ewma_vol(returns: np.ndarray, lam: float = config.EWMA_LAMBDA) -> float:
    """EWMA による日次ボラを年率化して返す。"""
    if returns.size == 0:
        return 0.0
    weights = (1 - lam) * lam ** np.arange(returns.size)[::-1]
    weights /= weights.sum()
    mean = np.average(returns, weights=weights)
    var = np.average((returns - mean) ** 2, weights=weights)
    daily_sigma = float(np.sqrt(var))
    return daily_sigma * np.sqrt(config.TRADING_DAYS)


def estimate(
    prices: pd.Series,
    shrink_to: float = 0.05,
    shrink_weight: float = 0.3,
    mu_cap: float = 0.40,
) -> DriftVol:
    """価格系列からドリフトとボラを推定する。

    - mu: 日次平均対数リターン × 252。その後 shrink_to(市場想定 ~5%/年)へ
      shrink_weight だけ縮約し、最後に ±mu_cap でクリップして暴走を防ぐ。
    - sigma: EWMA 年率ボラ。
    """
    r = log_returns(prices)
    if r.size == 0:
        return DriftVol(mu=shrink_to, sigma=0.0, n_obs=0)

    raw_mu = float(np.mean(r)) * config.TRADING_DAYS
    shrunk = (1 - shrink_weight) * raw_mu + shrink_weight * shrink_to
    mu = float(np.clip(shrunk, -mu_cap, mu_cap))
    sigma = ewma_vol(r)
    return DriftVol(mu=mu, sigma=sigma, n_obs=int(r.size))
