"""EconoLens CLI(typer)。

Phase 0-1 のサブコマンド:
  - instruments list : 銘柄マスタ一覧
  - forecast         : 個別銘柄の任意期間後の価格分布(GBM モンテカルロ)

将来(Phase 2+): ingest / recommend / simulate / report / backtest を追加。
"""

from __future__ import annotations

import typer

from . import DISCLAIMER
from .data import prices as price_data
from .data.instruments import list_instruments
from .forecast_service import run_forecast
from .report import terminal
from .report.fanchart import write_fanchart

app = typer.Typer(
    help="EconoLens — 実体経済イベント駆動型 株価予測ツール(Phase 0-1)",
    no_args_is_help=True,
    add_completion=False,
)

instruments_app = typer.Typer(help="銘柄マスタの操作", no_args_is_help=True)
app.add_typer(instruments_app, name="instruments")


@instruments_app.command("list")
def instruments_list(
    market: str = typer.Option(
        None, "--market", "-m", help="市場で絞り込み: jp / us / cn / index / etf"
    ),
    theme: str = typer.Option(
        None, "--theme", "-t", help="テーマタグで絞り込み(例: 半導体)"
    ),
    region: str = typer.Option(
        None, "--region", "-r", help="地域タグで絞り込み(例: 熊本)"
    ),
) -> None:
    """銘柄マスタを一覧表示する。"""
    items = list_instruments(market=market, theme=theme, region=region)
    if not items:
        terminal.info("該当する銘柄がありません。")
        raise typer.Exit(0)
    terminal.render_instruments(items)


@app.command()
def forecast(
    code: str = typer.Argument(
        ..., help="ティッカー(例: 7203.T, AAPL, 0700.HK, ^GSPC, ACWI)"
    ),
    horizon: str = typer.Option(
        "1y", "--horizon", "-h", help="予測期間: 1m / 6m / 1y / 3y / 10d など"
    ),
    paths: int = typer.Option(
        None, "--paths", "-p", help="モンテカルロのパス数(既定 10000)"
    ),
    chart: str = typer.Option(
        None, "--chart", "-c", help="ファンチャート HTML の出力先パス"
    ),
    seed: int = typer.Option(None, "--seed", help="乱数シード(再現用)"),
) -> None:
    """指定銘柄の任意期間後の価格分布を予測する。"""
    try:
        bundle = run_forecast(code, horizon=horizon, paths=paths, seed=seed)
    except price_data.PriceFetchError as e:
        terminal.error(str(e))
        raise typer.Exit(1)
    except ValueError as e:
        terminal.error(str(e))
        raise typer.Exit(2)

    terminal.render_forecast(
        instrument=bundle.instrument,
        code=bundle.code,
        horizon=bundle.horizon,
        result=bundle.result,
        currency=bundle.currency,
    )

    if chart:
        name = bundle.instrument.name if bundle.instrument else bundle.code
        out = write_fanchart(
            chart, bundle.code, name, bundle.horizon, bundle.result
        )
        terminal.info(f"ファンチャートを書き出しました: {out}")

    terminal.render_disclaimer(DISCLAIMER)


if __name__ == "__main__":
    app()
