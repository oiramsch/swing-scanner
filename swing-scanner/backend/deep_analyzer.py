"""
Deep AI analysis for top scanner candidates (confidence >= 7).
Provides comprehensive bull/bear case, timing, and sector context.
"""
import base64
import json
import logging
import re
from pathlib import Path
from typing import Optional

import anthropic
import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_TEMPLATE = """You are a senior swing trader and market analyst. Perform a comprehensive analysis of this trading candidate.

You receive:
- Daily candlestick chart (last 60 days)
- Key indicators: RSI, ATR, MACD, Volume ratio
- Market regime: {market_regime}

Provide a detailed analysis in the following JSON format:
{{
  "overall_score": 8,
  "setup_quality": "The setup description...",
  "bull_case": "If trade works, here is why...",
  "bear_case": "Key risks and what would invalidate the setup...",
  "entry_timing": "now|wait_for_pullback|wait_for_confirmation",
  "entry_timing_reason": "...",
  "sector_context": "How sector strength affects this trade...",
  "market_context": "How current market regime affects risk...",
  "position_sizing_note": "Any specific advice on position size...",
  "key_levels": {{
    "strong_support": "140.00",
    "strong_resistance": "155.00",
    "ideal_entry": "145.50"
  }},
  "time_horizon": "3-7 days|1-2 weeks|2-4 weeks",
  "recommendation": "strong_buy|buy|watch|avoid"
}}"""


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


def deep_analyze(
    chart_path: str,
    ticker: str,
    indicators: dict,
    market_regime: str = "neutral",
    sector: Optional[str] = None,
) -> Optional[dict]:
    """
    Perform deep analysis using Claude Vision.
    Returns comprehensive analysis dict or None on failure.
    """
    chart_file = Path(chart_path)
    if not chart_file.exists():
        logger.error("Chart file not found: %s", chart_path)
        return None

    image_data = base64.standard_b64encode(chart_file.read_bytes()).decode("utf-8")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(market_regime=market_regime)

    sector_line = f"Sector: {sector}" if sector else "Sector: Unknown"
    user_text = (
        f"Ticker: {ticker}\n"
        f"{sector_line}\n"
        f"Close: ${indicators.get('close', 'N/A')}\n"
        f"RSI(14): {indicators.get('rsi14', 'N/A')} | "
        f"ATR(14): {indicators.get('atr14', 'N/A')}\n"
        f"SMA20: {indicators.get('sma20', 'N/A')} | "
        f"SMA50: {indicators.get('sma50', 'N/A')}\n"
        f"Volume: {indicators.get('volume', 'N/A'):,} | "
        f"Vol MA20: {indicators.get('vol_ma20', 'N/A'):,.0f}\n\n"
        "Analyze this chart thoroughly and respond with JSON only."
    )

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=settings.claude_deep_max_tokens,
            temperature=0,
            system=system_prompt,
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
        logger.error("Deep analysis Claude API error for %s: %s", ticker, exc)
        return None

    raw_text = response.content[0].text if response.content else ""
    analysis = _extract_json(raw_text)

    if not analysis:
        logger.warning("Failed to parse deep analysis JSON for %s", ticker)
        return None

    logger.info(
        "Deep analysis %s: score=%s recommendation=%s",
        ticker, analysis.get("overall_score"), analysis.get("recommendation"),
    )
    return analysis
