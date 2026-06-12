"""stats モジュールのテスト(ネットワーク非依存・合成系列)。"""

from __future__ import annotations

import numpy as np
import pandas as pd

from econolens.config import TRADING_DAYS
from econolens.quant import stats


def _series_from_returns(daily_returns: np.ndarray, start: float = 100.0) -> pd.Series:
    prices = start * np.exp(np.cumsum(np.concatenate([[0.0], daily_returns])))
    idx = pd.date_range("2020-01-01", periods=len(prices), freq="B")
    return pd.Series(prices, index=idx)


def test_log_returns_length_and_values():
    s = pd.Series([100.0, 110.0, 99.0])
    r = stats.log_returns(s)
    assert r.size == 2
    np.testing.assert_allclose(r[0], np.log(110 / 100), rtol=1e-12)


def test_log_returns_handles_short_series():
    assert stats.log_returns(pd.Series([100.0])).size == 0
    assert stats.log_returns(pd.Series([], dtype="float64")).size == 0


def test_ewma_vol_recovers_known_sigma():
    # 日次ボラ 1% の正規ノイズ → 年率 ~ 0.01*sqrt(252)。
    rng = np.random.default_rng(0)
    daily = rng.normal(0.0, 0.01, size=4000)
    ann = stats.ewma_vol(daily)
    expected = 0.01 * np.sqrt(TRADING_DAYS)
    assert abs(ann - expected) < 0.03


def test_estimate_drift_is_shrunk_and_capped():
    # 強い上昇トレンド(日次 +0.5%)でも mu_cap=0.40 を超えない。
    daily = np.full(800, 0.005)
    s = _series_from_returns(daily)
    dv = stats.estimate(s)
    assert dv.mu <= 0.40 + 1e-9
    assert dv.n_obs == 800


def test_estimate_empty_series_defaults():
    dv = stats.estimate(pd.Series([100.0]))
    assert dv.sigma == 0.0
    assert dv.n_obs == 0
