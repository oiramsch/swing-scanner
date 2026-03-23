"""
Renders dark-theme candlestick charts for scanner candidates and trade replay.
Saves to /tmp/charts/ and returns the path.
"""
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import matplotlib
import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd

matplotlib.use("Agg")  # headless backend

logger = logging.getLogger(__name__)

CHARTS_DIR = Path("/tmp/charts")


def _prepare_df(df: pd.DataFrame, tail: int = 60) -> pd.DataFrame:
    """Ensure DatetimeIndex and trim to last N rows."""
    plot_df = df.copy()
    plot_df.index = pd.to_datetime(plot_df.index)
    return plot_df.tail(tail)


def render_chart(ticker: str, df: pd.DataFrame) -> str:
    """
    Render scanner chart: candlestick + SMA20 (blue) + SMA50 (orange) +
    EMA9 (purple dashed) + volume panel. 800x600px.

    Returns absolute path to saved PNG.
    """
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    output_path = CHARTS_DIR / f"{ticker}_{today}.png"

    plot_df = _prepare_df(df, tail=60)

    addplots = []
    if "SMA_20" in plot_df.columns and plot_df["SMA_20"].notna().any():
        addplots.append(mpf.make_addplot(plot_df["SMA_20"], color="#3b9eff", width=1.5, label="SMA20"))
    if "SMA_50" in plot_df.columns and plot_df["SMA_50"].notna().any():
        addplots.append(mpf.make_addplot(plot_df["SMA_50"], color="#ff9933", width=1.5, label="SMA50"))
    if "EMA_9" in plot_df.columns and plot_df["EMA_9"].notna().any():
        addplots.append(mpf.make_addplot(plot_df["EMA_9"], color="#cc77ff", width=1.0, linestyle="dashed", label="EMA9"))

    try:
        fig, axes = mpf.plot(
            plot_df,
            type="candle",
            style="nightclouds",
            volume=True,
            addplot=addplots if addplots else None,
            figsize=(10, 7.5),
            title=f"\n{ticker}",
            tight_layout=True,
            returnfig=True,
        )
        fig.savefig(str(output_path), dpi=80, bbox_inches="tight")
        plt.close(fig)
    except Exception as exc:
        logger.error("Chart render failed for %s: %s", ticker, exc)
        raise

    logger.info("Chart saved: %s", output_path)
    return str(output_path)


def render_replay_chart(
    ticker: str,
    df: pd.DataFrame,
    entry_date: date,
    entry_price: float,
    stop_loss: float,
    exit_date: Optional[date] = None,
    exit_price: Optional[float] = None,
) -> str:
    """
    Render a trade replay chart with entry/exit markers and stop-loss line.
    Shows 20 days before entry through exit (or today).

    Returns absolute path to saved PNG.
    """
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{ticker}_replay_{entry_date.isoformat()}.png"
    output_path = CHARTS_DIR / fname

    plot_df = df.copy()
    plot_df.index = pd.to_datetime(plot_df.index)

    # Window: 20 days before entry to exit/today
    entry_dt = pd.Timestamp(entry_date)
    end_dt = pd.Timestamp(exit_date) if exit_date else pd.Timestamp(date.today())
    start_dt = entry_dt - timedelta(days=20)
    plot_df = plot_df[(plot_df.index >= start_dt) & (plot_df.index <= end_dt)]

    if len(plot_df) < 2:
        # Fall back to tail(40)
        plot_df = _prepare_df(df, tail=40)

    addplots = []

    # Entry marker (green triangle up)
    if entry_dt in plot_df.index:
        entry_series = pd.Series(index=plot_df.index, dtype=float)
        entry_series[entry_dt] = entry_price * 0.985
        addplots.append(mpf.make_addplot(
            entry_series, type="scatter", markersize=120,
            marker="^", color="lime", panel=0,
        ))

    # Exit marker
    if exit_date and exit_price:
        exit_dt = pd.Timestamp(exit_date)
        if exit_dt in plot_df.index:
            exit_series = pd.Series(index=plot_df.index, dtype=float)
            color = "lime" if exit_price >= entry_price else "red"
            exit_series[exit_dt] = exit_price * 1.015
            addplots.append(mpf.make_addplot(
                exit_series, type="scatter", markersize=120,
                marker="v", color=color, panel=0,
            ))

    # Stop-loss horizontal line
    stop_series = pd.Series([stop_loss] * len(plot_df), index=plot_df.index)
    addplots.append(mpf.make_addplot(
        stop_series, color="red", width=1.0, linestyle="dashed",
    ))

    try:
        fig, axes = mpf.plot(
            plot_df,
            type="candle",
            style="nightclouds",
            volume=True,
            addplot=addplots if addplots else None,
            figsize=(10, 7.5),
            title=f"\n{ticker} — Trade Replay",
            tight_layout=True,
            returnfig=True,
        )
        fig.savefig(str(output_path), dpi=80, bbox_inches="tight")
        plt.close(fig)
    except Exception as exc:
        logger.error("Replay chart render failed for %s: %s", ticker, exc)
        raise

    logger.info("Replay chart saved: %s", output_path)
    return str(output_path)
