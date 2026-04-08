"""
Setup Classifier — Stage 2 of the two-stage analysis pipeline.

Deterministic, rule-based setup classification.
Same inputs → always same outputs. No LLM, no randomness.

Design principles:
- Uses EXACT indicator values (close, SMA20, SMA50, ATR) for price calculations
- Uses Vision-extracted facts ONLY for what Vision uniquely sees:
    trend structure (HH/HL/LH/LL), candle patterns, support/resistance, chart patterns
- Rules mirror the screener's StrategyModule parameters — consistent filtering
- Confidence = vision clarity + classifier adjustment + signal convergence bonus
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Candle type classifications ───────────────────────────────────────────────
_REVERSAL_CANDLES = {"hammer", "bullish_engulfing", "doji"}
_BEARISH_CANDLES  = {"shooting_star", "bearish_engulfing"}
_BULLISH_PATTERNS = {"bull_flag", "cup_handle", "ascending_triangle", "double_bottom"}
_BEARISH_PATTERNS = {"bear_flag", "head_shoulders", "descending_triangle", "double_top"}


def _count_signals(conditions: list) -> int:
    """Count how many boolean conditions are True."""
    return sum(1 for c in conditions if c)


def _long_stop(close: float, atr: float, support: Optional[float]) -> str:
    """
    Conservative long stop: lower of (support × 0.98) and (close − 2×ATR).
    Hard floor at 15% below close to avoid absurd stops on volatile charts.
    """
    atr_stop = close - 2 * atr
    if support and support > 0:
        level_stop = support * 0.98
        stop = min(level_stop, atr_stop)
    else:
        stop = atr_stop
    return f"{max(stop, close * 0.85):.2f}"


def _long_target(close: float, atr: float, resistance: Optional[float]) -> str:
    """3×ATR target or nearest resistance, whichever is higher."""
    atr_target = close + 3 * atr
    if resistance and resistance > close:
        return f"{max(resistance, atr_target):.2f}"
    return f"{atr_target:.2f}"


def _short_stop(close: float, atr: float, resistance: Optional[float]) -> str:
    """Conservative short stop: higher of (resistance × 1.02) and (close + 2×ATR)."""
    atr_stop = close + 2 * atr
    if resistance and resistance > close:
        level_stop = resistance * 1.02
        stop = max(level_stop, atr_stop)
    else:
        stop = atr_stop
    return f"{min(stop, close * 1.15):.2f}"


def _short_target(close: float, atr: float, support: Optional[float]) -> str:
    """3×ATR target or nearest support, whichever is lower."""
    atr_target = close - 3 * atr
    if support and support < close:
        return f"{min(support, atr_target):.2f}"
    return f"{atr_target:.2f}"


def _validate_geometry(result: dict) -> dict:
    """
    Verify stop/entry/target are geometrically valid for the given direction.
    Clears direction + prices if invalid, appends note to reasoning.
    """
    if not (result.get("direction") and result.get("entry_zone")
            and result.get("stop_loss") and result.get("target")):
        return result
    try:
        entry = float(result["entry_zone"].split("-")[0])
        stop  = float(result["stop_loss"])
        tgt   = float(result["target"])

        if result["direction"] == "long":
            if stop >= entry or tgt <= entry:
                result.update({"direction": None, "setup_type": None,
                                "entry_zone": None, "stop_loss": None, "target": None})
                result["reasoning"] += " [INVALID geometry: long requires stop<entry<target]"
        elif result["direction"] == "short":
            if stop <= entry or tgt >= entry:
                result.update({"direction": None, "setup_type": None,
                                "entry_zone": None, "stop_loss": None, "target": None})
                result["reasoning"] += " [INVALID geometry: short requires target<entry<stop]"
    except (ValueError, TypeError) as exc:
        logger.warning("Geometry validation error: %s", exc)
        result["direction"] = None
    return result


def classify_setup(
    facts: dict,
    indicators: dict,
    regime: str,
    module: str,
) -> dict:
    """
    Deterministic setup classification.

    Args:
        facts:      Visual facts from fact_extractor (trend, candles, levels)
        indicators: Computed OHLCV indicators (close, sma20, sma50, sma200, rsi14, atr14, rsi2, sma5)
        regime:     "bull" | "bear" | "neutral"
        module:     "Bull Breakout" | "Bear Relative Strength" | "Mean Reversion" | "Connors RSI-2"

    Returns dict with:
        direction, setup_type, entry_zone, stop_loss, target,
        confidence_adjustment, signal_convergence_bonus, reasoning
    """
    result = {
        "direction": None,
        "setup_type": None,
        "entry_zone": None,
        "stop_loss": None,
        "target": None,
        "confidence_adjustment": 0,
        "signal_convergence_bonus": 0,
        "reasoning": "",
    }

    # ── Exact computed indicators ─────────────────────────────────────────────
    close  = indicators["close"]
    sma5   = float(indicators.get("sma5")   or 0.0)
    sma20  = indicators.get("sma20") or 0.0
    sma50  = indicators.get("sma50") or 0.0
    sma200 = indicators.get("sma200") or 0.0
    rsi    = float(indicators.get("rsi14") or 50.0)
    rsi2   = float(indicators.get("rsi2")  or 50.0)
    atr    = float(indicators.get("atr14") or close * 0.02)

    price_above_sma20  = sma20 > 0 and close > sma20
    price_above_sma50  = sma50 > 0 and close > sma50
    price_above_sma200 = sma200 > 0 and close > sma200

    # ── Visual facts from Vision ──────────────────────────────────────────────
    uptrend        = facts.get("trend_higher_highs") and facts.get("trend_higher_lows")
    downtrend      = facts.get("trend_lower_highs") and facts.get("trend_lower_lows")
    support        = facts.get("nearest_support")     # float or None
    resistance     = facts.get("nearest_resistance")  # float or None
    candle         = facts.get("last_candle_type", "normal_red")
    reversal_candle = candle in _REVERSAL_CANDLES
    bearish_candle  = candle in _BEARISH_CANDLES
    vol_surge      = facts.get("volume_last_bar_vs_avg") in ("above_2x", "above_1.5x")
    vol_increasing = facts.get("volume_trend_5d") == "increasing"
    pattern        = facts.get("pattern_detected", "none")
    bullish_pattern = pattern in _BULLISH_PATTERNS
    bearish_pattern = pattern in _BEARISH_PATTERNS

    # ════════════════════════════════════════════════════════════════════════
    # BULL BREAKOUT
    # Screener: price > SMA20, price > SMA50, RSI 45–75, vol × 1.2
    # ════════════════════════════════════════════════════════════════════════
    if module == "Bull Breakout":
        if price_above_sma20 and price_above_sma50 and 45 <= rsi <= 75:
            if vol_surge and resistance:
                # Classic breakout: price above moving averages, volume confirmation, resistance nearby
                result.update({
                    "direction": "long",
                    "setup_type": "breakout",
                    "entry_zone": f"{resistance:.2f}",
                    "stop_loss": f"{sma20:.2f}",
                    "target": _long_target(resistance, atr, None),
                    "reasoning": f"Breakout above resistance {resistance:.2f} with volume, above SMA20/50",
                })
                n = _count_signals([uptrend, vol_increasing, bullish_pattern, rsi > 55])
                result["confidence_adjustment"] = 1 if n >= 3 else 0
                result["signal_convergence_bonus"] = min(2, n // 2)

            elif uptrend and price_above_sma20 and price_above_sma50:
                # Momentum: uptrend confirmed, riding higher highs/lows above SMAs
                result.update({
                    "direction": "long",
                    "setup_type": "momentum",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": f"{sma50:.2f}",
                    "target": _long_target(close, atr, resistance),
                    "reasoning": f"Momentum uptrend above SMA20/50, RSI {rsi:.0f}",
                })
                n = _count_signals([vol_surge, vol_increasing, bullish_pattern, rsi > 60])
                result["signal_convergence_bonus"] = min(1, n // 2)

    # ════════════════════════════════════════════════════════════════════════
    # BEAR RELATIVE STRENGTH
    # Screener: price > SMA200, RSI 35–65, relative strength vs SPY
    # ════════════════════════════════════════════════════════════════════════
    elif module == "Bear Relative Strength":
        if price_above_sma200 and 35 <= rsi <= 65:
            near_sma20 = sma20 > 0 and abs(close - sma20) / sma20 < 0.03  # within 3% of SMA20

            if uptrend and near_sma20:
                # Best setup: uptrend intact, price pulled back to SMA20 → buying the dip
                result.update({
                    "direction": "long",
                    "setup_type": "pullback",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": _long_stop(close, atr, support),
                    "target": _long_target(close, atr, resistance),
                    "reasoning": f"Bear RS: pullback to SMA20 in uptrend, price above SMA200, RSI {rsi:.0f}",
                })
                n = _count_signals([reversal_candle, vol_surge, rsi < 55, price_above_sma50])
                result["confidence_adjustment"] = 1
                result["signal_convergence_bonus"] = min(2, n)

            elif uptrend and price_above_sma50:
                # Momentum: relative strength holding above SMA50 in bear market
                result.update({
                    "direction": "long",
                    "setup_type": "momentum",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": f"{sma50:.2f}",
                    "target": _long_target(close, atr, resistance),
                    "reasoning": f"Bear RS: relative strength above SMA50/200 in bear regime, RSI {rsi:.0f}",
                })
                n = _count_signals([vol_surge, vol_increasing, bullish_pattern, rsi > 50])
                result["signal_convergence_bonus"] = min(1, n // 2)

            elif reversal_candle and not downtrend:
                # Reversal: recovery candle above SMA200, no confirmed downtrend
                result.update({
                    "direction": "long",
                    "setup_type": "reversal",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": _long_stop(close, atr, support),
                    "target": _long_target(close, atr, resistance),
                    "reasoning": f"Bear RS: {candle} at support, relative strength above SMA200",
                })
                n = _count_signals([vol_surge, rsi < 50, price_above_sma50])
                result["signal_convergence_bonus"] = min(1, n)

    # ════════════════════════════════════════════════════════════════════════
    # MEAN REVERSION
    # Screener: price < SMA20, price < SMA50, RSI 20–40, vol × 0.8
    # ════════════════════════════════════════════════════════════════════════
    elif module == "Mean Reversion":
        if not price_above_sma20 and rsi <= 40:
            if reversal_candle:
                # Long bounce: oversold + reversal candle → target is SMA20 (the mean)
                result.update({
                    "direction": "long",
                    "setup_type": "reversal",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": _long_stop(close, atr, support),
                    "target": f"{sma20:.2f}",  # target = mean reversion to SMA20
                    "reasoning": f"Mean reversion: RSI {rsi:.0f} oversold with {candle} → bounce to SMA20",
                })
                n = _count_signals([rsi < 30, vol_surge, price_above_sma200,
                                     support and close <= (support * 1.02 if support else 0)])
                result["confidence_adjustment"] = 1 if rsi < 30 else 0
                result["signal_convergence_bonus"] = min(2, n)

            elif downtrend and bearish_candle:
                # Short continuation: downtrend confirmed, bearish candle, oversold but
                # no reversal — will show as direction_mismatch for long-only brokers
                result.update({
                    "direction": "short",
                    "_classifier_direction": "short",
                    "setup_type": "reversal",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": _short_stop(close, atr, resistance),
                    "target": _short_target(close, atr, support),
                    "reasoning": f"Mean reversion: RSI {rsi:.0f} oversold, downtrend + {candle} → short continuation",
                })
                n = _count_signals([bearish_pattern, not price_above_sma200, rsi > 25])
                result["signal_convergence_bonus"] = min(1, n // 2)

            else:
                # Oversold but no directional signal — watch only, no entry
                result.update({
                    "setup_type": "reversal",
                    "reasoning": f"Mean reversion: RSI {rsi:.0f} oversold but no reversal candle and trend unclear → watchlist only",
                })

    # ════════════════════════════════════════════════════════════════════════
    # CONNORS RSI-2
    # Screener: close > SMA200, close < SMA5, RSI(2) < 10, RSI(14) 2–40, vol × 0.8
    # Source: Larry Connors "Short Term Trading Strategies That Work"
    # ════════════════════════════════════════════════════════════════════════
    elif module == "Connors RSI-2":
        price_below_sma5 = sma5 > 0 and close < sma5

        if price_above_sma200 and price_below_sma5 and rsi2 < 10:
            # Core Connors RSI-2 signal: extreme short-term panic in long-term uptrend
            result.update({
                "direction":  "long",
                "setup_type": "pullback",
                "entry_zone": f"{close:.2f}",
                "stop_loss":  f"{max(close - 2.5 * atr, close * 0.85):.2f}",
                "target":     f"{sma5:.2f}",  # exit: reversion to SMA5
                "reasoning":  (
                    f"Connors RSI-2 ({rsi2:.1f}) < 10 — extreme kurzfristige Panik. "
                    f"Preis über SMA200 ({sma200:.2f}) — langfristiger Trend intakt. "
                    f"Preis unter SMA5 ({sma5:.2f}) — kurzfristiger Rücksetzer bestätigt. "
                    f"Exit wenn Close > SMA5 ({sma5:.2f})."
                ),
            })
            n = _count_signals([reversal_candle, rsi2 < 5, vol_surge, price_above_sma50])
            result["confidence_adjustment"] = +1   # mechanisch, wenig Interpretationsspielraum
            result["signal_convergence_bonus"] = min(2, n)

        elif price_above_sma200 and price_below_sma5 and rsi2 < 25:
            # Softer version: RSI-2 not extreme yet, but setup is forming
            result.update({
                "direction":  "long",
                "setup_type": "pullback",
                "entry_zone": f"{close:.2f}",
                "stop_loss":  f"{max(close - 2.5 * atr, close * 0.85):.2f}",
                "target":     f"{sma5:.2f}",
                "reasoning":  (
                    f"Connors RSI-2 ({rsi2:.1f}) < 25 — kurzfristiger Rücksetzer unter SMA5. "
                    f"Preis über SMA200 — Trend intakt. Warten auf weitere Schwäche (RSI-2 < 10) bevorzugt."
                ),
            })
            result["signal_convergence_bonus"] = min(1, _count_signals([reversal_candle, rsi2 < 15]))
        else:
            result.update({
                "setup_type": "pullback",
                "reasoning":  (
                    f"Connors RSI-2 ({rsi2:.1f}) — Bedingungen nicht erfüllt: "
                    f"SMA200={sma200:.2f}, SMA5={sma5:.2f}, close={close:.2f}. "
                    f"Kein aktionsfähiges Setup."
                ),
            })

    # ════════════════════════════════════════════════════════════════════════
    # BEAR BOUNCE SHORT (Dead Cat Bounce)
    # Short entry when a stock in a confirmed downtrend bounces temporarily.
    # Screener pre-filter: RSI > 55, no SMA constraints (classifier is strict).
    # Signal: RSI > 60 (short-term overbought) + close < SMA50 < SMA200 + bearish reversal
    # ════════════════════════════════════════════════════════════════════════
    elif module == "Bear Bounce Short":
        price_below_sma50  = sma50 > 0 and close < sma50
        price_below_sma200 = sma200 > 0 and close < sma200
        # "Near resistance" = within 2% of SMA50 or SMA200
        near_sma50  = sma50  > 0 and abs(close - sma50)  / sma50  < 0.02
        near_sma200 = sma200 > 0 and abs(close - sma200) / sma200 < 0.02
        near_resistance_level = near_sma50 or near_sma200

        if rsi > 60 and price_below_sma50 and price_below_sma200:
            if bearish_candle or near_resistance_level:
                # Stop ABOVE entry (short geometry); target BELOW entry
                stop_price = close + 1.5 * atr
                tgt_price  = close - 2.5 * atr
                resistance_label = (
                    "SMA50" if near_sma50 else "SMA200" if near_sma200 else ""
                )
                result.update({
                    "direction": "short",
                    "_classifier_direction": "short",
                    "setup_type": "reversal",
                    "entry_zone": f"{close:.2f}",
                    "stop_loss": f"{min(stop_price, close * 1.15):.2f}",
                    "target":    f"{max(tgt_price, close * 0.70):.2f}",
                    "reasoning": (
                        f"Bear Bounce Short: RSI {rsi:.0f} kurzfristig überkauft im Abwärtstrend. "
                        f"Preis ${close:.2f} unter SMA50 ({sma50:.2f}) und SMA200 ({sma200:.2f}). "
                        + (f"Bearish Kerze: {candle}. " if bearish_candle else "")
                        + (f"Nahe Widerstand ({resistance_label}). " if resistance_label else "")
                        + "Short-Entry — Dead Cat Bounce Korrektur erwartet."
                    ),
                })
                n = _count_signals([
                    bearish_candle, bearish_pattern, downtrend,
                    near_resistance_level, rsi > 65,
                ])
                result["confidence_adjustment"]    = 1 if n >= 3 else 0
                result["signal_convergence_bonus"] = min(2, n // 2)
        else:
            result.update({
                "setup_type": "reversal",
                "reasoning": (
                    f"Bear Bounce Short: Bedingungen nicht erfüllt — "
                    f"RSI {rsi:.0f} (>60 nötig), "
                    f"close_below_sma50={price_below_sma50}, "
                    f"close_below_sma200={price_below_sma200}."
                ),
            })

    result = _validate_geometry(result)
    logger.info(
        "Classifier [%s] %s: dir=%s setup=%s adj=%+d conv=%+d",
        module, indicators.get("close", "?"),
        result["direction"], result["setup_type"],
        result["confidence_adjustment"], result["signal_convergence_bonus"],
    )
    return result
