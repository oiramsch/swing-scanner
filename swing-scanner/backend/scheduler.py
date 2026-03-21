"""
ARQ worker + job definitions for the daily swing scanner run.

Start the worker:
    arq backend.scheduler.WorkerSettings

The daily_scan job runs at SCAN_TIME_UTC (default 22:15 UTC).
It can also be triggered manually via run_scan().
"""
import logging
from datetime import date

from arq import cron

from backend.analyzer import analyze_chart
from backend.chart_fetcher import render_chart
from backend.config import settings
from backend.database import ScanResult, init_db, save_scan_result
from backend.screener import run_screener

logger = logging.getLogger(__name__)


async def startup(ctx: dict):
    init_db()
    logger.info("ARQ worker started.")


async def daily_scan(ctx: dict):
    """
    Full daily scan pipeline:
    1. Screen for candidates
    2. Render charts
    3. Analyze with Claude Vision
    4. Persist results to DB
    """
    logger.info("=== daily_scan started ===")
    scan_date = date.today()

    try:
        candidates = run_screener()
    except Exception as exc:
        logger.error("Screener failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    logger.info("Processing %d candidates for %s", len(candidates), scan_date)
    saved = 0
    failed = 0

    for candidate in candidates:
        ticker = candidate["ticker"]
        df = candidate["df"]
        indicators = candidate["indicators"]

        # --- Chart rendering ---
        try:
            chart_path = render_chart(ticker, df)
        except Exception as exc:
            logger.warning("Chart render failed for %s: %s", ticker, exc)
            failed += 1
            continue

        # --- Claude Vision analysis ---
        try:
            analysis = analyze_chart(chart_path, ticker, indicators)
        except Exception as exc:
            logger.warning("Analysis failed for %s: %s", ticker, exc)
            failed += 1
            continue

        if analysis is None:
            logger.info("No qualifying setup for %s", ticker)
            continue

        # --- Persist to DB ---
        try:
            result = ScanResult(
                ticker=ticker,
                scan_date=scan_date,
                setup_type=analysis.get("setup_type", "none"),
                pattern_name=analysis.get("pattern_name"),
                confidence=analysis.get("confidence", 0),
                entry_zone=analysis.get("entry_zone"),
                stop_loss=analysis.get("stop_loss"),
                target=analysis.get("target"),
                reasoning=analysis.get("reasoning"),
                chart_path=chart_path,
            )
            save_scan_result(result)
            saved += 1
            logger.info(
                "Saved: %s — %s (confidence=%d)",
                ticker, result.setup_type, result.confidence,
            )
        except Exception as exc:
            logger.warning("DB save failed for %s: %s", ticker, exc)
            failed += 1

    summary = {
        "status": "done",
        "scan_date": str(scan_date),
        "candidates_screened": len(candidates),
        "saved": saved,
        "failed": failed,
    }
    logger.info("=== daily_scan complete: %s ===", summary)
    return summary


async def run_scan():
    """Standalone callable for manual trigger (no ARQ ctx needed)."""
    return await daily_scan({})


def _parse_scan_time() -> tuple[int, int]:
    try:
        h, m = settings.scan_time_utc.split(":")
        return int(h), int(m)
    except Exception:
        return 22, 15


_hour, _minute = _parse_scan_time()


class WorkerSettings:
    functions = [daily_scan]
    cron_jobs = [
        cron(daily_scan, hour={_hour}, minute={_minute}, run_at_startup=False)
    ]
    on_startup = startup
    max_jobs = 1
    job_timeout = 3600  # 1 hour max
