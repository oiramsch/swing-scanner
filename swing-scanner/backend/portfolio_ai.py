"""
AI-powered portfolio review using Claude.
Analyzes all open positions and provides actionable recommendations.
"""
import json
import logging
from typing import Optional

import anthropic

from backend.config import settings
from backend.database import get_budget, get_open_positions, get_signals_for_position
from backend.market_regime import get_current_regime

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a portfolio manager reviewing a swing trading portfolio. Analyze each position and provide actionable recommendations.

Respond ONLY with valid JSON in this exact format:
{
  "portfolio_summary": {
    "overall_risk": "low|medium|high",
    "diversification": "comment on sector concentration",
    "cash_available": "5000€",
    "recommendation": "overall portfolio action"
  },
  "positions": [
    {
      "ticker": "AAPL",
      "action": "hold|reduce|close|add",
      "urgency": "immediate|this_week|monitor",
      "reason": "Explanation max 2 sentences",
      "suggested_stop_adjustment": "new stop or null"
    }
  ],
  "watchout": "Key market risk to watch this week"
}"""


def _extract_json(text: str) -> Optional[dict]:
    import re
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return None


async def run_portfolio_ai_check() -> Optional[dict]:
    """
    Collect all open positions + signals, send to Claude, return recommendations.
    """
    budget = get_budget()
    positions = get_open_positions()
    regime = get_current_regime()

    if not positions:
        return {
            "portfolio_summary": {
                "overall_risk": "low",
                "diversification": "No open positions",
                "cash_available": f"{budget.start_budget:.0f}€",
                "recommendation": "No positions to review",
            },
            "positions": [],
            "watchout": "Monitor market conditions before entering trades",
        }

    total_invested = sum(p.position_value for p in positions)
    invested_pct = round(total_invested / budget.start_budget * 100, 1)
    cash = round(budget.start_budget - total_invested, 2)

    positions_data = []
    for pos in positions:
        signals = get_signals_for_position(pos.id)
        active_signals = [s.signal_type for s in signals]
        days_in = (pos.entry_date.__class__.today() - pos.entry_date).days
        positions_data.append({
            "ticker": pos.ticker,
            "entry_price": pos.entry_price,
            "entry_date": pos.entry_date.isoformat(),
            "shares": pos.shares,
            "position_value": pos.position_value,
            "stop_loss": pos.stop_loss,
            "target": pos.target,
            "risk_amount": pos.risk_amount,
            "sector": pos.sector,
            "setup_type": pos.setup_type,
            "days_in_trade": days_in,
            "active_signals": active_signals,
        })

    user_text = (
        f"Portfolio context:\n"
        f"- Total budget: {budget.start_budget:.0f}€\n"
        f"- Current invested: {total_invested:.0f}€ ({invested_pct}%)\n"
        f"- Cash available: {cash:.0f}€\n"
        f"- Market regime: {regime}\n"
        f"- Risk per trade: {budget.risk_per_trade_pct}%\n\n"
        f"Positions:\n{json.dumps(positions_data, indent=2)}\n\n"
        "Provide portfolio analysis and position recommendations as JSON."
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_text}],
        )
    except anthropic.APIError as exc:
        logger.error("Portfolio AI check failed: %s", exc)
        return None

    raw_text = response.content[0].text if response.content else ""
    result = _extract_json(raw_text)

    if not result:
        logger.warning("Failed to parse portfolio AI response")
        return None

    logger.info("Portfolio AI check completed for %d positions", len(positions))
    return result
