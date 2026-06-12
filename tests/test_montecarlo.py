"""モンテカルロのテスト(統計的性質と理論値近似)。"""

from __future__ import annotations

import numpy as np
import pytest

from econolens.config import TRADING_DAYS
from econolens.quant.montecarlo import parse_horizon, simulate


def test_parse_horizon_units():
    assert parse_horizon("10d") == 10
    assert parse_horizon("1w") == 5
    assert parse_horizon("1y") == TRADING_DAYS
    assert parse_horizon("6m") == round(6 * TRADING_DAYS / 12)
    assert parse_horizon("3y") == 3 * TRADING_DAYS


def test_parse_horizon_invalid():
    with pytest.raises(ValueError):
        parse_horizon("nonsense")
    with pytest.raises(ValueError):
        parse_horizon("1 fortnight")


def test_median_matches_gbm_theory():
    # GBM 終端中央値 ≈ S0 * exp((mu - sigma^2/2) * T)。
    spot, mu, sigma = 100.0, 0.10, 0.20
    horizon_days = TRADING_DAYS
    res = simulate(spot, mu, sigma, horizon_days, paths=60_000, seed=42)
    t = horizon_days / TRADING_DAYS
    theo_median = spot * np.exp((mu - 0.5 * sigma**2) * t)
    assert res.p50 == pytest.approx(theo_median, rel=0.02)


def test_mean_matches_gbm_theory():
    # GBM 終端期待値 ≈ S0 * exp(mu * T)。
    spot, mu, sigma = 100.0, 0.08, 0.25
    res = simulate(spot, mu, sigma, TRADING_DAYS, paths=80_000, seed=7)
    theo_mean = spot * np.exp(mu * 1.0)
    assert res.expected == pytest.approx(theo_mean, rel=0.02)


def test_quantile_ordering_and_bands():
    res = simulate(100.0, 0.05, 0.3, 120, paths=20_000, seed=1)
    assert res.p10 < res.p25 < res.p50 < res.p75 < res.p90
    # バンドは day0 = spot から始まり、長さは horizon_days+1。
    assert res.band_days.size == 121
    assert res.band_p50[0] == pytest.approx(100.0, abs=1e-9)
    assert 0.0 <= res.prob_loss <= 1.0


def test_zero_vol_is_deterministic_drift():
    # σ=0 なら終端は決定的に S0*exp(mu*T)。
    res = simulate(50.0, 0.10, 0.0, TRADING_DAYS, paths=1000, seed=0)
    expected = 50.0 * np.exp(0.10)
    assert res.p50 == pytest.approx(expected, rel=1e-6)
    assert res.prob_loss == 0.0


def test_invalid_spot_raises():
    with pytest.raises(ValueError):
        simulate(0.0, 0.1, 0.2, 10)
