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
    allowed = {
        "emotion_entry", "emotion_exit", "followed_rules",
        "lesson", "mistakes", "exit_price", "exit_date",
        "pnl_eur", "pnl_pct",
    }
    update_data = {k: v for k, v in data.items() if k in allowed}
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
