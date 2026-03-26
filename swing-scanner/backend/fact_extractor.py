"""
Fact Extractor — Stage 1 of the two-stage analysis pipeline.

Claude Vision extracts ONLY objective, visual facts from the chart.
No interpretation. No setup recommendation. No direction.

Why this is more deterministic than the old approach:
"Is the last candle a hammer?" has one correct answer.
"Is this a long or short setup?" has multiple defensible answers on ambiguous charts.
"""
import base64
import json
import logging
import re
from pathlib import Path
from typing import Optional

import anthropic

from backend.config import settings

logger = logging.getLogger(__name__)

FACT_PROMPT = """You are a technical chart reader. Your ONLY job is to extract measurable facts from this chart.

DO NOT identify trading setups.
DO NOT recommend buy or sell.
DO NOT determine if this is a long or short opportunity.
ONLY report what you objectively see.

The chart shows daily candlesticks with SMA20 (blue), SMA50 (orange), and volume bars below.

Rate clarity_score as: how clearly can you read the technical structure? (1=very noisy/unclear, 10=crystal clear trend and levels)
This is NOT a rating of setup quality — it's a rating of chart readability.

Respond ONLY with this exact JSON:
{
  "clarity_score": <1-10>,
  "trend_higher_highs": <true if the last 3 visible swing highs are ascending, else false>,
  "trend_higher_lows": <true if the last 3 visible swing lows are ascending, else false>,
  "trend_lower_highs": <true if the last 3 visible swing highs are descending, else false>,
  "trend_lower_lows": <true if the last 3 visible swing lows are descending, else false>,
  "nearest_support": <price of clearest support level below current price, or null if none visible>,
  "nearest_resistance": <price of clearest resistance level above current price, or null if none visible>,
  "pattern_detected": "double_top"|"double_bottom"|"head_shoulders"|"ascending_triangle"|"descending_triangle"|"bull_flag"|"bear_flag"|"cup_handle"|"none",
  "last_candle_type": "bullish_engulfing"|"bearish_engulfing"|"hammer"|"shooting_star"|"doji"|"normal_green"|"normal_red",
  "volume_trend_5d": "increasing"|"stable"|"decreasing",
  "volume_last_bar_vs_avg": "above_2x"|"above_1.5x"|"normal"|"below"
}"""


def _maybe_store_ai_error(exc) -> None:
    """If the exception looks like a credit/auth issue, persist it for the UI warning."""
    msg = str(exc).lower()
    status = getattr(exc, "status_code", None)
    is_credit_auth = (
        status in (401, 402, 403)
        or "credit" in msg
        or "quota" in msg
        or "billing" in msg
        or "authentication" in msg
        or "permission" in msg
    )
    if is_credit_auth:
        try:
            from backend.database import set_ai_error
            set_ai_error(str(exc))
        except Exception:
            pass


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def extract_facts(
    chart_path: str,
    ticker: str,
    indicators: dict,
) -> Optional[dict]:
    """
    Send chart PNG to Claude Vision and extract only objective visual facts.
    Returns a dict of facts, or None on failure.

    Does NOT determine setup direction, entry, stop, or target.
    That is the job of setup_classifier.py.
    """
    chart_file = Path(chart_path)
    if not chart_file.exists():
        logger.error("Chart file not found: %s", chart_path)
        return None

    image_data = base64.standard_b64encode(chart_file.read_bytes()).decode("utf-8")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    user_text = (
        f"Ticker: {ticker}\n"
        f"Close: ${indicators.get('close', 'N/A')} | "
        f"SMA20: {indicators.get('sma20', 'N/A')} | "
        f"SMA50: {indicators.get('sma50', 'N/A')}\n"
        f"RSI(14): {indicators.get('rsi14', 'N/A')} | "
        f"ATR(14): {indicators.get('atr14', 'N/A')}\n\n"
        "Extract chart facts. Respond with JSON only."
    )

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=400,
            temperature=0,
            system=FACT_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": user_text},
                ],
            }],
        )
    except anthropic.APIError as exc:
        logger.error("Fact extraction API error for %s: %s", ticker, exc)
        _maybe_store_ai_error(exc)
        return None

    # Successful call — clear any stored error (e.g., after an outage resolves)
    try:
        from backend.database import clear_ai_error
        clear_ai_error()
    except Exception:
        pass

    raw = response.content[0].text if response.content else ""
    facts = _extract_json(raw)
    if not facts:
        logger.warning("Failed to parse facts JSON for %s", ticker)
        return None

    # Normalize types
    for bool_key in ("trend_higher_highs", "trend_higher_lows", "trend_lower_highs", "trend_lower_lows"):
        facts[bool_key] = bool(facts.get(bool_key, False))

    facts.setdefault("clarity_score", 5)
    facts.setdefault("pattern_detected", "none")
    facts.setdefault("last_candle_type", "normal_red")
    facts.setdefault("volume_trend_5d", "stable")
    facts.setdefault("volume_last_bar_vs_avg", "normal")

    logger.info(
        "Facts %s: clarity=%d trend=(%s%s) candle=%s pattern=%s",
        ticker,
        facts.get("clarity_score", 0),
        "HH" if facts["trend_higher_highs"] else "",
        "HL" if facts["trend_higher_lows"] else "",
        facts.get("last_candle_type"),
        facts.get("pattern_detected"),
    )
    return facts
