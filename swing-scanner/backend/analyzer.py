"""
Sends a chart PNG to Claude Vision API and returns a structured
swing-trade analysis as a parsed dict.
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

SYSTEM_PROMPT = """You are an experienced swing trader with 20+ years of market experience.
Analyze the provided stock chart and identify potential swing trading setups.

Look for these specific setups:
1. **Breakout** – Price breaking above a key resistance level with volume confirmation
2. **Pullback** – Price pulling back to SMA20 or SMA50 in an uptrend (blue/orange lines)
3. **Pattern** – Classic chart patterns: Cup & Handle, Bull Flag, Ascending Triangle, etc.
4. **Momentum** – Strong relative strength, consecutive up days, high RSI with trend support

Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.

JSON schema:
{
  "setup_type": "breakout|pullback|pattern|momentum|none",
  "pattern_name": "e.g. Bull Flag or null",
  "confidence": 1,
  "entry_zone": "e.g. 145.50-146.00 or null",
  "stop_loss": "e.g. 142.00 or null",
  "target": "e.g. 152.00 or null",
  "reasoning": "brief English explanation, max 2 sentences"
}

confidence: integer 1-10 (1=very weak, 10=textbook perfect setup)"""


def _build_user_message(ticker: str, indicators: dict) -> str:
    return (
        f"Ticker: {ticker}\n"
        f"Current Close: ${indicators.get('close', 'N/A')}\n"
        f"SMA20: {indicators.get('sma20', 'N/A')} | "
        f"SMA50: {indicators.get('sma50', 'N/A')}\n"
        f"RSI(14): {indicators.get('rsi14', 'N/A')} | "
        f"ATR(14): {indicators.get('atr14', 'N/A')}\n"
        f"Volume: {indicators.get('volume', 'N/A'):,}\n\n"
        "Analyze the chart image and identify the best swing trading setup."
    )


def _extract_json(text: str) -> Optional[dict]:
    """Extract and parse a JSON object from the model's response text."""
    # Try direct parse first
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON block via regex
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
) -> Optional[dict]:
    """
    Send chart PNG to Claude Vision and return analysis dict, or None
    if confidence < MIN_CONFIDENCE or parsing fails.

    Args:
        chart_path: Absolute path to the chart PNG.
        ticker: Stock ticker symbol.
        indicators: Dict with keys: close, sma20, sma50, rsi14, atr14, volume.

    Returns:
        Parsed analysis dict or None.
    """
    chart_file = Path(chart_path)
    if not chart_file.exists():
        logger.error("Chart file not found: %s", chart_path)
        return None

    # Encode image as base64
    image_data = base64.standard_b64encode(chart_file.read_bytes()).decode("utf-8")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=settings.claude_max_tokens,
            system=SYSTEM_PROMPT,
            messages=[
                {
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
                        {
                            "type": "text",
                            "text": _build_user_message(ticker, indicators),
                        },
                    ],
                }
            ],
        )
    except anthropic.APIError as exc:
        logger.error("Claude API error for %s: %s", ticker, exc)
        return None

    raw_text = response.content[0].text if response.content else ""
    logger.debug("Claude raw response for %s: %s", ticker, raw_text)

    analysis = _extract_json(raw_text)
    if not analysis:
        logger.warning("Failed to parse JSON from Claude response for %s", ticker)
        return None

    # Validate required fields
    confidence = analysis.get("confidence", 0)
    if not isinstance(confidence, (int, float)):
        try:
            confidence = int(confidence)
        except (ValueError, TypeError):
            confidence = 0
    analysis["confidence"] = int(confidence)

    if analysis["confidence"] < settings.min_confidence:
        logger.info(
            "Filtered %s: confidence %d < %d",
            ticker, analysis["confidence"], settings.min_confidence,
        )
        return None

    if "setup_type" not in analysis:
        analysis["setup_type"] = "none"

    logger.info(
        "Analysis for %s: %s (confidence=%d)",
        ticker, analysis.get("setup_type"), analysis["confidence"],
    )
    return analysis
