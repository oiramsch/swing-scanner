"""
Trading journal CRUD and statistics.
"""
import logging
from typing import Optional

from backend.database import (
    JournalEntry,
    get_journal_entries,
    get_journal_entry,
    save_journal_entry,
    update_journal_entry,
)

logger = logging.getLogger(__name__)


def create_journal_entry(data: dict) -> JournalEntry:
    from datetime import date
    entry = JournalEntry(
        position_id=data.get("position_id"),
        trade_date=date.fromisoformat(data.get("trade_date", date.today().isoformat())),
        ticker=data["ticker"].upper(),
        setup_reason=data.get("setup_reason", ""),
        setup_type=data.get("setup_type"),
        chart_path=data.get("chart_path"),
        entry_price=float(data["entry_price"]),
        stop_loss=float(data["stop_loss"]),
        target=float(data["target"]),
        risk_eur=float(data.get("risk_eur", 0)),
        risk_reward=float(data.get("risk_reward", 0)),
        position_size=int(data.get("position_size", 0)),
        exit_price=float(data["exit_price"]) if data.get("exit_price") else None,
        exit_date=date.fromisoformat(data["exit_date"]) if data.get("exit_date") else None,
        pnl_eur=float(data["pnl_eur"]) if data.get("pnl_eur") is not None else None,
        pnl_pct=float(data["pnl_pct"]) if data.get("pnl_pct") is not None else None,
        emotion_entry=data.get("emotion_entry"),
        emotion_exit=data.get("emotion_exit"),
        followed_rules=data.get("followed_rules"),
        lesson=data.get("lesson"),
        mistakes=data.get("mistakes"),
    )
    return save_journal_entry(entry)


def update_lesson(entry_id: int, data: dict) -> Optional[JournalEntry]:
    from datetime import date as _date

    update_data: dict = {}

    # Optional string fields — empty string → None
    for field in ("emotion_entry", "emotion_exit", "lesson", "mistakes", "setup_type"):
        if field in data:
            v = data[field]
            update_data[field] = v if v not in (None, "") else None

    # setup_reason keeps empty string (model default is "")
    if "setup_reason" in data:
        update_data["setup_reason"] = data.get("setup_reason") or ""

    # ticker: required, uppercase
    if "ticker" in data and data["ticker"]:
        update_data["ticker"] = str(data["ticker"]).upper()

    # Date fields: str → date object, empty/None → None
    # exit_date is optional, trade_date is required so only update when non-empty
    for field, required in (("exit_date", False), ("trade_date", True)):
        if field not in data:
            continue
        v = data[field]
        if not v:
            if not required:
                update_data[field] = None
        elif isinstance(v, str):
            update_data[field] = _date.fromisoformat(v)
        else:
            update_data[field] = v

    # Float fields: None/empty string → None for optional, skip for required
    optional_floats = {"exit_price", "pnl_eur", "pnl_pct"}
    required_floats = {"entry_price", "stop_loss", "target", "risk_eur", "risk_reward"}
    for field in optional_floats | required_floats:
        if field not in data:
            continue
        v = data[field]
        if v is None or v == "":
            if field in optional_floats:
                update_data[field] = None
            # required floats with null/empty → skip (keep existing DB value)
        else:
            update_data[field] = float(v)

    # Int fields
    if "position_size" in data:
        v = data["position_size"]
        update_data["position_size"] = int(v) if v not in (None, "") else 0

    # Bool fields
    if "followed_rules" in data:
        update_data["followed_rules"] = data["followed_rules"]

    # Remove keys where value is None AND the field is non-nullable in the model
    # (prevents accidentally overwriting required columns with NULL)
    non_nullable = {"ticker", "trade_date", "entry_price", "stop_loss", "target"}
    update_data = {k: v for k, v in update_data.items() if not (v is None and k in non_nullable)}

    return update_journal_entry(entry_id, update_data)


def get_journal_stats() -> dict:
    """
    Compute journal statistics:
    - Win rate by emotion at entry
    - Win rate: rules followed vs broken
    - Average P&L by emotion
    - Most common mistakes
    """
    entries = get_journal_entries()
    closed = [e for e in entries if e.pnl_eur is not None]

    if not closed:
        return {
            "total_trades": 0,
            "win_rate_overall": 0,
            "win_rate_by_emotion": {},
            "avg_pnl_by_emotion": {},
            "win_rate_rules_followed": 0,
            "win_rate_rules_broken": 0,
            "avg_pnl_rules_followed": 0,
            "avg_pnl_rules_broken": 0,
            "common_mistakes": [],
        }

    wins = [e for e in closed if (e.pnl_eur or 0) > 0]
    win_rate_overall = round(len(wins) / len(closed) * 100, 1)

    # By emotion
    emotions = list(set(e.emotion_entry for e in closed if e.emotion_entry))
    win_rate_by_emotion = {}
    avg_pnl_by_emotion = {}
    for emotion in emotions:
        group = [e for e in closed if e.emotion_entry == emotion]
        emotion_wins = [e for e in group if (e.pnl_eur or 0) > 0]
        win_rate_by_emotion[emotion] = round(len(emotion_wins) / len(group) * 100, 1)
        avg_pnl_by_emotion[emotion] = round(
            sum(e.pnl_eur or 0 for e in group) / len(group), 2
        )

    # Rules followed/broken
    followed = [e for e in closed if e.followed_rules is True]
    broken = [e for e in closed if e.followed_rules is False]
    wrf = round(len([e for e in followed if (e.pnl_eur or 0) > 0]) / len(followed) * 100, 1) if followed else 0
    wrb = round(len([e for e in broken if (e.pnl_eur or 0) > 0]) / len(broken) * 100, 1) if broken else 0
    apnl_f = round(sum(e.pnl_eur or 0 for e in followed) / len(followed), 2) if followed else 0
    apnl_b = round(sum(e.pnl_eur or 0 for e in broken) / len(broken), 2) if broken else 0

    # Common mistakes (parse from mistakes text)
    mistake_texts = [e.mistakes for e in closed if e.mistakes]

    return {
        "total_trades": len(closed),
        "win_rate_overall": win_rate_overall,
        "win_rate_by_emotion": win_rate_by_emotion,
        "avg_pnl_by_emotion": avg_pnl_by_emotion,
        "win_rate_rules_followed": wrf,
        "win_rate_rules_broken": wrb,
        "avg_pnl_rules_followed": apnl_f,
        "avg_pnl_rules_broken": apnl_b,
        "trades_with_rules_followed": len(followed),
        "trades_with_rules_broken": len(broken),
        "common_mistakes": mistake_texts[:5],
    }
