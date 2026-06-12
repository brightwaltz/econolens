"""端末向けの rich 整形出力。"""

from __future__ import annotations

from rich.console import Console
from rich.table import Table

from ..data.instruments import Instrument
from ..quant.montecarlo import ForecastResult

console = Console()

# 通貨ごとの表示記号。
_CCY_SYMBOL = {"JPY": "¥", "USD": "$", "HKD": "HK$", "CNY": "¥"}


def _fmt_price(value: float, currency: str | None) -> str:
    sym = _CCY_SYMBOL.get(currency or "", "")
    if currency == "JPY":
        return f"{sym}{value:,.0f}"
    return f"{sym}{value:,.2f}"


def _fmt_pct(value: float) -> str:
    return f"{value * 100:+.1f}%"


def render_instruments(items: list[Instrument]) -> None:
    """銘柄マスタを表で出力。"""
    table = Table(title=f"銘柄マスタ ({len(items)} 件)", header_style="bold cyan")
    table.add_column("コード", style="bold")
    table.add_column("市場")
    table.add_column("名称")
    table.add_column("セクター")
    table.add_column("地域タグ", style="dim")
    table.add_column("テーマタグ", style="dim")
    for it in items:
        table.add_row(
            it.code,
            it.market,
            it.name,
            it.sector or "-",
            ", ".join(it.region_list) or "-",
            ", ".join(it.theme_list) or "-",
        )
    console.print(table)


def render_forecast(
    instrument: Instrument | None,
    code: str,
    horizon: str,
    result: ForecastResult,
    currency: str | None,
) -> None:
    """予測結果を表で出力。"""
    name = instrument.name if instrument else code
    title = f"{name} ({code}) — {horizon} 後の価格予測"
    table = Table(title=title, header_style="bold cyan")
    table.add_column("指標", style="bold")
    table.add_column("値", justify="right")
    table.add_column("現在値比", justify="right")

    spot = result.spot

    def row(label: str, price: float, style: str = "") -> None:
        ret = price / spot - 1.0
        ret_style = "green" if ret >= 0 else "red"
        table.add_row(
            label,
            f"[{style}]{_fmt_price(price, currency)}[/{style}]" if style else _fmt_price(price, currency),
            f"[{ret_style}]{_fmt_pct(ret)}[/{ret_style}]",
        )

    table.add_row("現在値", _fmt_price(spot, currency), "—")
    table.add_section()
    row("P10(悲観)", result.p10)
    row("P25", result.p25)
    row("P50(中央値)", result.p50, style="bold")
    row("P75", result.p75)
    row("P90(楽観)", result.p90)
    table.add_section()
    row("期待値(平均)", result.expected)
    table.add_row(
        "元本割れ確率",
        f"{result.prob_loss * 100:.1f}%",
        "—",
    )
    console.print(table)

    # 推定パラメータの注記。
    console.print(
        f"[dim]推定: ドリフト μ={result.mu * 100:+.1f}%/年, "
        f"ボラ σ={result.sigma * 100:.1f}%/年, "
        f"{result.paths:,} パスのモンテカルロ。[/dim]"
    )


def render_disclaimer(text: str) -> None:
    console.print(f"\n[yellow dim]{text}[/yellow dim]")


def info(message: str) -> None:
    console.print(f"[dim]{message}[/dim]")


def error(message: str) -> None:
    console.print(f"[bold red]エラー:[/bold red] {message}")
