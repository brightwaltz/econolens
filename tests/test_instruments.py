"""銘柄マスタのテスト(一時 DB を使い、同梱 CSV を取り込む)。"""

from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def fresh_env(tmp_path, monkeypatch):
    """ECONOLENS_HOME を一時ディレクトリに向け、関連モジュールを再ロード。"""
    monkeypatch.setenv("ECONOLENS_HOME", str(tmp_path))
    import econolens.config as config

    importlib.reload(config)
    import econolens.db as db

    importlib.reload(db)
    import econolens.data.instruments as instruments

    importlib.reload(instruments)
    return instruments


def test_seed_and_count(fresh_env):
    instruments = fresh_env
    n = instruments.seed_from_csv()
    assert n >= 50  # 約 60 銘柄
    all_items = instruments.list_instruments()
    assert len(all_items) == n


def test_autoseed_on_first_query(fresh_env):
    # シード前でも list_instruments が自動シードする。
    instruments = fresh_env
    items = instruments.list_instruments()
    assert len(items) >= 50


def test_filter_by_market(fresh_env):
    instruments = fresh_env
    jp = instruments.list_instruments(market="jp")
    assert jp and all(i.market == "jp" for i in jp)
    us = instruments.list_instruments(market="us")
    assert us and all(i.market == "us" for i in us)


def test_filter_by_theme_semiconductor(fresh_env):
    instruments = fresh_env
    semi = instruments.list_instruments(theme="半導体")
    codes = {i.code for i in semi}
    # TSMC 熊本関連の主要銘柄が含まれる。
    assert {"1959.T", "6258.T", "8035.T"} <= codes


def test_filter_by_region_kumamoto(fresh_env):
    instruments = fresh_env
    kuma = instruments.list_instruments(region="熊本")
    assert kuma and all("熊本" in i.region_list for i in kuma)


def test_get_instrument_roundtrip(fresh_env):
    instruments = fresh_env
    it = instruments.get_instrument("7203.T")
    assert it is not None
    assert it.name == "トヨタ自動車"
    assert it.currency == "JPY"
    assert instruments.get_instrument("DOES.NOT.EXIST") is None
