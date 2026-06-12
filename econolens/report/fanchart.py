"""plotly によるファンチャート(分位点バンド)HTML 出力。"""

from __future__ import annotations

from pathlib import Path

from ..quant.montecarlo import ForecastResult


def write_fanchart(
    path: str | Path,
    code: str,
    name: str,
    horizon: str,
    result: ForecastResult,
) -> Path:
    """P10–P90 バンドと P50 中央値線のファンチャートを HTML に書き出す。"""
    import plotly.graph_objects as go

    x = result.band_days.tolist()
    fig = go.Figure()

    # P90 上限(塗りつぶしの基準)。
    fig.add_trace(
        go.Scatter(
            x=x, y=result.band_p90.tolist(),
            mode="lines", line=dict(width=0),
            name="P90(楽観)", hoverinfo="skip", showlegend=False,
        )
    )
    # P10 下限 → P90 までを塗りつぶし。
    fig.add_trace(
        go.Scatter(
            x=x, y=result.band_p10.tolist(),
            mode="lines", line=dict(width=0),
            fill="tonexty", fillcolor="rgba(31,119,180,0.20)",
            name="P10–P90 レンジ",
        )
    )
    # P50 中央値。
    fig.add_trace(
        go.Scatter(
            x=x, y=result.band_p50.tolist(),
            mode="lines", line=dict(color="rgb(31,119,180)", width=2),
            name="P50(中央値)",
        )
    )
    # 現在値の水平線。
    fig.add_hline(
        y=result.spot, line_dash="dash", line_color="gray",
        annotation_text="現在値", annotation_position="bottom right",
    )

    fig.update_layout(
        title=f"{name} ({code}) — {horizon} 後までの価格分布(GBM モンテカルロ {result.paths:,} パス)",
        xaxis_title="営業日(今日 = 0)",
        yaxis_title="価格",
        template="plotly_white",
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )

    out = Path(path)
    fig.write_html(str(out), include_plotlyjs="cdn")
    return out
