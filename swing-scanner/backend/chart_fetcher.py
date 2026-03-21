"""
Renders a dark-theme candlestick chart (512×512px) for a given OHLCV DataFrame.
Saves to /tmp/charts/{ticker}.png and returns the path.
"""
import logging
import os
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd

matplotlib.use("Agg")  # headless backend

logger = logging.getLogger(__name__)

CHARTS_DIR = Path("/tmp/charts")


def render_chart(ticker: str, df: pd.DataFrame) -> str:
    """
    Render a candlestick chart with SMA20, SMA50, and volume panel.

    Args:
        ticker: Stock ticker symbol (used for filename)
        df: DataFrame with columns [Open, High, Low, Close, Volume]
            and a DatetimeIndex or date index. Must already contain
            SMA_20 and SMA_50 columns from pandas-ta.

    Returns:
        Absolute path to the saved PNG file.
    """
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = CHARTS_DIR / f"{ticker}.png"

    # mplfinance requires a DatetimeIndex
    plot_df = df.copy()
    plot_df.index = pd.to_datetime(plot_df.index)

    # Keep only last 60 rows for clarity
    plot_df = plot_df.tail(60)

    # Build addplots for SMAs if available
    addplots = []
    if "SMA_20" in plot_df.columns and plot_df["SMA_20"].notna().any():
        addplots.append(
            mpf.make_addplot(
                plot_df["SMA_20"],
                color="#3b9eff",
                width=1.5,
                label="SMA20",
            )
        )
    if "SMA_50" in plot_df.columns and plot_df["SMA_50"].notna().any():
        addplots.append(
            mpf.make_addplot(
                plot_df["SMA_50"],
                color="#ff9933",
                width=1.5,
                label="SMA50",
            )
        )

    # 512×512px: figsize=(6.4, 6.4) @ 80dpi ≈ 512px
    fig_kwargs = dict(
        type="candle",
        style="nightclouds",
        volume=True,
        addplot=addplots if addplots else None,
        figsize=(6.4, 6.4),
        figscale=1.0,
        title=f"\n{ticker}",
        tight_layout=True,
        returnfig=True,
    )

    try:
        fig, axes = mpf.plot(plot_df, **fig_kwargs)
        fig.savefig(str(output_path), dpi=80, bbox_inches="tight")
        plt.close(fig)
    except Exception as exc:
        logger.error("Chart render failed for %s: %s", ticker, exc)
        raise

    logger.info("Chart saved: %s", output_path)
    return str(output_path)
