"""
Automatic performance tracking for scanner candidates.
"""
import json
import logging
from datetime import date, timedelta
from typing import Optional

import httpx

from backend.config import settings
from backend.database import (
    PerformanceResult,
    ScanResult,
    get_recent_scan_results,
    get_performance_for_scan,
    save_performance_result,
    update_performance_result,
    get_performance_results,
    get_journal_entries,
)

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


async def _fetch_price_on_date(ticker: str, target_date: date) -> Optional[float]:
    """Fetch closing price for a ticker on a specific date."""
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/range/1/day"
        f"/{target_date.isoformat()}/{target_date.isoformat()}"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=_headers(), params={"adjusted": "true"})
            resp.raise_for_status()
            data = resp.json()
        results = data.get("results", [])
        if results:
            return float(results[0].get("c", 0))
    except Exception as exc:
        logger.warning("Price fetch failed for %s on %s: %s", ticker, target_date, exc)
    return None


async def update_performance_tracking():
    """
    For all scan results in the last 20 days:
    - Create PerformanceResult if not exists
    - Update day1/3/5/10/20 prices
    - Determine result (win/loss/pending)
    """
    scan_results = get_recent_scan_results(days=22)
    updated = 0

    for sr in scan_results:
        if sr.setup_type == "none" or not sr.entry_zone:
            continue

        # Parse entry price from entry_zone (take midpoint)
        try:
            parts = str(sr.entry_zone).replace("$", "").split("-")
            entry_price = float(parts[0].strip())
        except Exception:
            continue

        existing = get_performance_for_scan(sr.id)
        if existing is None:
            perf = PerformanceResult(
                scan_result_id=sr.id,
                ticker=sr.ticker,
                scan_date=sr.scan_date,
                entry_price_at_scan=entry_price,
                result="pending",
            )
            existing = save_performance_result(perf)

        today = date.today()
        update_data = {}

        # Fetch prices for each day offset
        for offset, field in [(1, "price_day1"), (3, "price_day3"), (5, "price_day5"),
                               (10, "price_day10"), (20, "price_day20")]:
            target = sr.scan_date + timedelta(days=offset)
            if target > today:
                continue
            current_val = getattr(existing, field)
            if current_val is None:
                price = await _fetch_price_on_date(sr.ticker, target)
                if price:
                    update_data[field] = price

        if update_data:
            # Parse stop/target
            try:
                stop = float(str(sr.stop_loss).replace("$", "")) if sr.stop_loss else None
                target_price = float(str(sr.target).replace("$", "")) if sr.target else None
            except Exception:
                stop = None
                target_price = None

            # Compute result
            latest_price = update_data.get("price_day20") or update_data.get("price_day10") or \
                           update_data.get("price_day5") or update_data.get("price_day3") or \
                           update_data.get("price_day1")

            if latest_price and stop and latest_price <= stop:
                update_data["stop_triggered"] = True
                update_data["result"] = "loss"
            elif latest_price and target_price and latest_price >= target_price:
                update_data["target_reached"] = True
                update_data["result"] = "win"
            elif today >= sr.scan_date + timedelta(days=20):
                if latest_price:
                    pct = (latest_price - entry_price) / entry_price * 100
                    if pct > 2:
                        update_data["result"] = "win"
                    elif pct < -2:
                        update_data["result"] = "loss"
                    else:
                        update_data["result"] = "breakeven"

            update_performance_result(existing.id, update_data)
            updated += 1

    logger.info("Performance tracking updated for %d scan results", updated)


def get_performance_summary() -> dict:
    """Aggregate performance metrics across all tracked results."""
    results = get_performance_results(days=90)

    if not results:
        return {
            "total_tracked": 0,
            "win_rate": 0,
            "avg_rr": 0,
            "by_result": {},
        }

    closed = [r for r in results if r.result and r.result != "pending"]
    wins = [r for r in closed if r.result == "win"]
    losses = [r for r in closed if r.result == "loss"]

    win_rate = round(len(wins) / len(closed) * 100, 1) if closed else 0

    return {
        "total_tracked": len(results),
        "total_closed": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": win_rate,
        "pending": len([r for r in results if r.result == "pending"]),
    }


def get_performance_by_setup() -> list[dict]:
    """Win rate per setup type from journal entries."""
    entries = get_journal_entries()
    closed = [e for e in entries if e.pnl_eur is not None and e.setup_type]

    setup_stats: dict = {}
    for e in closed:
        st = e.setup_type or "unknown"
        if st not in setup_stats:
            setup_stats[st] = {"wins": 0, "losses": 0, "total_pnl": 0}
        if (e.pnl_eur or 0) > 0:
            setup_stats[st]["wins"] += 1
        else:
            setup_stats[st]["losses"] += 1
        setup_stats[st]["total_pnl"] += e.pnl_eur or 0

    result = []
    for setup, stats in setup_stats.items():
        total = stats["wins"] + stats["losses"]
        result.append({
            "setup_type": setup,
            "wins": stats["wins"],
            "losses": stats["losses"],
            "win_rate": round(stats["wins"] / total * 100, 1) if total > 0 else 0,
            "avg_pnl": round(stats["total_pnl"] / total, 2) if total > 0 else 0,
        })
    return sorted(result, key=lambda x: x["win_rate"], reverse=True)


def get_performance_by_flags() -> list[dict]:
    """Win rate analysis per flag type (gap_up, post_earnings, corporate_action, etc.)."""
    results = get_performance_results(days=90)
    closed = [r for r in results if r.result and r.result != "pending"]

    # Map scan_result_id → scan_result to get flags
    from backend.database import get_recent_scan_results
    scan_map: dict = {}
    for sr in get_recent_scan_results(days=90):
        scan_map[sr.id] = sr

    flag_stats: dict = {}
    for perf in closed:
        sr = scan_map.get(perf.scan_result_id)
        if not sr:
            continue
        try:
            flags = json.loads(sr.flags) if sr.flags else []
        except Exception:
            flags = []

        # Track "no_flags" separately
        flag_set = flags if flags else ["no_flags"]
        for flag in flag_set:
            if flag not in flag_stats:
                flag_stats[flag] = {"wins": 0, "losses": 0}
            if perf.result == "win":
                flag_stats[flag]["wins"] += 1
            else:
                flag_stats[flag]["losses"] += 1

    result = []
    for flag, stats in flag_stats.items():
        total = stats["wins"] + stats["losses"]
        result.append({
            "flag": flag,
            "wins": stats["wins"],
            "losses": stats["losses"],
            "total": total,
            "win_rate": round(stats["wins"] / total * 100, 1) if total > 0 else 0,
        })
    return sorted(result, key=lambda x: x["total"], reverse=True)


def get_crv_validation() -> dict:
    """Check if CRV < 1.5 candidates actually performed worse."""
    results = get_performance_results(days=90)
    closed = [r for r in results if r.result and r.result != "pending"]

    from backend.database import get_recent_scan_results
    scan_map: dict = {}
    for sr in get_recent_scan_results(days=90):
        scan_map[sr.id] = sr

    valid_wins = valid_losses = invalid_wins = invalid_losses = 0

    for perf in closed:
        sr = scan_map.get(perf.scan_result_id)
        if not sr:
            continue
        crv_valid = sr.crv_valid if hasattr(sr, "crv_valid") else True
        if crv_valid:
            if perf.result == "win":
                valid_wins += 1
            else:
                valid_losses += 1
        else:
            if perf.result == "win":
                invalid_wins += 1
            else:
                invalid_losses += 1

    valid_total = valid_wins + valid_losses
    invalid_total = invalid_wins + invalid_losses

    return {
        "crv_valid_win_rate": round(valid_wins / valid_total * 100, 1) if valid_total else 0,
        "crv_invalid_win_rate": round(invalid_wins / invalid_total * 100, 1) if invalid_total else 0,
        "crv_valid_total": valid_total,
        "crv_invalid_total": invalid_total,
        "filter_useful": (
            (valid_wins / valid_total) > (invalid_wins / invalid_total)
            if valid_total and invalid_total else None
        ),
    }


def get_equity_curve() -> list[dict]:
    """Cumulative P&L from journal entries, sorted by date."""
    entries = get_journal_entries()
    closed = sorted(
        [e for e in entries if e.pnl_eur is not None],
        key=lambda e: e.exit_date or e.trade_date,
    )
    cumulative = 0
    curve = []
    for e in closed:
        cumulative += e.pnl_eur or 0
        curve.append({
            "date": (e.exit_date or e.trade_date).isoformat(),
            "pnl": round(e.pnl_eur or 0, 2),
            "cumulative": round(cumulative, 2),
            "ticker": e.ticker,
        })
    return curve
