"""
Standard Claude Vision analysis for scanner candidates.

Two modes (controlled by settings.use_two_stage_analysis):

TRUE (default, v2.8+):
  Stage 1 — fact_extractor: Vision extracts only objective chart facts
  Stage 2 — setup_classifier: deterministic rules derive setup from facts
  → Deterministic: same chart → same result. Direction/entry/stop/target from rules.

FALSE (legacy, for comparison/debugging):
  Single-stage: Vision determines everything in one call.
  → May produce inconsistent results on ambiguous charts.
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

# ── Legacy single-stage prompt (used when use_two_stage_analysis=False) ──────
_LEGACY_SYSTEM_PROMPT = """You are an expert swing trader with 20 years of experience. Analyze the provided daily candlestick chart and identify trading setups. The chart shows: candlesticks, SMA20 (blue), SMA50 (orange), EMA9 (purple dashed), and volume panel.

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


def _enrich_with_crv(analysis: dict) -> dict:
    """Compute CRV from entry/stop/target and add crv_calculated + crv_valid."""
    from backend.news_checker import calculate_crv, _parse_entry_mid, _parse_price
    entry_mid = _parse_entry_mid(analysis.get("entry_zone"))
    stop      = _parse_price(analysis.get("stop_loss"))
    target    = _parse_price(analysis.get("target"))
    if entry_mid and stop and target:
        crv_result = calculate_crv(entry_mid, stop, target)
        analysis["crv_calculated"] = crv_result["crv"]
        analysis["crv_valid"]      = crv_result["crv_valid"]
        if crv_result.get("warning") and not analysis.get("crv_warning"):
            analysis["crv_warning"] = crv_result["warning"]
    else:
        analysis["crv_calculated"] = None
        analysis["crv_valid"]      = True  # unknown → don't penalise
    return analysis


def _apply_news_override(analysis: dict, news_check: Optional[dict]) -> dict:
    """If news invalidates technicals, override the flag."""
    if news_check and news_check.get("invalidates_technicals"):
        analysis["technical_setup_valid"] = False
        if not analysis.get("invalidation_reason"):
            analysis["invalidation_reason"] = news_check.get("corporate_action_description")
    return analysis


# ─────────────────────────────────────────────────────────────────────────────
# Two-stage analysis
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_two_stage(
    chart_path: str,
    ticker: str,
    indicators: dict,
    news_check: Optional[dict],
    module: str,
    regime: str,
) -> Optional[dict]:
    """
    Stage 1: extract objective facts with Vision.
    Stage 2: deterministic rule-based setup classification.
    """
    from backend.fact_extractor import extract_facts
    from backend.setup_classifier import classify_setup

    facts = extract_facts(chart_path, ticker, indicators)
    if facts is None:
        logger.warning("[two-stage] Fact extraction failed for %s — falling back to legacy", ticker)
        return None  # caller will fall back to legacy

    classifier = classify_setup(facts, indicators, regime, module)

    # Confidence = vision clarity + classifier adjustment + signal convergence, clamped 1–10
    base       = int(facts.get("clarity_score", 5))
    adj        = int(classifier.get("confidence_adjustment", 0))
    convergence = int(classifier.get("signal_convergence_bonus", 0))
    confidence = max(1, min(10, base + adj + convergence))

    analysis = {
        # Core fields (same shape as legacy output)
        "setup_type":           classifier.get("setup_type") or "none",
        "pattern_name":         facts.get("pattern_detected") if facts.get("pattern_detected") != "none" else None,
        "is_reversal":          classifier.get("setup_type") == "reversal",
        "reversal_type":        facts.get("pattern_detected") if classifier.get("setup_type") == "reversal" else None,
        "confidence":           confidence,
        "entry_zone":           classifier.get("entry_zone"),
        "stop_loss":            classifier.get("stop_loss"),
        "target":               classifier.get("target"),
        "risk_reward":          None,  # computed below via CRV
        "reasoning":            classifier.get("reasoning", ""),
        "technical_setup_valid": True,
        "invalidation_reason":  None,
        # Two-stage metadata
        "extracted_facts_json": json.dumps(facts),
        "_two_stage":           True,
        "_classifier_direction": classifier.get("direction"),
    }

    analysis = _enrich_with_crv(analysis)
    analysis = _apply_news_override(analysis, news_check)

    logger.info(
        "[two-stage] %s: %s confidence=%d crv=%.1f valid=%s dir=%s",
        ticker, analysis["setup_type"], confidence,
        analysis.get("crv_calculated") or 0,
        analysis.get("crv_valid"),
        classifier.get("direction"),
    )
    return analysis


# ─────────────────────────────────────────────────────────────────────────────
# Legacy single-stage analysis
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_legacy(
    chart_path: str,
    ticker: str,
    indicators: dict,
    news_check: Optional[dict],
) -> Optional[dict]:
    """Original single-stage Vision analysis. Used as fallback."""
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

    if news_check:
        headlines = []
        try:
            import json as _json
            raw_hl = news_check.get("news_headlines")
            headlines = _json.loads(raw_hl) if raw_hl else []
        except Exception:
            pass
        gap_pct   = news_check.get("gap_pct", 0)
        corp_desc = news_check.get("corporate_action_description") or "none"
        has_recent   = news_check.get("has_earnings_recent", False)
        has_upcoming = news_check.get("has_earnings_upcoming", False)
        if headlines or gap_pct or has_recent or has_upcoming or news_check.get("has_corporate_action"):
            user_text += (
                "Additional context:\n"
                f"- Recent news: {'; '.join(headlines[:3]) if headlines else 'none'}\n"
                f"- Corporate action: {corp_desc}\n"
                f"- Overnight gap: {gap_pct:+.1f}%\n"
                f"- Earnings recently: {has_recent}\n"
                f"- Earnings upcoming: {has_upcoming}\n\n"
                "If a corporate action or earnings event explains the price movement, "
                "set technical_setup_valid to false.\n\n"
            )

    user_text += "Analyze the chart and respond with JSON only."

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=settings.claude_max_tokens,
            temperature=0,
            system=_LEGACY_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_data}},
                    {"type": "text", "text": user_text},
                ],
            }],
        )
    except anthropic.APIError as exc:
        logger.error("Claude API error for %s: %s", ticker, exc)
        from backend.fact_extractor import _maybe_store_ai_error
        _maybe_store_ai_error(exc)
        return None

    # Successful call — clear any stored error
    try:
        from backend.database import clear_ai_error
        clear_ai_error()
    except Exception:
        pass

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

    analysis.setdefault("setup_type", "none")
    analysis.setdefault("is_reversal", False)
    analysis.setdefault("risk_reward", None)
    analysis.setdefault("technical_setup_valid", True)
    analysis.setdefault("invalidation_reason", None)

    analysis = _enrich_with_crv(analysis)
    analysis = _apply_news_override(analysis, news_check)

    logger.info(
        "[legacy] %s: %s confidence=%d crv=%.1f valid=%s",
        ticker, analysis.get("setup_type"), confidence,
        analysis.get("crv_calculated") or 0, analysis.get("crv_valid"),
    )
    return analysis


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def analyze_chart(
    chart_path: str,
    ticker: str,
    indicators: dict,
    news_check: Optional[dict] = None,
    module: Optional[str] = None,
    regime: str = "neutral",
) -> Optional[dict]:
    """
    Analyze a chart and return a setup dict, or None if confidence too low / no setup.

    In two-stage mode (default): Vision extracts facts, rules derive setup.
    In legacy mode: Vision determines everything in one call.

    Falls back to legacy if two-stage fails or module is unknown.
    """
    use_two_stage = settings.use_two_stage_analysis and module is not None

    analysis = None
    if use_two_stage:
        analysis = _analyze_two_stage(chart_path, ticker, indicators, news_check, module, regime)

    if analysis is None:
        # Legacy fallback: two-stage failed or explicitly disabled
        if use_two_stage:
            logger.info("[two-stage→legacy fallback] %s", ticker)
        analysis = _analyze_legacy(chart_path, ticker, indicators, news_check)

    if analysis is None:
        return None

    confidence = analysis.get("confidence", 0)
    if confidence < settings.min_confidence:
        logger.info("Filtered %s: confidence %d < %d", ticker, confidence, settings.min_confidence)
        return None

    return analysis
