"""
Standard Claude Vision analysis for scanner candidates.
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

SYSTEM_PROMPT = """You are an expert swing trader with 20 years of experience. Analyze the provided daily candlestick chart and identify trading setups. The chart shows: candlesticks, SMA20 (blue), SMA50 (orange), EMA9 (purple dashed), and volume panel.

Identify ONE primary setup:
1. Breakout — Price breaking above clear resistance with volume
2. Pullback — Clean pullback to SMA20 or SMA50 in uptrend
3. Pattern — Cup & Handle, Bull Flag, Ascending Triangle, Pennant
4. Momentum — Strong relative strength, consistent higher highs

Also detect REVERSAL patterns: Head & Shoulders, Double Top, Bearish Engulfing, Rising Wedge — mark is_reversal as true.

If news context is provided and a corporate action or earnings event explains the price movement, set "technical_setup_valid" to false.

Respond ONLY with valid JSON:
{
  "setup_type": "breakout|pullback|pattern|momentum|none",
  "pattern_name": "specific name or null",
  "is_reversal": false,
  "reversal_type": "name or null",
  "confidence": 7,
  "entry_zone": "145.50-146.00",
  "stop_loss": "142.00",
  "target": "152.00",
  "risk_reward": "1:2.5",
  "reasoning": "Max 2 sentences in English",
  "technical_setup_valid": true,
  "invalidation_reason": null
}"""


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


def analyze_chart(
    chart_path: str,
    ticker: str,
    indicators: dict,
    news_check: Optional[dict] = None,
) -> Optional[dict]:
    """
    Send chart PNG to Claude Vision and return analysis dict,
    or None if confidence < MIN_CONFIDENCE or parsing fails.
    news_check: optional dict from run_full_news_check()
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
        f"ATR(14): {indicators.get('atr14', 'N/A')}\n"
        f"Volume: {indicators.get('volume', 'N/A'):,}\n\n"
    )

    # Append news context if available
    if news_check:
        headlines = []
        try:
            import json as _json
            raw_hl = news_check.get("news_headlines")
            headlines = _json.loads(raw_hl) if raw_hl else []
        except Exception:
            pass

        gap_pct = news_check.get("gap_pct", 0)
        corp_desc = news_check.get("corporate_action_description") or "none"
        has_recent = news_check.get("has_earnings_recent", False)
        has_upcoming = news_check.get("has_earnings_upcoming", False)

        if headlines or gap_pct or has_recent or has_upcoming or news_check.get("has_corporate_action"):
            user_text += (
                "Additional context:\n"
                f"- Recent news: {'; '.join(headlines[:3]) if headlines else 'none'}\n"
                f"- Corporate action detected: {corp_desc}\n"
                f"- Overnight gap: {gap_pct:+.1f}%\n"
                f"- Earnings recently: {has_recent}\n"
                f"- Earnings upcoming: {has_upcoming}\n\n"
                "If a corporate action or earnings event explains the price movement, "
                "set technical_setup_valid to false and explain in invalidation_reason.\n\n"
            )

    user_text += "Analyze the chart and respond with JSON only."

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=settings.claude_max_tokens,
            temperature=0,
            system=SYSTEM_PROMPT,
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
        logger.error("Claude API error for %s: %s", ticker, exc)
        return None

    raw_text = response.content[0].text if response.content else ""
    analysis = _extract_json(raw_text)
    if not analysis:
        logger.warning("Failed to parse JSON from Claude for %s", ticker)
        return None

    confidence = analysis.get("confidence", 0)
    try:
        confidence = int(confidence)
    except (ValueError, TypeError):
        confidence = 0
    analysis["confidence"] = confidence

    if confidence < settings.min_confidence:
        logger.info("Filtered %s: confidence %d < %d", ticker, confidence, settings.min_confidence)
        return None

    analysis.setdefault("setup_type", "none")
    analysis.setdefault("is_reversal", False)
    analysis.setdefault("risk_reward", None)
    analysis.setdefault("technical_setup_valid", True)
    analysis.setdefault("invalidation_reason", None)

    # Override technical_setup_valid if news invalidates it
    if news_check and news_check.get("invalidates_technicals"):
        analysis["technical_setup_valid"] = False
        if not analysis.get("invalidation_reason"):
            analysis["invalidation_reason"] = news_check.get("corporate_action_description")

    # CRV calculation
    from backend.news_checker import calculate_crv, _parse_entry_mid, _parse_price
    entry_mid = _parse_entry_mid(analysis.get("entry_zone"))
    stop = _parse_price(analysis.get("stop_loss"))
    target = _parse_price(analysis.get("target"))
    if entry_mid and stop and target:
        crv_result = calculate_crv(entry_mid, stop, target)
        analysis["crv_calculated"] = crv_result["crv"]
        analysis["crv_valid"] = crv_result["crv_valid"]
        if crv_result.get("warning") and not analysis.get("crv_warning"):
            analysis["crv_warning"] = crv_result["warning"]
    else:
        analysis["crv_calculated"] = None
        analysis["crv_valid"] = True  # Unknown = don't flag

    logger.info(
        "Analysis %s: %s confidence=%d crv=%.1f valid=%s",
        ticker, analysis.get("setup_type"), confidence,
        analysis.get("crv_calculated") or 0, analysis.get("crv_valid"),
    )
    return analysis
