"""
AI-generated trade action settings for swing and position trades.
"""
import json
import logging
from datetime import datetime
from typing import Optional

import anthropic

from backend.config import settings

logger = logging.getLogger(__name__)

_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


# ---------------------------------------------------------------------------
# Position size assessment
# ---------------------------------------------------------------------------

def get_sector_exposure(sector: Optional[str], max_sector_exposure_pct: float) -> Optional[str]:
    """
    Check current portfolio sector concentration.
    Returns a MEDIUM warning string if the sector already exceeds max_sector_exposure_pct,
    or None if within limits.
    """
    if not sector:
        return None
    try:
        from backend.database import get_open_positions, get_budget
        budget = get_budget()
        positions = get_open_positions()
        total_invested = sum(p.position_value for p in positions)
        if total_invested <= 0:
            return None
        sector_invested = sum(
            p.position_value for p in positions
            if (p.sector or "").lower() == sector.lower()
        )
        sector_pct = (sector_invested / budget.start_budget) * 100
        if sector_pct >= max_sector_exposure_pct:
            return (
                f"⚠️ MEDIUM: Sektor '{sector}' bereits bei {sector_pct:.1f}% "
                f"(max. {max_sector_exposure_pct:.0f}%) — Diversifikation beachten"
            )
    except Exception as exc:
        logger.debug("Sector exposure check failed: %s", exc)
    return None


def assess_position_size(
    entry_price: float,
    shares: float,
    stop_loss: float,
    budget_total: float,
    risk_per_trade_pct: float,
    sector: Optional[str] = None,
    max_sector_exposure_pct: float = 30.0,
) -> Optional[str]:
    """Return a warning string if position or risk sizing is out of bounds."""
    if budget_total <= 0:
        return None

    position_value = entry_price * shares
    position_pct = (position_value / budget_total) * 100
    risk_amount = (entry_price - stop_loss) * shares
    risk_pct = (risk_amount / budget_total) * 100

    if position_pct > 30:
        return (
            f"⚠️ HIGH: Position {position_pct:.1f}% des Budgets — max. 25% empfohlen"
        )
    if risk_pct > risk_per_trade_pct * 2:
        return (
            f"🔴 CRITICAL: Risiko {risk_pct:.1f}% überschreitet Regel "
            f"({risk_per_trade_pct:.1f}%) deutlich"
        )
    sector_warn = get_sector_exposure(sector, max_sector_exposure_pct)
    if sector_warn:
        return sector_warn
    return None


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_trade_setting(
    ticker: str,
    trade_type: str,                    # "swing" | "position"
    entry_price: float,
    shares: float,
    budget_total: float,
    risk_per_trade_pct: float = 1.0,
    setup_type: str = "breakout",
    atr: float = 1.0,
    rsi: float = 60.0,
    days_until_earnings: Optional[int] = None,
    market_regime: str = "neutral",
    support: Optional[float] = None,
    resistance: Optional[float] = None,
    volume_ratio: Optional[float] = None,
    pattern_name: Optional[str] = None,
    research_score: Optional[int] = None,
    # Position trade extras
    analyst_rating: Optional[str] = None,
    insider_activity: Optional[str] = None,
    fundamental_context: Optional[str] = None,
) -> dict:
    """
    Generate a complete trade action plan via Claude Sonnet.
    Returns parsed JSON dict with stop_loss, targets, hold_duration, exit_triggers.
    """
    position_value = entry_price * shares
    position_pct = round((position_value / budget_total) * 100, 1) if budget_total > 0 else 0
    risk_amount = round((entry_price - (support or entry_price * 0.95)) * shares, 2)
    risk_pct = round((risk_amount / budget_total) * 100, 1) if budget_total > 0 else 0

    earnings_str = f"{days_until_earnings} days" if days_until_earnings else "unknown/not soon"
    support_str = f"${support:.2f}" if support else "N/A"
    resistance_str = f"${resistance:.2f}" if resistance else "N/A"
    volume_str = f"{volume_ratio:.1f}x" if volume_ratio else "N/A"
    pattern_str = pattern_name or setup_type
    score_str = f"{research_score}/10" if research_score else "N/A"

    if trade_type == "swing":
        user_prompt = f"""Generate a SWING TRADE action plan (1-4 weeks):

Ticker: {ticker} | Entry: ${entry_price} | Shares: {shares}
Position: €{position_value:.0f} ({position_pct}% of budget)
Risk: €{risk_amount:.0f} ({risk_pct}% of budget)

Setup: {setup_type} — {pattern_str}
Support: {support_str} | Resistance: {resistance_str}
ATR: ${atr:.2f} | RSI: {rsi:.0f} | Volume: {volume_str} avg
Earnings in: {earnings_str}
Market Regime: {market_regime}
Research Score: {score_str}

Respond ONLY with JSON:
{{
  "trade_type": "swing",
  "rationale": "1-2 sentences why this is a swing setup",
  "stop_loss": {{
    "initial": 0.00,
    "method": "below support|ATR-based|pattern low",
    "explanation": "Why this level"
  }},
  "trailing_stop": {{
    "recommended": true,
    "activate_at": 0.00,
    "trail_by": "ATR|fixed_pct",
    "trail_value": 0.00
  }},
  "targets": [
    {{
      "price": 0.00,
      "label": "Target 1",
      "action": "Sell 50% of position",
      "rationale": "Resistance / R:R"
    }},
    {{
      "price": 0.00,
      "label": "Target 2",
      "action": "Sell remaining, move stop to breakeven",
      "rationale": "Extended target"
    }}
  ],
  "hold_duration": {{
    "min_days": 5,
    "max_days": 20,
    "ideal_days": 10,
    "note": "Exit before earnings if not at target"
  }},
  "exit_triggers": [
    {{
      "condition": "Daily close below SMA20",
      "action": "Exit full position",
      "urgency": "immediate"
    }},
    {{
      "condition": "RSI drops below 45",
      "action": "Tighten stop to 1 ATR below price",
      "urgency": "monitor"
    }},
    {{
      "condition": "Volume dries up 3+ days",
      "action": "Consider early exit",
      "urgency": "watch"
    }}
  ],
  "position_size_assessment": {{
    "is_appropriate": true,
    "warning": null,
    "recommendation": "Position size within risk parameters"
  }},
  "summary": "3-sentence plain language summary"
}}"""
    else:
        analyst_str = analyst_rating or "N/A"
        insider_str = insider_activity or "N/A"
        fundamental_str = fundamental_context or "N/A"
        user_prompt = f"""Generate a POSITION TRADE action plan (1-3 months):

Ticker: {ticker} | Entry: ${entry_price} | Shares: {shares}
Position: €{position_value:.0f} ({position_pct}% of budget)
Risk: €{risk_amount:.0f} ({risk_pct}% of budget)

Setup: {setup_type} — {pattern_str}
Support: {support_str} | Resistance: {resistance_str}
ATR: ${atr:.2f} | RSI: {rsi:.0f} | Volume: {volume_str} avg
Earnings in: {earnings_str}
Market Regime: {market_regime}
Research Score: {score_str}

Fundamental Context: {fundamental_str}
Analyst Rating: {analyst_str}
Insider Activity: {insider_str}

Respond ONLY with JSON:
{{
  "trade_type": "position",
  "rationale": "1-2 sentences why this is a position trade setup",
  "stop_loss": {{
    "initial": 0.00,
    "method": "below support|ATR-based|pattern low",
    "explanation": "Why this level"
  }},
  "trailing_stop": {{
    "recommended": true,
    "activate_at": 0.00,
    "trail_by": "ATR|fixed_pct",
    "trail_value": 0.00,
    "note": "Activate after 2+ weeks of profit"
  }},
  "targets": [
    {{
      "price": 0.00,
      "label": "Target 1",
      "action": "Sell 30% of position",
      "rationale": "~1.5R target"
    }},
    {{
      "price": 0.00,
      "label": "Target 2",
      "action": "Sell remaining at analyst target",
      "rationale": "Analyst consensus target"
    }}
  ],
  "hold_duration": {{
    "min_days": 20,
    "max_days": 90,
    "ideal_days": 45,
    "note": "Weekly review — fundamentals drive exit, not daily noise"
  }},
  "exit_triggers": [
    {{
      "condition": "Earnings miss >10%",
      "action": "Exit full position",
      "urgency": "immediate"
    }},
    {{
      "condition": "Analyst downgrade to sell",
      "action": "Review and likely exit",
      "urgency": "today"
    }},
    {{
      "condition": "Weekly close below SMA50",
      "action": "Exit position",
      "urgency": "immediate"
    }},
    {{
      "condition": "Sector rotation out of this sector 2+ weeks",
      "action": "Consider reducing position",
      "urgency": "watch"
    }}
  ],
  "position_size_assessment": {{
    "is_appropriate": true,
    "warning": null,
    "recommendation": "Position size within risk parameters"
  }},
  "summary": "3-sentence plain language summary"
}}"""

    system_prompt = (
        "You are an expert trading coach specializing in technical analysis and trade management. "
        "Generate a complete action plan tailored to the specific trade type. "
        "Be specific, practical, and actionable. All price levels must be mathematically precise. "
        "Respond ONLY with valid JSON, no markdown, no extra text."
    )

    client = _get_client()
    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        setting = json.loads(raw)
        logger.info("Trade setting generated for %s (%s)", ticker, trade_type)
        return setting
    except json.JSONDecodeError as exc:
        logger.error("Trade setting JSON parse error for %s: %s", ticker, exc)
        raise ValueError(f"Claude returned invalid JSON for trade setting: {exc}") from exc
    except Exception as exc:
        logger.error("Trade setting generation failed for %s: %s", ticker, exc)
        raise
