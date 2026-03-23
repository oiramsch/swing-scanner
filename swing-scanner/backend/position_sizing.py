"""
Position sizing calculator based on PortfolioBudget risk parameters.
"""
import logging
from typing import Optional

from backend.database import PortfolioBudget, get_budget, get_open_positions

logger = logging.getLogger(__name__)


def calculate_position(
    entry_price: float,
    stop_loss: float,
    target: float,
    budget: Optional[PortfolioBudget] = None,
) -> dict:
    """
    Calculate position size based on fixed fractional risk.

    Returns dict with shares, position_value, risk_amount, potential_gain, crv, warnings.
    """
    if budget is None:
        budget = get_budget()

    risk_amount = budget.start_budget * (budget.risk_per_trade_pct / 100)
    risk_per_share = entry_price - stop_loss

    if risk_per_share <= 0:
        return {
            "shares": 0,
            "position_value_eur": 0.0,
            "pct_of_budget": 0.0,
            "risk_amount_eur": 0.0,
            "potential_gain_eur": 0.0,
            "crv": 0.0,
            "risk_per_trade_pct": budget.risk_per_trade_pct,
            "warnings": ["Stop loss must be below entry price"],
        }

    shares = int(risk_amount / risk_per_share)
    position_value = shares * entry_price
    pct_of_budget = (position_value / budget.start_budget) * 100
    crv = (target - entry_price) / risk_per_share
    potential_gain = (target - entry_price) * shares
    max_loss = risk_per_share * shares

    warnings = []

    # Check max positions
    open_positions = get_open_positions()
    if len(open_positions) >= budget.max_positions:
        warnings.append(
            f"Already at max positions ({budget.max_positions}). "
            "Consider closing a position first."
        )

    # Check if position is too large (> 25% of budget)
    if pct_of_budget > 25:
        warnings.append(
            f"Position is {pct_of_budget:.1f}% of budget — consider reducing."
        )

    return {
        "shares": shares,
        "position_value_eur": round(position_value, 2),
        "pct_of_budget": round(pct_of_budget, 1),
        "risk_amount_eur": round(max_loss, 2),
        "potential_gain_eur": round(potential_gain, 2),
        "crv": round(crv, 2),
        "risk_per_trade_pct": budget.risk_per_trade_pct,
        "warnings": warnings,
    }


def check_sector_concentration(
    sector: Optional[str],
    budget: Optional[PortfolioBudget] = None,
) -> Optional[str]:
    """
    Check if adding a position in this sector exceeds max_sector_exposure_pct.
    Returns warning string or None.
    """
    if not sector:
        return None

    if budget is None:
        budget = get_budget()

    open_positions = get_open_positions()
    sector_value = sum(
        p.position_value for p in open_positions
        if p.sector == sector and p.is_open
    )
    total_invested = sum(p.position_value for p in open_positions if p.is_open)

    if total_invested == 0:
        return None

    sector_pct = (sector_value / budget.start_budget) * 100
    if sector_pct >= budget.max_sector_exposure_pct:
        return (
            f"Warning: {sector} already at {sector_pct:.1f}% of budget "
            f"(max {budget.max_sector_exposure_pct}%)"
        )
    return None
