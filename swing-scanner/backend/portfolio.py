"""
Portfolio CRUD: positions, budget, P&L enrichment, summary.
"""
import json
import logging
from datetime import date, datetime
from typing import Optional

from backend.database import (
    JournalEntry,
    PortfolioBudget,
    PortfolioPosition,
    TradePlan,
    get_budget,
    get_closed_positions,
    get_closed_trade_plans,
    get_open_positions,
    get_position,
    save_journal_entry,
    save_position,
    update_budget,
    update_position,
    update_trade_plan,
)
from backend.position_sizing import calculate_position, check_sector_concentration

logger = logging.getLogger(__name__)


def create_position(data: dict) -> dict:
    """
    Create a new portfolio position.
    Accepts: ticker, entry_price, shares, stop_loss, entry_date,
             target, notes, setup_type, sector, scan_result_id
    Returns enriched position dict with sizing info and warnings.
    """
    budget = get_budget()
    entry_price = float(data["entry_price"])
    stop_loss = float(data["stop_loss"])
    shares = float(data.get("shares", 0))
    target = float(data["target"]) if data.get("target") else None

    # Auto-calculate shares if not provided
    if shares <= 0 and target:
        sizing = calculate_position(entry_price, stop_loss, target, budget)
        shares = sizing["shares"]
    elif shares <= 0:
        shares = 1

    position_value = round(entry_price * shares, 2)
    risk_amount = round((entry_price - stop_loss) * shares, 2)
    risk_reward = None
    if target:
        rr = (target - entry_price) / (entry_price - stop_loss) if (entry_price - stop_loss) > 0 else None
        risk_reward = round(rr, 2) if rr else None

    # Trade-Setting fields (optional — populated when setting is generated beforehand)
    action_setting = data.get("action_setting_json")
    setting_dict: dict = {}
    if action_setting and isinstance(action_setting, str):
        try:
            setting_dict = json.loads(action_setting)
        except Exception:
            pass
    elif action_setting and isinstance(action_setting, dict):
        setting_dict = action_setting
        action_setting = json.dumps(action_setting)

    pos = PortfolioPosition(
        ticker=data["ticker"].upper(),
        entry_date=date.fromisoformat(data.get("entry_date", date.today().isoformat())),
        entry_price=entry_price,
        shares=shares,
        position_value=position_value,
        stop_loss=stop_loss,
        target=target,
        risk_amount=risk_amount,
        risk_reward=risk_reward,
        notes=data.get("notes"),
        setup_type=data.get("setup_type"),
        sector=data.get("sector"),
        scan_result_id=data.get("scan_result_id"),
        # Trade-Setting
        trade_type=data.get("trade_type"),
        action_setting_json=action_setting,
        stop_loss_initial=data.get("stop_loss_initial") or (
            setting_dict.get("stop_loss", {}).get("initial") if setting_dict else None
        ),
        stop_loss_trailing=data.get("stop_loss_trailing") or (
            setting_dict.get("trailing_stop", {}).get("recommended") if setting_dict else None
        ),
        target_1=data.get("target_1") or (
            setting_dict.get("targets", [{}])[0].get("price") if setting_dict and setting_dict.get("targets") else None
        ),
        target_2=data.get("target_2") or (
            setting_dict.get("targets", [{}, {}])[1].get("price") if setting_dict and len(setting_dict.get("targets", [])) > 1 else None
        ),
        target_1_action=data.get("target_1_action") or (
            setting_dict.get("targets", [{}])[0].get("action") if setting_dict and setting_dict.get("targets") else None
        ),
        target_2_action=data.get("target_2_action") or (
            setting_dict.get("targets", [{}, {}])[1].get("action") if setting_dict and len(setting_dict.get("targets", [])) > 1 else None
        ),
        hold_days_min=data.get("hold_days_min") or (
            setting_dict.get("hold_duration", {}).get("min_days") if setting_dict else None
        ),
        hold_days_max=data.get("hold_days_max") or (
            setting_dict.get("hold_duration", {}).get("max_days") if setting_dict else None
        ),
        exit_trigger_json=data.get("exit_trigger_json") or (
            json.dumps(setting_dict.get("exit_triggers", [])) if setting_dict and setting_dict.get("exit_triggers") else None
        ),
        position_size_warning=data.get("position_size_warning"),
        setting_generated_at=datetime.utcnow() if action_setting else None,
        # v2.7
        broker_id=data.get("broker_id"),
        execution_fx_rate=data.get("execution_fx_rate"),
    )
    saved = save_position(pos)

    warnings = []
    sector_warn = check_sector_concentration(pos.sector, budget)
    if sector_warn:
        warnings.append(sector_warn)

    result = saved.model_dump()
    result["warnings"] = warnings
    return result


def close_position(position_id: int, exit_price: float, exit_reason: str = "manual") -> dict:
    """
    Close a position: compute P&L, mark as closed, create journal prefill.
    """
    pos = get_position(position_id)
    if not pos or not pos.is_open:
        raise ValueError(f"Position {position_id} not found or already closed")

    pnl_eur = round((exit_price - pos.entry_price) * pos.shares, 2)
    pnl_pct = round(((exit_price - pos.entry_price) / pos.entry_price) * 100, 2)

    updated = update_position(position_id, {
        "is_open": False,
        "exit_date": date.today(),
        "exit_price": exit_price,
        "exit_reason": exit_reason,
        "pnl_eur": pnl_eur,
        "pnl_pct": pnl_pct,
    })

    # Pre-fill journal entry
    if updated:
        # Build setup_reason: combine notes with trade setting summary if available
        setup_reason = pos.notes or ""
        if pos.action_setting_json:
            try:
                setting_dict = json.loads(pos.action_setting_json)
                summary = setting_dict.get("summary", "")
                if summary:
                    setup_reason = f"{setup_reason}\n\n[Trade Plan]\n{summary}".strip()
            except Exception:
                pass

        journal = JournalEntry(
            position_id=position_id,
            trade_date=pos.entry_date,
            ticker=pos.ticker,
            setup_reason=setup_reason,
            setup_type=pos.setup_type,
            entry_price=pos.entry_price,
            stop_loss=pos.stop_loss,
            target=pos.target or exit_price,
            risk_eur=pos.risk_amount,
            risk_reward=pos.risk_reward or 0.0,
            position_size=int(pos.shares),
            exit_price=exit_price,
            exit_date=date.today(),
            pnl_eur=pnl_eur,
            pnl_pct=pnl_pct,
        )
        save_journal_entry(journal)

    # Auto-close linked in_position TradePlans for the same ticker so they don't
    # accumulate and block the auto-trading safety limit.
    if updated:
        try:
            from sqlmodel import Session, select
            from backend.database import get_engine
            with Session(get_engine()) as db:
                linked = db.exec(
                    select(TradePlan)
                    .where(TradePlan.ticker == pos.ticker)
                    .where(TradePlan.status == "in_position")
                ).all()
                for plan in linked:
                    update_trade_plan(plan.id, {
                        "status": "closed",
                        "actual_exit_price": exit_price,
                        "exit_date": date.today().isoformat(),
                    })
                    logger.info("Auto-closed TradePlan #%s (%s) via position close", plan.id, pos.ticker)
        except Exception as exc:
            logger.warning("Could not auto-close linked TradePlan for %s: %s", pos.ticker, exc)

    return updated.model_dump() if updated else {}


def get_portfolio_summary() -> dict:
    """Return portfolio-wide stats including P&L, sector breakdown, budget usage."""
    budget = get_budget()
    open_positions = get_open_positions()
    closed_positions = get_closed_positions()

    total_invested = sum(p.position_value for p in open_positions)
    total_risk = sum(p.risk_amount for p in open_positions)
    invested_pct = round((total_invested / budget.start_budget) * 100, 1) if budget.start_budget > 0 else 0

    # Closed P&L — PortfolioPositions (EUR-konvertiert) + closed TradePlans
    def _to_eur(p) -> float:
        pnl = p.pnl_eur or 0
        if p.execution_fx_rate and p.execution_fx_rate > 0:
            return round(pnl / p.execution_fx_rate, 2)
        return pnl

    closed_trade_plans = get_closed_trade_plans()
    trade_plan_pnl = sum(p.pnl_eur or 0 for p in closed_trade_plans)
    closed_pnl = sum(_to_eur(p) for p in closed_positions) + trade_plan_pnl
    wins = [p for p in closed_positions if _to_eur(p) > 0]
    losses = [p for p in closed_positions if _to_eur(p) < 0]
    win_rate = round(len(wins) / len(closed_positions) * 100, 1) if closed_positions else 0

    # Sector breakdown
    sector_map: dict = {}
    for p in open_positions:
        sec = p.sector or "Unknown"
        sector_map[sec] = sector_map.get(sec, 0) + p.position_value

    return {
        "budget": budget.model_dump(),
        "total_invested": round(total_invested, 2),
        "invested_pct": invested_pct,
        "available_capital": round(budget.start_budget - total_invested, 2),
        "total_risk": round(total_risk, 2),
        "open_positions": len(open_positions),
        "closed_pnl": round(closed_pnl, 2),
        "total_trades": len(closed_positions),
        "win_rate": win_rate,
        "sector_breakdown": {k: round(v, 2) for k, v in sector_map.items()},
    }


def enrich_position(pos: PortfolioPosition, current_price: Optional[float] = None) -> dict:
    """Add current price and unrealized P&L to a position dict."""
    data = pos.model_dump()
    if current_price is not None:
        unrealized_pnl = round((current_price - pos.entry_price) * pos.shares, 2)
        unrealized_pct = round(((current_price - pos.entry_price) / pos.entry_price) * 100, 2)
        data["current_price"] = current_price
        data["unrealized_pnl"] = unrealized_pnl
        data["unrealized_pct"] = unrealized_pct
        data["days_in_trade"] = (date.today() - pos.entry_date).days
    return data
