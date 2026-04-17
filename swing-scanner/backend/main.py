"""
FastAPI application — all API endpoints.
"""
import json
import logging
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.auth import AuthenticatedUser, authenticate_user, create_access_token, get_current_user
from backend.config import settings
from backend.database import (
    FilterProfile,
    JournalEntry,
    PortfolioBudget,
    PortfolioPosition,
    ScanResult,
    SignalAlert,
    StrategyModule,
    WatchlistItem,
    activate_filter,
    delete_filter,
    delete_watchlist_item,
    update_watchlist_item,
    get_active_filter,
    get_all_filters,
    get_all_modules,
    get_broker_credentials,
    get_budget,
    get_closed_positions,
    get_funnel_history,
    get_journal_entries,
    get_watchlist_pending,
    get_journal_entry,
    get_latest_funnel,
    get_latest_market_update,
    get_latest_regime,
    get_market_update_history,
    get_modules_for_regime,
    get_open_positions,
    get_position,
    get_result_by_ticker,
    get_results_for_date,
    get_latest_scan_date,
    get_scan_dates,
    get_signals_for_position,
    get_unnotified_signals,
    get_watchlist,
    init_db,
    save_filter,
    save_module,
    save_watchlist_item,
    update_budget,
    update_filter,
    update_journal_entry,
    update_module,
    update_position,
    upsert_broker_connection,
)
from backend.database import (
    TradePlan,
    get_active_trade_plans,
    get_all_trade_plans,
    get_closed_trade_plans,
    get_trade_plan,
    save_trade_plan,
    save_journal_entry,
    update_trade_plan,
    get_all_broker_connections,
    update_broker_manual_balance,
    create_broker_connection,
    update_broker_connection,
    delete_broker_connection,
)
from backend.database import (
    ScanUniverse,
    get_all_universes,
    get_active_universes,
    get_last_scan_datetime,
    update_universe,
)
from backend.journal import create_journal_entry, get_journal_stats, update_lesson
from backend.performance import (
    get_equity_curve,
    get_performance_by_setup,
    get_performance_summary,
)
from backend.portfolio import (
    close_position,
    create_position,
    enrich_position,
    get_portfolio_summary,
)
from backend.position_sizing import calculate_position
from backend.watchlist import add_to_watchlist, get_watchlist_with_prices

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

SCAN_MISSING_THRESHOLD_HOURS = 26

app = FastAPI(title="Swing Scanner API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global auth dependency — protects all /api/* routes except public ones.
# Public exceptions: /health, /api/auth/login
# Implementation: FastAPI dependency_overrides would be cleaner but this
# approach keeps it explicit and easy to audit.
# ---------------------------------------------------------------------------
from fastapi import Request

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """
    Lightweight auth gate. Public paths bypass JWT check.
    All other /api/* paths require a valid Bearer token.
    Note: FastAPI's Depends(get_current_user) on individual routes already
    handles this — this middleware is an additional defense-in-depth layer
    that returns 401 before routes are even dispatched.
    """
    PUBLIC_PATHS = {"/health", "/api/auth/login"}
    path = request.url.path

    # Allow public paths, static assets, and chart images
    # (chart images are loaded via <img> tags which cannot send Bearer headers)
    if path in PUBLIC_PATHS or not path.startswith("/api/") or path.startswith("/api/charts/"):
        return await call_next(request)

    # Check for Bearer token
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await call_next(request)

CHARTS_DIR = Path("/tmp/charts")

# ---------------------------------------------------------------------------
# Scan state
# ---------------------------------------------------------------------------

_scan_running = False
_last_scan: Optional[dict] = None
_scan_progress: dict = {
    "phase": "idle",
    "message": "",
    "processed": 0,
    "total": 0,
    "candidates_found": 0,
    "percent": 0,
}


def _update_progress(phase, message, processed, total, candidates_found, percent=None):
    global _scan_progress
    if percent is None:
        percent = _scan_progress["percent"]
    _scan_progress = {
        "phase": phase,
        "message": message,
        "processed": processed,
        "total": total,
        "candidates_found": candidates_found,
        "percent": percent,
    }


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def on_startup():
    import asyncio
    init_db()
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("DB initialized, charts dir ready.")

    # Repair existing TIMEOUT entries without exit/entry prices (idempotent, background).
    from backend.scheduler import repair_timeout_entries
    asyncio.create_task(repair_timeout_entries())

    # Load persisted settings from DB — these override .env defaults
    # so they survive container rebuilds without needing .env changes.
    from backend.database import get_ntfy_topic, get_anthropic_api_key
    if db_topic := get_ntfy_topic():
        settings.ntfy_topic = db_topic
        logger.info("ntfy_topic loaded from DB")
    if db_key := get_anthropic_api_key():
        settings.anthropic_api_key = db_key
        logger.info("ANTHROPIC_API_KEY loaded from DB")
    # Kick off a background regime refresh so the UI always shows a current value
    async def _warm_regime():
        try:
            from backend.market_regime import ensure_regime_current
            regime = await ensure_regime_current(max_age_hours=12)
            logger.info("Startup regime check: %s", regime)
        except Exception as exc:
            logger.warning("Startup regime check failed: %s", exc)
    asyncio.create_task(_warm_regime())


# ---------------------------------------------------------------------------
# Health (public — no auth)
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Auth (public — no auth required on these two endpoints)
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
async def login(data: dict):
    """
    Exchange email + password for a JWT access token.
    Token expires after jwt_expire_days (default 7).
    """
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    user = authenticate_user(email, password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="E-Mail oder Passwort falsch",
        )
    token = create_access_token({"sub": user.email, "tenant_id": user.tenant_id})
    return {"access_token": token, "token_type": "bearer", "email": user.email}


@app.get("/api/auth/me")
async def auth_me(current_user: AuthenticatedUser = Depends(get_current_user)):
    return {"email": current_user.email, "tenant_id": current_user.tenant_id}


@app.post("/api/auth/change-password")
async def change_password(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    from backend.database import get_user_by_email, update_user_password
    from backend.auth import verify_password
    user = get_user_by_email(current_user.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(data.get("current_password", ""), user.password_hash):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort falsch")
    update_user_password(user.id, data["new_password"])
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Settings — Broker Connection (Phase 2a)
# ---------------------------------------------------------------------------

@app.get("/api/settings/broker")
async def get_broker_settings(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return broker config — API keys are masked, never returned in plain."""
    creds = get_broker_credentials(current_user.tenant_id)
    return {
        "broker_type":           creds.get("broker_type", "alpaca"),
        "is_paper":              creds.get("is_paper", True),
        "base_url":              creds.get("base_url", ""),
        "supports_short_selling": creds.get("supports_short_selling", False),
        "source":                creds.get("source", "env"),
        # Mask keys — only show whether they are set
        "api_key_set":    bool(creds.get("api_key")),
        "api_secret_set": bool(creds.get("api_secret")),
    }


@app.put("/api/settings/broker")
async def update_broker_settings(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Save broker credentials to DB (encrypted). Empty strings = don't overwrite."""
    conn = upsert_broker_connection(current_user.tenant_id, data)
    return {
        "status":     "saved",
        "broker_type": conn.broker_type,
        "is_paper":   conn.is_paper,
        "source":     "db",
    }


@app.post("/api/settings/broker/test")
async def test_broker_connection(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Test Alpaca connection with current credentials."""
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        from alpaca.trading.client import TradingClient
        client = TradingClient(
            api_key=creds["api_key"],
            secret_key=creds["api_secret"],
            paper=creds["is_paper"],
        )
        account = client.get_account()
        return {
            "status":         "ok",
            "account_status": str(account.status),
            "buying_power":   str(account.buying_power),
            "currency":       str(account.currency),
            "is_paper":       creds["is_paper"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Verbindung fehlgeschlagen: {exc}")


# ---------------------------------------------------------------------------
# Market Regime
# ---------------------------------------------------------------------------

@app.get("/api/market-regime")
async def get_market_regime():
    from backend.market_regime import get_regime_status
    return get_regime_status()


@app.post("/api/market-regime/update")
async def trigger_regime_update(background_tasks: BackgroundTasks):
    from backend.market_regime import update_market_regime

    async def _bg():
        await update_market_regime()

    background_tasks.add_task(_bg)
    return {"status": "started"}


# ---------------------------------------------------------------------------
# Scanner Candidates
# ---------------------------------------------------------------------------

@app.get("/api/candidates")
async def list_candidates(
    date_str: Optional[str] = None,
    setup_type: Optional[str] = None,
    min_confidence: Optional[int] = None,
    sector: Optional[str] = None,
    include_filtered: bool = False,   # power-user toggle: show all statuses
):
    scan_date = date.today()
    if date_str:
        try:
            scan_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    results = get_results_for_date(scan_date)

    # Fallback: if no results for requested date, use the latest available scan
    stale = False
    stale_date = None
    if not results and not date_str:
        latest = get_latest_scan_date()
        if latest and latest != scan_date:
            results = get_results_for_date(latest)
            stale = True
            stale_date = latest.isoformat()

    # Fix A/B/C: only show actionable candidates by default
    if not include_filtered:
        # Check if any configured broker supports short selling → show direction_mismatch
        from backend.brokers import get_connector
        broker_conns = get_all_broker_connections(1)  # tenant_id=1
        any_short = any(
            get_connector(c.model_dump()).supports_short_selling
            for c in broker_conns
            if c.is_active
        )

        actionable = []
        for r in results:
            status = r.candidate_status or "active"
            if status == "filtered_avoid":
                continue
            if status == "direction_mismatch":
                if any_short:
                    actionable.append(r)  # show as Short-Setup for short-capable brokers
                continue
            if status != "active":
                continue
            # Safety net for old NULL-status records
            if r.entry_zone and r.stop_loss:
                try:
                    import re as _re
                    nums = [float(x) for x in _re.findall(r"[\d.]+", str(r.entry_zone))]
                    entry_trigger = max(nums) if nums else None
                    if entry_trigger and float(r.stop_loss) >= entry_trigger:
                        continue
                except Exception:
                    pass
            actionable.append(r)
        results = actionable

    if setup_type:
        results = [r for r in results if r.setup_type == setup_type]
    if min_confidence is not None:
        results = [r for r in results if r.confidence >= min_confidence]
    if sector:
        results = [r for r in results if r.sector == sector]

    return {
        "candidates": [r.model_dump() for r in results],
        "stale": stale,
        "stale_date": stale_date,
        "scan_date": scan_date.isoformat(),
    }


@app.get("/api/candidates/watchlist-pending")
async def list_watchlist_pending(date_str: Optional[str] = None):
    """
    Returns candidates with no complete setup (entry+stop+target missing).
    These are 'watch, not trade' — show in a separate UI section.
    """
    from backend.database import get_watchlist_pending
    scan_date = date.today()
    if date_str:
        try:
            scan_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format.")
    results = get_watchlist_pending(scan_date)
    return [r.model_dump() for r in results]


@app.get("/api/candidates/{ticker}")
async def get_candidate(ticker: str, date_str: Optional[str] = None):
    scan_date = date.today()
    if date_str:
        try:
            scan_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format.")

    result = get_result_by_ticker(ticker.upper(), scan_date)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No result for {ticker} on {scan_date}")

    data = result.model_dump()
    if result.deep_analysis_json:
        try:
            data["deep_analysis"] = json.loads(result.deep_analysis_json)
        except Exception:
            pass

    # Add performance data if available
    from backend.database import get_performance_for_scan
    if result.id:
        perf = get_performance_for_scan(result.id)
        if perf:
            data["performance"] = perf.model_dump()

    return data


@app.patch("/api/candidates/{result_id}/ignore")
async def toggle_candidate_ignore(
    result_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Toggle candidate between active and user_ignored status."""
    from backend.database import get_engine, ScanResult as _SR
    from sqlmodel import Session as _Session
    with _Session(get_engine()) as session:
        result = session.get(_SR, result_id)
        if not result or result.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=404, detail="Candidate nicht gefunden")
        new_status = "active" if result.candidate_status == "user_ignored" else "user_ignored"
        result.candidate_status = new_status
        session.add(result)
        session.commit()
    return {"candidate_status": new_status}


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

@app.get("/api/charts/{filename}")
async def get_chart(filename: str):
    chart_path = CHARTS_DIR / filename
    if not chart_path.exists():
        # Try legacy naming
        chart_path = CHARTS_DIR / f"{filename.upper()}.png"
    if not chart_path.exists():
        raise HTTPException(status_code=404, detail=f"Chart not found: {filename}")
    return FileResponse(str(chart_path), media_type="image/png")


@app.get("/api/chart/{symbol}/intraday")
async def get_chart_intraday(
    symbol: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Return 15-min OHLCV bars for last 5 trading days + active trade plan data (Phase B)."""
    from decimal import Decimal
    import yfinance as yf

    try:
        hist = yf.Ticker(symbol.upper()).history(period="5d", interval="15m")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance error: {exc}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No intraday data for {symbol}")

    def _round(v) -> float:
        return float(Decimal(str(v)).quantize(Decimal("0.01")))

    bars = []
    for idx, row in hist.iterrows():
        # Convert tz-aware DatetimeIndex to UTC UNIX timestamp (seconds)
        try:
            import pytz
            ts = int(idx.astimezone(pytz.utc).timestamp())
        except Exception:
            ts = int(idx.timestamp())
        bars.append({
            "time": ts,
            "open": _round(row["Open"]),
            "high": _round(row["High"]),
            "low": _round(row["Low"]),
            "close": _round(row["Close"]),
            "volume": int(row["Volume"]),
        })

    # Look up active trade plan for this symbol
    plan_data = None
    plans = get_active_trade_plans(current_user.tenant_id)
    for plan in plans:
        if plan.ticker.upper() == symbol.upper():
            plan_data = {
                "entry_low": float(plan.entry_low) if plan.entry_low is not None else None,
                "entry_high": float(plan.entry_high) if plan.entry_high is not None else None,
                "stop_loss": float(plan.stop_loss) if plan.stop_loss is not None else None,
                "target": float(plan.target) if plan.target is not None else None,
            }
            break

    return {
        "symbol": symbol.upper(),
        "bars": bars,
        "plan": plan_data,
    }


# ---------------------------------------------------------------------------
# Scan trigger + status
# ---------------------------------------------------------------------------

async def _run_scan_bg():
    global _scan_running, _last_scan, _scan_progress
    _scan_running = True
    _scan_progress = {
        "phase": "starting",
        "message": "Initializing scan…",
        "processed": 0,
        "total": 0,
        "candidates_found": 0,
        "percent": 0,
    }
    try:
        from backend.scheduler import run_scan
        result = await run_scan(progress_cb=_update_progress)
        _last_scan = result
        _scan_progress = {
            "phase": "done",
            "message": f"Scan complete — {result.get('saved', 0)} setups found",
            "processed": result.get("candidates_screened", 0),
            "total": result.get("candidates_screened", 0),
            "candidates_found": result.get("saved", 0),
            "percent": 100,
        }
    except Exception as exc:
        logger.error("Manual scan failed: %s", exc)
        _last_scan = {"status": "error", "error": str(exc)}
        _scan_progress["phase"] = "error"
        _scan_progress["message"] = str(exc)
    finally:
        _scan_running = False


@app.post("/api/scan/trigger")
async def trigger_scan(background_tasks: BackgroundTasks, force: bool = False):
    if _scan_running:
        return {"status": "already_running"}
    if force:
        # force=true: clear today's results first so the duplicate-run guard doesn't block
        from backend.database import clear_results_for_date, resolve_scan_date
        clear_results_for_date(resolve_scan_date())
    background_tasks.add_task(_run_scan_bg)
    return {"status": "started"}


@app.get("/api/scan/status")
async def scan_status():
    last_scan_date = None
    last_scan_time = None
    hours_since_last_scan = None
    scan_missing = True  # True until proven otherwise (no data = scan missing)

    row = get_last_scan_datetime()
    if row:
        last_scan_date = str(row[0])
        last_scan_time = row[1].strftime("%H:%M:%S")
        created_at = row[1]
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - created_at
        hours_since_last_scan = round(delta.total_seconds() / 3600, 1)
        scan_missing = hours_since_last_scan > SCAN_MISSING_THRESHOLD_HOURS

    return {
        "running": _scan_running,
        "progress": _scan_progress,
        "last_scan": _last_scan,
        "last_scan_date": last_scan_date,
        "last_scan_time": last_scan_time,
        "hours_since_last_scan": hours_since_last_scan,
        "scan_missing": scan_missing,
    }


@app.get("/api/scan/funnel")
async def get_scan_funnel():
    """
    Returns the filter funnel from the most recent scan.
    Falls back to live in-memory funnel if DB is empty (scan still running).
    """
    from backend.screener import get_last_funnel
    live = get_last_funnel()
    if live:
        return live

    db_funnel = get_latest_funnel()
    if db_funnel:
        return db_funnel.model_dump()

    return {"status": "no_funnel", "message": "No scan has run yet"}


@app.get("/api/scan/funnel/history")
async def get_funnel_history_endpoint(days: int = 30):
    """Returns funnel breakdowns for the last N days of scans."""
    funnels = get_funnel_history(days=days)
    return [f.model_dump() for f in funnels]


@app.get("/api/scan/by-module")
async def get_scan_by_module(
    date_str: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Candidate counts grouped by strategy_module and candidate_status for a given date.
    Useful for per-module waterfall diagnostics.
    """
    from collections import defaultdict
    scan_date = date.fromisoformat(date_str) if date_str else date.today()
    results = get_results_for_date(scan_date)

    if not results:
        # Try latest date
        latest = get_latest_scan_date()
        if latest:
            results = get_results_for_date(latest)
            scan_date = latest

    by_module: dict = defaultdict(lambda: {"active": 0, "watchlist_pending": 0, "filtered_avoid": 0, "direction_mismatch": 0, "user_ignored": 0, "other": 0, "total": 0})
    for r in results:
        mod = r.strategy_module or "Unknown"
        status = r.candidate_status or "other"
        if status in by_module[mod]:
            by_module[mod][status] += 1
        else:
            by_module[mod]["other"] += 1
        by_module[mod]["total"] += 1

    return {
        "scan_date": scan_date.isoformat(),
        "modules": [{"name": k, **v} for k, v in by_module.items()],
    }


# ---------------------------------------------------------------------------
# Post-Mortem Analyzer
# ---------------------------------------------------------------------------

@app.get("/api/scanner/post-mortem")
async def get_post_mortem(
    date_str: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Daily post-mortem: top gainers vs. scanner candidates.
    Categories: 'was_candidate' | 'good_reject' | 'missed' (blind spot).
    """
    from backend.database import PostMortemResult, get_engine
    from sqlmodel import Session, select as sql_select
    try:
        target_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat. Erwartet: YYYY-MM-DD.")
    with Session(get_engine()) as s:
        rows = s.exec(
            sql_select(PostMortemResult)
            .where(PostMortemResult.scan_date == target_date)
            .order_by(PostMortemResult.pct_change.desc())
        ).all()
    return {
        "date":    target_date.isoformat(),
        "results": [r.model_dump() for r in rows],
        "summary": {
            "was_candidate": sum(1 for r in rows if r.category == "was_candidate"),
            "good_reject":   sum(1 for r in rows if r.category == "good_reject"),
            "missed":        sum(1 for r in rows if r.category == "missed"),
        },
    }


def _run_post_mortem_sync() -> None:
    import asyncio
    from backend.scheduler import post_mortem_scan
    asyncio.run(post_mortem_scan({}))


@app.post("/api/scanner/post-mortem/trigger")
async def trigger_post_mortem(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Manually trigger the post-mortem scan (for testing)."""
    background_tasks.add_task(_run_post_mortem_sync)
    return {"status": "triggered"}


# ---------------------------------------------------------------------------
# Ghost Portfolio — Predictions (1.7)
# ---------------------------------------------------------------------------

@app.get("/api/predictions/stats")
async def get_prediction_stats_endpoint():
    """Aggregated Win/Loss/Timeout stats for all archived predictions."""
    from backend.database import get_prediction_stats
    return get_prediction_stats()


@app.get("/api/predictions")
async def list_predictions(
    status: Optional[str] = None,
    regime: Optional[str] = None,
    limit: int = 100,
):
    """
    List archived predictions.
    ?status=PENDING|WIN|LOSS|TIMEOUT
    ?regime=bull|bear|neutral
    """
    from backend.database import PredictionArchive
    from sqlmodel import Session, select
    from backend.database import get_engine

    with Session(get_engine()) as session:
        q = select(PredictionArchive)
        if status:
            q = q.where(PredictionArchive.status == status.upper())
        if regime:
            q = q.where(PredictionArchive.regime == regime)
        q = q.order_by(PredictionArchive.scan_date.desc()).limit(limit)
        preds = list(session.exec(q).all())

    return [p.model_dump() for p in preds]


# ---------------------------------------------------------------------------
# Ghost Portfolio — Positions (Issue #52)
# ---------------------------------------------------------------------------

# In-memory price cache: ticker -> (close_price, cache_date)
_ghost_price_cache: dict[str, tuple[float, date]] = {}


async def _get_cached_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch EOD prices for tickers via yfinance, cached once per day."""
    import asyncio as _asyncio
    from backend.providers.yfinance_provider import _snapshot_sync

    today = date.today()
    result: dict[str, float] = {}
    to_fetch: list[str] = []

    for ticker in tickers:
        if ticker in _ghost_price_cache:
            price, cached_date = _ghost_price_cache[ticker]
            if cached_date == today:
                result[ticker] = price
                continue
        to_fetch.append(ticker)

    if to_fetch:
        snapshots = await _asyncio.to_thread(_snapshot_sync, to_fetch)
        for snap in snapshots:
            _ghost_price_cache[snap["ticker"]] = (snap["close"], today)
            result[snap["ticker"]] = snap["close"]

    return result


@app.get("/api/ghost-portfolio/positions")
async def get_ghost_positions(
    status: Optional[str] = None,
    module: Optional[str] = None,
    regime: Optional[str] = None,
    candidate_status: Optional[str] = None,
    page: int = 1,
    sort_by: str = "scan_date",
    sort_dir: str = "desc",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """
    Paginated positions list for Ghost Portfolio tab.
    Enriches PENDING entries with cached yfinance EOD prices.
    """
    from backend.database import PredictionArchive
    from sqlmodel import Session, select, func
    from backend.database import get_engine

    page_size = 50

    with Session(get_engine()) as session:
        def _base_query():
            q = select(PredictionArchive)
            if status:
                q = q.where(PredictionArchive.status == status.upper())
            if module:
                q = q.where(PredictionArchive.strategy_module == module)
            if regime:
                q = q.where(PredictionArchive.regime == regime)
            if candidate_status:
                q = q.where(PredictionArchive.candidate_status == candidate_status)
            if date_from:
                q = q.where(PredictionArchive.scan_date >= date.fromisoformat(date_from))
            if date_to:
                q = q.where(PredictionArchive.scan_date <= date.fromisoformat(date_to))
            return q

        # Total count
        count_stmt = select(func.count()).select_from(_base_query().subquery())
        total: int = session.exec(count_stmt).one()

        # Sorted + paginated query
        data_q = _base_query()
        if sort_by == "duration":
            col = PredictionArchive.days_to_resolve
        else:
            col = PredictionArchive.scan_date

        if sort_dir == "asc":
            data_q = data_q.order_by(col.asc())
        else:
            data_q = data_q.order_by(col.desc())

        offset = (page - 1) * page_size
        data_q = data_q.offset(offset).limit(page_size)
        preds = list(session.exec(data_q).all())

    # Fetch current prices for PENDING entries
    pending_tickers = [p.ticker for p in preds if p.status == "PENDING"]
    current_prices = await _get_cached_prices(pending_tickers) if pending_tickers else {}

    items = []
    today = date.today()
    for p in preds:
        current_price = current_prices.get(p.ticker) if p.status == "PENDING" else None

        change_pct: Optional[float] = None
        change_abs: Optional[float] = None
        color = "neutral"

        if p.entry_price and current_price:
            change_pct = round((current_price - p.entry_price) / p.entry_price * 100, 2)
            change_abs = round(current_price - p.entry_price, 2)
            if current_price >= p.entry_price:
                color = "green"
            elif p.stop_loss and current_price <= p.stop_loss:
                color = "red"
            else:
                color = "yellow"

        sl_distance_pct: Optional[float] = None
        tp_distance_pct: Optional[float] = None
        if p.status == "PENDING" and current_price and p.entry_price:
            if p.stop_loss:
                sl_distance_pct = round((current_price - p.stop_loss) / current_price * 100, 2)
            if p.target_price:
                tp_distance_pct = round((p.target_price - current_price) / current_price * 100, 2)

        duration_days = (today - p.scan_date).days if p.scan_date else None

        exit_price: Optional[float] = None
        exit_date: Optional[str] = None
        if p.status in ("WIN", "LOSS", "TIMEOUT"):
            exit_price = p.resolved_price
            exit_date = str(p.resolved_at.date()) if p.resolved_at else None

        items.append({
            "id": p.id,
            "ticker": p.ticker,
            "module": p.strategy_module,
            "regime": p.regime,
            "scan_date": str(p.scan_date),
            "candidate_status": p.candidate_status,
            "entry_price": p.entry_price,
            "entry_low": p.entry_low,
            "entry_high": p.entry_high,
            "current_price": current_price,
            "change_pct": change_pct,
            "change_abs": change_abs,
            "stop_loss": p.stop_loss,
            "target_price": p.target_price,
            "crv": p.crv,
            "duration_days": duration_days,
            "status": p.status,
            "exit_price": exit_price,
            "exit_date": exit_date,
            "sl_distance_pct": sl_distance_pct,
            "tp_distance_pct": tp_distance_pct,
            "color": color,
            "confidence": p.confidence,
        })

    # Post-fetch sort for performance (change_pct)
    if sort_by == "performance":
        reverse = sort_dir != "asc"
        items.sort(key=lambda x: x["change_pct"] if x["change_pct"] is not None else float("-inf"), reverse=reverse)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "items": items,
    }


# ---------------------------------------------------------------------------
# Filter Profiles
# ---------------------------------------------------------------------------

@app.get("/api/filters")
async def list_filters():
    return [f.model_dump() for f in get_all_filters()]


@app.get("/api/filters/active")
async def get_active_filter_endpoint():
    fp = get_active_filter()
    return fp.model_dump() if fp else None


@app.post("/api/filters")
async def create_filter(data: dict):
    fp = FilterProfile(**{k: v for k, v in data.items() if hasattr(FilterProfile, k)})
    saved = save_filter(fp)
    return saved.model_dump()


@app.put("/api/filters/{filter_id}")
async def update_filter_endpoint(filter_id: int, data: dict):
    updated = update_filter(filter_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Filter not found")
    return updated.model_dump()


@app.delete("/api/filters/{filter_id}")
async def delete_filter_endpoint(filter_id: int):
    delete_filter(filter_id)
    return {"status": "deleted"}


@app.post("/api/filters/{filter_id}/activate")
async def activate_filter_endpoint(filter_id: int):
    activate_filter(filter_id)
    return {"status": "activated"}


# ---------------------------------------------------------------------------
# Strategy Modules (v2.5)
# ---------------------------------------------------------------------------

@app.get("/api/strategy-modules")
async def list_strategy_modules():
    """Return all strategy modules with their current config."""
    from backend.market_regime import get_current_regime
    current_regime = get_current_regime()
    modules = get_all_modules()
    return {
        "current_regime": current_regime,
        "modules": [m.model_dump() for m in modules],
        "active_for_regime": [
            m.model_dump() for m in modules
            if m.is_active and m.auto_activate and m.regime in (current_regime, "any")
        ],
    }


@app.get("/api/strategy-modules/{module_id}")
async def get_strategy_module(module_id: int):
    from backend.database import get_module
    m = get_module(module_id)
    if not m:
        raise HTTPException(status_code=404, detail="Module not found")
    return m.model_dump()


@app.put("/api/strategy-modules/{module_id}")
async def update_strategy_module(module_id: int, data: dict):
    m = update_module(module_id, data)
    if not m:
        raise HTTPException(status_code=404, detail="Module not found")
    return m.model_dump()


@app.post("/api/strategy-modules/{module_id}/toggle")
async def toggle_strategy_module(module_id: int):
    from backend.database import get_module
    m = get_module(module_id)
    if not m:
        raise HTTPException(status_code=404, detail="Module not found")
    updated = update_module(module_id, {"is_active": not m.is_active})
    return {"id": module_id, "is_active": updated.is_active}


# ---------------------------------------------------------------------------
# Portfolio — Budget
# ---------------------------------------------------------------------------

@app.get("/api/portfolio/budget")
async def get_budget_endpoint():
    return get_budget().model_dump()


@app.put("/api/portfolio/budget")
async def update_budget_endpoint(data: dict):
    updated = update_budget(data)
    return updated.model_dump()


# ---------------------------------------------------------------------------
# Portfolio — Summary & Positions
# ---------------------------------------------------------------------------

@app.get("/api/portfolio")
async def get_portfolio():
    summary = get_portfolio_summary()
    open_positions = get_open_positions()

    # Fetch live prices for all open positions (yfinance, best-effort)
    live_prices: dict = {}
    if open_positions:
        try:
            from backend.providers import get_data_provider
            import asyncio as _asyncio

            provider = get_data_provider()

            async def _fetch_price(ticker: str):
                try:
                    df = await provider.get_daily_bars(ticker, days=3)
                    if df is not None and not df.empty:
                        return ticker, float(df.iloc[-1]["Close"])
                except Exception:
                    pass
                return ticker, None

            tasks = [_fetch_price(p.ticker) for p in open_positions]
            results = await _asyncio.gather(*tasks, return_exceptions=True)
            for item in results:
                if isinstance(item, tuple):
                    t, price = item
                    if price is not None:
                        live_prices[t] = price
        except Exception as exc:
            logger.warning("Live price fetch failed: %s", exc)

    enriched = []
    for pos in open_positions:
        signals = get_signals_for_position(pos.id)
        data = enrich_position(pos, current_price=live_prices.get(pos.ticker))
        data["signals"] = [s.model_dump() for s in signals]
        enriched.append(data)

    summary["positions"] = enriched
    return summary


@app.post("/api/portfolio")
async def add_position(data: dict):
    try:
        return create_position(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/api/portfolio/{position_id}")
async def update_position_endpoint(position_id: int, data: dict):
    updated = update_position(position_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Position not found")
    return updated.model_dump()


@app.post("/api/portfolio/{position_id}/close")
async def close_position_endpoint(position_id: int, data: dict):
    try:
        return close_position(
            position_id,
            float(data["exit_price"]),
            data.get("exit_reason", "manual"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/portfolio/{position_id}/signals")
async def get_position_signals(position_id: int):
    return [s.model_dump() for s in get_signals_for_position(position_id)]


@app.get("/api/portfolio/history")
async def get_portfolio_history():
    return [p.model_dump() for p in get_closed_positions()]


@app.post("/api/portfolio/ai-check")
async def portfolio_ai_check(background_tasks: BackgroundTasks):
    from backend.portfolio_ai import run_portfolio_ai_check
    result = await run_portfolio_ai_check()
    if result is None:
        raise HTTPException(status_code=500, detail="AI check failed")
    return result


@app.post("/api/portfolio/position-size")
async def calculate_position_size(data: dict):
    try:
        result = calculate_position(
            entry_price=float(data["entry_price"]),
            stop_loss=float(data["stop_loss"]),
            target=float(data["target"]),
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Portfolio — Trade Settings
# ---------------------------------------------------------------------------

@app.post("/api/portfolio/preview-setting")
async def preview_trade_setting(data: dict):
    """Generate a trade setting preview without saving (~$0.02, ~3s)."""
    from backend.trade_setting import generate_trade_setting, assess_position_size
    try:
        budget = get_budget()
        setting = generate_trade_setting(
            ticker=data.get("ticker", "UNKNOWN"),
            trade_type=data.get("trade_type", "swing"),
            entry_price=float(data["entry_price"]),
            shares=float(data.get("shares", 1)),
            budget_total=budget.start_budget,
            risk_per_trade_pct=budget.risk_per_trade_pct,
            setup_type=data.get("setup_type", "breakout"),
            atr=float(data.get("atr", 1.0)),
            rsi=float(data.get("rsi", 60.0)),
            days_until_earnings=data.get("days_until_earnings"),
            market_regime=data.get("market_regime", "neutral"),
            support=float(data["support"]) if data.get("support") else None,
            resistance=float(data["resistance"]) if data.get("resistance") else None,
            volume_ratio=float(data["volume_ratio"]) if data.get("volume_ratio") else None,
            pattern_name=data.get("pattern_name"),
            research_score=data.get("research_score"),
            analyst_rating=data.get("analyst_rating"),
            insider_activity=data.get("insider_activity"),
            fundamental_context=data.get("fundamental_context"),
        )
        # Append position size warning if applicable
        warning = assess_position_size(
            entry_price=float(data["entry_price"]),
            shares=float(data.get("shares", 1)),
            stop_loss=float(data.get("stop_loss", data["entry_price"])),
            budget_total=budget.start_budget,
            risk_per_trade_pct=budget.risk_per_trade_pct,
            sector=data.get("sector"),
            max_sector_exposure_pct=budget.max_sector_exposure_pct,
        )
        setting["_position_size_warning"] = warning
        return setting
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/portfolio/{position_id}/setting")
async def get_position_setting(position_id: int):
    """Return the trade setting JSON for a position."""
    pos = get_position(position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    if not pos.action_setting_json:
        raise HTTPException(status_code=404, detail="No trade setting for this position")
    try:
        return json.loads(pos.action_setting_json)
    except Exception:
        return {"raw": pos.action_setting_json}


@app.post("/api/portfolio/{position_id}/setting/refresh")
async def refresh_position_setting(position_id: int, data: dict):
    """Regenerate trade setting with current market data and save it."""
    from backend.trade_setting import generate_trade_setting, assess_position_size
    from datetime import datetime as _dt
    pos = get_position(position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    try:
        budget = get_budget()
        setting = generate_trade_setting(
            ticker=pos.ticker,
            trade_type=pos.trade_type or data.get("trade_type", "swing"),
            entry_price=pos.entry_price,
            shares=pos.shares,
            budget_total=budget.start_budget,
            risk_per_trade_pct=budget.risk_per_trade_pct,
            setup_type=pos.setup_type or "breakout",
            atr=float(data.get("atr", 1.0)),
            rsi=float(data.get("rsi", 60.0)),
            days_until_earnings=data.get("days_until_earnings"),
            market_regime=data.get("market_regime", "neutral"),
        )
        import json as _json
        update_position(position_id, {
            "action_setting_json": _json.dumps(setting),
            "setting_generated_at": _dt.utcnow().isoformat(),
        })
        warning = assess_position_size(
            entry_price=pos.entry_price,
            shares=pos.shares,
            stop_loss=pos.stop_loss,
            budget_total=budget.start_budget,
            risk_per_trade_pct=budget.risk_per_trade_pct,
            sector=pos.sector,
            max_sector_exposure_pct=budget.max_sector_exposure_pct,
        )
        setting["_position_size_warning"] = warning
        return setting
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Portfolio — Market Update
# ---------------------------------------------------------------------------

@app.get("/api/portfolio/market-update")
async def get_market_update():
    """Return the latest market update from DB."""
    update = get_latest_market_update()
    if not update:
        return {"status": "no_update", "message": "Noch kein Market Update vorhanden"}
    data = update.model_dump()
    # Parse JSON fields for frontend convenience
    for field in ("sector_movers_json", "positions_affected_json", "critical_alerts_json",
                  "recommendations_json"):
        if data.get(field):
            try:
                data[field.replace("_json", "")] = json.loads(data[field])
            except Exception:
                pass
    return data


@app.post("/api/portfolio/market-update/refresh")
async def refresh_market_update():
    """Generate a live market update (~$0.03, ~3s)."""
    from backend.market_update import get_market_context, generate_market_update
    from backend.portfolio import enrich_position
    try:
        context = get_market_context()
        open_positions = get_open_positions()
        positions_data = []
        for pos in open_positions:
            enriched = enrich_position(pos)
            positions_data.append({
                "ticker": pos.ticker,
                "trade_type": pos.trade_type or "swing",
                "entry": pos.entry_price,
                "current": enriched.get("current_price", pos.entry_price),
                "stop_loss": pos.stop_loss,
                "target_1": pos.target_1,
                "target_2": pos.target_2,
                "pnl_pct": enriched.get("unrealized_pct", 0),
                "days_held": enriched.get("days_in_trade", 0),
                "sector": pos.sector,
                "trade_type_label": pos.trade_type or "swing",
                "hold_days_max": pos.hold_days_max,
            })
        update = await generate_market_update(positions_data, context, update_type="manual")
        data = update.model_dump()
        for field in ("sector_movers_json", "positions_affected_json", "critical_alerts_json",
                      "recommendations_json"):
            if data.get(field):
                try:
                    data[field.replace("_json", "")] = json.loads(data[field])
                except Exception:
                    pass
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/portfolio/market-update/history")
async def market_update_history(days: int = 7):
    updates = get_market_update_history(days=days)
    result = []
    for update in updates:
        data = update.model_dump()
        for field in ("sector_movers_json", "critical_alerts_json"):
            if data.get(field):
                try:
                    data[field.replace("_json", "")] = json.loads(data[field])
                except Exception:
                    pass
        result.append(data)
    return result



# ---------------------------------------------------------------------------
# FX Rates
# ---------------------------------------------------------------------------

@app.get("/api/fx/eurusd")
async def get_eurusd_rate():
    """Return current EUR/USD exchange rate from yfinance (EURUSD=X). Fallback: 1.09."""
    import asyncio
    import yfinance as yf

    def _fetch():
        try:
            ticker = yf.Ticker("EURUSD=X")
            hist = ticker.history(period="1d")
            if hist is not None and not hist.empty:
                rate = float(hist.iloc[-1]["Close"])
                return {"rate": round(rate, 4), "source": "yfinance"}
        except Exception:
            pass
        return {"rate": 1.09, "source": "fallback"}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch)


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

@app.get("/api/journal")
async def list_journal(
    ticker: Optional[str] = None,
    setup_type: Optional[str] = None,
    followed_rules: Optional[bool] = None,
):
    entries = get_journal_entries(ticker=ticker, setup_type=setup_type, followed_rules=followed_rules)
    return [e.model_dump() for e in entries]


@app.post("/api/journal")
async def create_journal_entry_endpoint(data: dict):
    try:
        entry = create_journal_entry(data)
        return entry.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/api/journal/{entry_id}")
async def update_journal_endpoint(entry_id: int, data: dict):
    try:
        updated = update_lesson(entry_id, data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return updated.model_dump()


@app.get("/api/journal/stats")
async def journal_stats():
    return get_journal_stats()


@app.get("/api/journal/export.csv")
async def export_journal_csv(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Export all journal entries as CSV (UTF-8 with BOM for Excel)."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    entries = get_journal_entries()
    fields = [
        "id", "trade_date", "ticker", "setup_type", "source", "entry_price", "stop_loss",
        "target", "risk_eur", "risk_reward", "position_size", "exit_price",
        "exit_date", "pnl_eur", "pnl_pct", "followed_rules", "emotion_entry",
        "emotion_exit", "setup_reason", "lesson", "mistakes", "created_at",
    ]
    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM for Excel
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for e in entries:
        writer.writerow({f: getattr(e, f, None) for f in fields})

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=journal_export.csv"},
    )


@app.get("/api/journal/{entry_id}/replay-chart")
async def get_replay_chart(entry_id: int):
    entry = get_journal_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    from backend.screener import fetch_ohlcv, compute_indicators
    from backend.chart_fetcher import render_replay_chart

    df = await fetch_ohlcv(entry.ticker, days=90)
    if df is None:
        raise HTTPException(status_code=404, detail="No price data available")

    df = compute_indicators(df)
    chart_path = render_replay_chart(
        ticker=entry.ticker,
        df=df,
        entry_date=entry.trade_date,
        entry_price=entry.entry_price,
        stop_loss=entry.stop_loss,
        exit_date=entry.exit_date,
        exit_price=entry.exit_price,
    )
    return FileResponse(chart_path, media_type="image/png")


# ---------------------------------------------------------------------------
# Performance
# ---------------------------------------------------------------------------

@app.get("/api/performance/summary")
async def performance_summary():
    return get_performance_summary()


@app.get("/api/performance/by-setup")
async def performance_by_setup():
    return get_performance_by_setup()


@app.get("/api/performance/equity-curve")
async def equity_curve():
    return get_equity_curve()


@app.get("/api/performance/flags")
async def performance_by_flags():
    from backend.performance import get_performance_by_flags
    return get_performance_by_flags()


@app.get("/api/performance/crv-validation")
async def crv_validation():
    from backend.performance import get_crv_validation
    return get_crv_validation()


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

@app.get("/api/history/calendar")
async def history_calendar():
    scan_dates = get_scan_dates()
    result = []
    for d in scan_dates:
        results = get_results_for_date(d)
        result.append({
            "date": d.isoformat(),
            "count": len(results),
            "setup_types": list(set(r.setup_type for r in results)),
        })
    return result


@app.get("/api/history/{date_str}")
async def history_for_date(date_str: str):
    try:
        scan_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")
    results = get_results_for_date(scan_date)
    return [r.model_dump() for r in results]


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

@app.get("/api/watchlist")
async def list_watchlist():
    return await get_watchlist_with_prices()


@app.post("/api/watchlist")
async def add_watchlist_item(data: dict):
    try:
        item = add_to_watchlist(data)
        return item.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/api/watchlist/{item_id}")
async def edit_watchlist_item(item_id: int, data: dict):
    updated = update_watchlist_item(item_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    return updated.model_dump()


@app.delete("/api/watchlist/{item_id}")
async def remove_watchlist_item(item_id: int):
    delete_watchlist_item(item_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Scanner Settings (Phase 2b)
# ---------------------------------------------------------------------------

@app.get("/api/settings/scanner")
async def get_scanner_settings(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return current scanner configuration (read from config/env)."""
    return {
        "data_provider":   settings.data_provider,
        "stock_universe":  settings.stock_universe,
        "min_price":       settings.min_price,
        "min_volume":      settings.min_volume,
        "max_candidates":  settings.max_candidates,
        "scan_time_utc":   settings.scan_time_utc,
    }


# ---------------------------------------------------------------------------
# AI Health & API Key Management
# ---------------------------------------------------------------------------

@app.get("/api/health/ai")
async def get_ai_health(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return current Claude API health status (last stored error)."""
    from backend.database import get_ai_status
    status = get_ai_status()
    # Add key-set indicator (never return the actual key)
    status["key_set"] = bool(settings.anthropic_api_key)
    return status


@app.put("/api/settings/anthropic-key")
async def update_anthropic_key(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Save ANTHROPIC_API_KEY to DB (persists across container rebuilds).
    Also updates in-process setting so the scanner picks it up immediately.
    Body: { "api_key": "sk-ant-..." }
    """
    from backend.database import clear_ai_error, set_anthropic_api_key

    api_key = (data.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=422, detail="api_key darf nicht leer sein")
    if not api_key.startswith("sk-ant-"):
        raise HTTPException(status_code=422, detail="Ungültiges Key-Format (erwartet sk-ant-…)")

    set_anthropic_api_key(api_key)
    settings.anthropic_api_key = api_key  # update in-process immediately
    clear_ai_error()

    logger.info("ANTHROPIC_API_KEY updated via Settings UI (stored in DB)")
    return {"status": "saved"}


@app.get("/api/settings/ntfy")
async def get_ntfy_settings(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return current ntfy.sh configuration."""
    from backend.database import get_ntfy_alerts, get_ntfy_topic
    alerts = get_ntfy_alerts()
    topic = get_ntfy_topic() or settings.ntfy_topic  # DB takes precedence, .env as fallback
    return {
        "topic": topic,
        "topic_set": bool(topic),
        **alerts,
    }


@app.put("/api/settings/ntfy")
async def update_ntfy_settings(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Save ntfy topic and alert flags to DB (persists across container rebuilds)."""
    from backend.database import set_ntfy_alerts, set_ntfy_topic

    topic = data.get("topic", "").strip()
    if topic:
        set_ntfy_topic(topic)
        settings.ntfy_topic = topic  # update in-process immediately

    set_ntfy_alerts({
        "alerts_scan":        bool(data.get("alerts_scan", True)),
        "alerts_entry_zone":  bool(data.get("alerts_entry_zone", True)),
        "alerts_regime":      bool(data.get("alerts_regime", True)),
    })
    return {"status": "saved"}


@app.post("/api/settings/ntfy/test")
async def test_ntfy(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Send a test push notification via ntfy.sh."""
    from backend.database import get_ntfy_topic
    from backend.notifier import send_push
    topic = get_ntfy_topic() or settings.ntfy_topic
    if not topic:
        raise HTTPException(status_code=400, detail="Kein ntfy-Topic konfiguriert")
    ok = send_push(
        title="✅ Swing Scanner — Test",
        message="Push-Notifications funktionieren!",
        priority="default",
        tags="white_check_mark",
    )
    if ok:
        return {"status": "sent"}
    raise HTTPException(status_code=500, detail="ntfy-Request fehlgeschlagen")


@app.post("/api/settings/anthropic-key/test")
async def test_anthropic_key(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Test a given (or current) ANTHROPIC_API_KEY with a minimal 1-token request.
    Body: { "api_key": "sk-ant-..." }  — omit to test the currently configured key.
    """
    import anthropic as _anthropic

    api_key = (data.get("api_key") or "").strip() or settings.anthropic_api_key
    if not api_key:
        return {"ok": False, "error": "Kein API-Key konfiguriert"}

    try:
        client = _anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model=settings.claude_model,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        # Clear any stored error on successful test
        from backend.database import clear_ai_error
        clear_ai_error()
        return {"ok": True}
    except _anthropic.AuthenticationError as exc:
        return {"ok": False, "error": f"Authentifizierung fehlgeschlagen: {exc}"}
    except _anthropic.APIStatusError as exc:
        msg = str(exc)
        if "credit" in msg.lower() or "quota" in msg.lower() or "billing" in msg.lower():
            from backend.database import set_ai_error
            set_ai_error(str(exc))
            return {"ok": False, "error": f"Budget erschöpft: {exc}"}
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Feature Flags API (Phase 3)
# ---------------------------------------------------------------------------

@app.get("/api/settings/feature-flags")
async def get_feature_flags(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return current feature-flag settings (stored in AppSettings/SQLite)."""
    from backend.database import get_paper_auto_trading
    return {
        "paper_auto_trading": get_paper_auto_trading(),
    }


@app.put("/api/settings/feature-flags")
async def update_feature_flags(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Update feature flags.
    Body: { "paper_auto_trading": true|false }
    Stores in AppSettings (SQLite) — survives container rebuilds.
    """
    from backend.database import set_paper_auto_trading
    if "paper_auto_trading" in data:
        set_paper_auto_trading(bool(data["paper_auto_trading"]))
    return {"status": "saved"}


# ---------------------------------------------------------------------------
# Trading — Orders (Phase 3)
# ---------------------------------------------------------------------------

@app.get("/api/orders/account")
async def get_trading_account(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return Alpaca account info (buying power, portfolio value, etc.)."""
    from backend.trading import get_account_info
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        return get_account_info(creds)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/orders")
async def list_open_orders(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return all open orders from Alpaca."""
    from backend.trading import get_open_orders
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        return get_open_orders(creds)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/orders/bracket")
async def place_bracket_order(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Place a bracket order (limit entry + take-profit + stop-loss).
    Body: { ticker, qty, limit_price, take_profit, stop_loss }
    """
    from backend.trading import place_bracket_order as _place
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        order = _place(
            creds,
            ticker=data["ticker"],
            qty=float(data["qty"]),
            limit_price=float(data["limit_price"]),
            take_profit_price=float(data["take_profit"]),
            stop_loss_price=float(data["stop_loss"]),
        )
        return order
    except KeyError as e:
        raise HTTPException(status_code=422, detail=f"Missing field: {e}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/orders/{order_id}")
async def cancel_order(
    order_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Cancel an open order by ID."""
    from backend.trading import cancel_order as _cancel
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        _cancel(creds, order_id)
        return {"status": "cancelled", "order_id": order_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.patch("/api/orders/{order_id}")
async def modify_order(
    order_id: str,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Modify an existing open order (change TP limit price or SL stop price).
    Body: { limit_price?: float, stop_price?: float }
    """
    from backend.trading import replace_order as _replace
    limit_price = data.get("limit_price")
    stop_price  = data.get("stop_price")
    if limit_price is None and stop_price is None:
        raise HTTPException(status_code=422, detail="limit_price oder stop_price erforderlich")
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        updated = _replace(
            creds,
            order_id,
            limit_price=float(limit_price) if limit_price is not None else None,
            stop_price=float(stop_price) if stop_price is not None else None,
        )
        return updated
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/orders/single")
async def place_single_order(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Place a standalone single-leg order for an existing position.
    Body: { ticker, qty, type: "limit_sell" | "stop_sell", price }
    """
    from backend.trading import place_limit_sell as _limit, place_stop_sell as _stop
    ticker    = data.get("ticker")
    qty       = data.get("qty")
    order_type = data.get("type")
    price     = data.get("price")
    if not ticker or not qty or not order_type or not price:
        raise HTTPException(status_code=422, detail="ticker, qty, type und price erforderlich")
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        if order_type == "limit_sell":
            order = _limit(creds, ticker=ticker, qty=float(qty), limit_price=float(price))
        elif order_type == "stop_sell":
            order = _stop(creds, ticker=ticker, qty=float(qty), stop_price=float(price))
        else:
            raise HTTPException(status_code=422, detail=f"Unbekannter Ordertyp: {order_type}")
        return order
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/quotes")
async def get_live_quotes(
    symbols: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Fetch latest prices + volume ratio for comma-separated symbols via yfinance.
    Returns { AAPL: { price: 182.50, volume_ratio: 1.4 }, MSFT: { price: null, volume_ratio: null }, ... }
    """
    import asyncio
    import yfinance as yf

    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {}

    def _fetch() -> dict:
        result: dict = {}
        for sym in syms:
            try:
                info = yf.Ticker(sym).fast_info
                price = getattr(info, "last_price", None)
                current_vol = getattr(info, "regular_market_volume", None)
                avg_vol = getattr(info, "three_month_average_volume", None)
                vol_ratio = round(current_vol / avg_vol, 1) if (current_vol and avg_vol and avg_vol > 0) else None
                result[sym] = {
                    "price": round(float(price), 2) if price else None,
                    "volume_ratio": vol_ratio,
                }
            except Exception:
                result[sym] = {"price": None, "volume_ratio": None}
        return result

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch)


# ---------------------------------------------------------------------------
# Alpaca Positions + Market Sell
# ---------------------------------------------------------------------------

@app.get("/api/portfolio/alpaca")
async def get_alpaca_positions(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Return all open Alpaca positions for the current user."""
    from backend.trading import get_alpaca_positions as _get_positions
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        return _get_positions(creds)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Research Endpoint (yfinance — BigData.com als Drop-in geplant)
# ---------------------------------------------------------------------------

def _fetch_rss_news(sym: str, limit: int = 8) -> list[dict]:
    """Fetch news from Yahoo Finance RSS — free, no API key, more reliable than yfinance.news."""
    import urllib.request
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as r:
            root = ET.fromstring(r.read())
        result = []
        for item in root.findall(".//item")[:limit]:
            pub_raw = item.findtext("pubDate", "")
            try:
                pub_ts = int(parsedate_to_datetime(pub_raw).timestamp()) if pub_raw else None
            except Exception:
                pub_ts = None
            result.append({
                "title":        item.findtext("title", "").strip(),
                "link":         item.findtext("link", "").strip(),
                "publisher":    "Yahoo Finance",
                "published_ts": pub_ts,
            })
        return result
    except Exception:
        return []


@app.get("/api/research/{ticker}")
async def research_ticker(
    ticker: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Return fundamentals, performance, earnings date and news for a ticker.
    Data source: yfinance (free). BigData.com integration planned as Phase 2.
    """
    import asyncio
    import yfinance as yf
    import pandas as pd

    sym = ticker.upper().strip()

    def _fetch():
        t = yf.Ticker(sym)
        info = {}
        hist = None
        cal = {}
        news = []
        try:
            info = t.info or {}
        except Exception:
            pass
        try:
            hist = t.history(period="1y")
        except Exception:
            pass
        try:
            cal = t.calendar or {}
        except Exception:
            pass
        try:
            news = _fetch_rss_news(sym)
        except Exception:
            pass
        return info, hist, cal, news

    loop = asyncio.get_event_loop()
    try:
        info, hist, cal, news = await loop.run_in_executor(None, _fetch)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Ticker nicht gefunden: {exc}")

    if not info:
        raise HTTPException(status_code=404, detail=f"Keine Daten für {sym}")

    # --- Price performance ---
    perf: dict = {}
    if hist is not None and not hist.empty:
        close = hist["Close"]
        # Strip timezone for date comparison
        idx = close.index
        if idx.tz is not None:
            idx = idx.tz_localize(None)
        close.index = idx

        current_price = float(close.iloc[-1])
        now = pd.Timestamp.now()

        def _pct(days_ago):
            past = close[close.index <= now - pd.Timedelta(days=days_ago)]
            if past.empty:
                return None
            old = float(past.iloc[-1])
            return round((current_price - old) / old * 100, 2) if old else None

        ytd_start = pd.Timestamp(now.year, 1, 1)
        ytd_past = close[close.index <= ytd_start]
        ytd_old = float(ytd_past.iloc[-1]) if not ytd_past.empty else None

        perf = {
            "current": round(current_price, 2),
            "change_1m": _pct(30),
            "change_3m": _pct(90),
            "change_6m": _pct(180),
            "change_ytd": round((current_price - ytd_old) / ytd_old * 100, 2) if ytd_old else None,
            "change_1y": _pct(365),
        }

    # --- Next earnings date ---
    next_earnings = None
    earnings_in_days = None
    try:
        from datetime import date as _date
        today = _date.today()
        earnings_dates = cal.get("Earnings Date") or []
        if not isinstance(earnings_dates, list):
            earnings_dates = [earnings_dates]
        for ed in earnings_dates:
            ed_date = ed.date() if hasattr(ed, "date") else _date.fromisoformat(str(ed)[:10])
            if ed_date >= today:
                next_earnings = ed_date.isoformat()
                earnings_in_days = (ed_date - today).days
                break
    except Exception:
        pass

    # --- News ---
    news_items = []
    for n in (news or [])[:8]:
        title = (n.get("title") or "").strip()
        if not title:
            continue
        pub_ts = n.get("providerPublishTime")
        news_items.append({
            "title": title,
            "publisher": n.get("publisher", ""),
            "link": n.get("link", ""),
            "published_ts": pub_ts,
        })

    # --- Market cap formatting ---
    def _fmt_cap(v):
        if not v:
            return None
        if v >= 1e12:
            return f"${v / 1e12:.2f}T"
        if v >= 1e9:
            return f"${v / 1e9:.1f}B"
        return f"${v / 1e6:.0f}M"

    return {
        "ticker": sym,
        "name": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "exchange": info.get("exchange"),
        "website": info.get("website"),
        "employees": info.get("fullTimeEmployees"),
        "description": (info.get("longBusinessSummary") or "")[:700],
        "market_cap": _fmt_cap(info.get("marketCap")),
        "pe_ratio": round(float(info["trailingPE"]), 1) if info.get("trailingPE") else None,
        "forward_pe": round(float(info["forwardPE"]), 1) if info.get("forwardPE") else None,
        "beta": round(float(info["beta"]), 2) if info.get("beta") else None,
        "dividend_yield": round(float(info["dividendYield"]) * 100, 2) if info.get("dividendYield") else None,
        "w52_high": info.get("fiftyTwoWeekHigh"),
        "w52_low": info.get("fiftyTwoWeekLow"),
        "avg_volume": info.get("averageVolume"),
        "float_shares": info.get("floatShares"),
        "short_float": round(float(info["shortPercentOfFloat"]) * 100, 1) if info.get("shortPercentOfFloat") else None,
        "next_earnings": next_earnings,
        "earnings_in_days": earnings_in_days,
        "performance": perf,
        "news": news_items,
        "bigdata_available": False,  # Phase 2: BigData.com drop-in
    }


@app.get("/api/research/{ticker}/seasonal")
async def research_seasonal(
    ticker: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Monthly seasonality: 10 years of daily OHLCV → average return per calendar month.
    Returns avg_return, positive_years / total_years per month.
    """
    import asyncio
    import yfinance as yf

    sym = ticker.upper().strip()
    MONTH_LABELS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
                    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]

    def _fetch():
        t = yf.Ticker(sym)
        hist = t.history(period="10y")
        return hist

    loop = asyncio.get_event_loop()
    try:
        hist = await loop.run_in_executor(None, _fetch)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fehler bei {sym}: {exc}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"Keine Daten für {sym}")

    # Strip timezone
    hist.index = hist.index.tz_localize(None) if hist.index.tz else hist.index

    # Resample to month-start, compute monthly returns
    monthly_close = hist["Close"].resample("MS").last()
    monthly_returns = monthly_close.pct_change().dropna() * 100  # percent

    # Group by calendar month (1–12)
    results = []
    for m in range(1, 13):
        month_data = monthly_returns[monthly_returns.index.month == m]
        if month_data.empty:
            avg_return = None
            positive_years = 0
            total_years = 0
        else:
            avg_return = round(float(month_data.mean()), 2)
            positive_years = int((month_data > 0).sum())
            total_years = len(month_data)
        results.append({
            "month": m,
            "label": MONTH_LABELS[m - 1],
            "avg_return": avg_return,
            "positive_years": positive_years,
            "total_years": total_years,
        })

    # Only consider months that actually have data
    months_with_data = [r for r in results if r["avg_return"] is not None]
    best  = max(months_with_data, key=lambda x: x["avg_return"]) if months_with_data else None
    worst = min(months_with_data, key=lambda x: x["avg_return"]) if months_with_data else None

    return {
        "ticker": sym,
        "monthly_returns": results,
        "best_month":  {"month": best["month"],  "label": best["label"]}  if best  else None,
        "worst_month": {"month": worst["month"], "label": worst["label"]} if worst else None,
        "data_years": int(monthly_returns.index.year.nunique()),
    }


@app.get("/api/research/{ticker}/financials")
async def research_financials(
    ticker: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Analyst consensus + quarterly income statement (lazy, fetched on demand).
    Data source: yfinance (free). Returns analyst target/recommendation + last 4 quarters IS.
    """
    import asyncio
    import yfinance as yf

    sym = ticker.upper().strip()

    def _fetch():
        t    = yf.Ticker(sym)
        info = t.info or {}

        analyst = {
            "target_price":   info.get("targetMeanPrice"),
            "target_high":    info.get("targetHighPrice"),
            "target_low":     info.get("targetLowPrice"),
            "recommendation": info.get("recommendationKey"),
            "num_analysts":   info.get("numberOfAnalystOpinions"),
            "current_price":  info.get("currentPrice") or info.get("regularMarketPrice"),
        }

        def _safe(df, row, col):
            try:
                return float(df.loc[row, col])
            except Exception:
                return None

        quarters = []
        try:
            qis = t.quarterly_income_stmt
            if qis is not None and not qis.empty:
                for col in qis.columns[:4]:
                    quarters.append({
                        "period":       str(col.date()),
                        "revenue":      _safe(qis, "Total Revenue",  col),
                        "gross_profit": _safe(qis, "Gross Profit",   col),
                        "net_income":   _safe(qis, "Net Income",     col),
                        "ebitda":       _safe(qis, "EBITDA",         col),
                    })
        except Exception:
            pass

        return analyst, quarters

    loop = asyncio.get_event_loop()
    try:
        analyst, quarters = await loop.run_in_executor(None, _fetch)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"analyst": analyst, "quarters": quarters}


@app.post("/api/research/{symbol}/chat")
async def research_chat(
    symbol: str,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Interactive AI chat for a specific ticker with full market context.
    Body: { "message": str, "history": [{"role": "user"|"assistant", "content": str}] }
    Returns: { "reply": str, "suggested_plan": {...} | null, "tokens_used": int }
    """
    import asyncio
    import re
    import anthropic
    import yfinance as yf
    import pandas as pd

    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Kein ANTHROPIC_API_KEY konfiguriert")

    sym = symbol.upper().strip()
    message = (data.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message darf nicht leer sein")

    # Cap history to last 10 turns to avoid token spikes
    history = data.get("history", [])[-10:]

    # ── Fetch ticker context (fundamentals + news) ──────────────────────────
    def _fetch_context():
        t = yf.Ticker(sym)
        info: dict = {}
        hist_1y = None
        hist_1y_full = None
        cal: dict = {}
        news = []
        try:
            info = t.info or {}
        except Exception:
            pass
        try:
            hist_1y = t.history(period="1y")
        except Exception:
            pass
        try:
            cal = t.calendar or {}
        except Exception:
            pass
        try:
            news = _fetch_rss_news(sym, limit=5)
        except Exception:
            pass
        return info, hist_1y, cal, news

    loop = asyncio.get_event_loop()
    try:
        info, hist_1y, cal, news = await loop.run_in_executor(None, _fetch_context)
    except Exception:
        info, hist_1y, cal, news = {}, None, {}, []

    # Current price + performance
    current_price = None
    perf_1m = perf_3m = perf_ytd = None
    sma50 = sma200 = None

    if hist_1y is not None and not hist_1y.empty:
        close = hist_1y["Close"]
        if close.index.tz is not None:
            close.index = close.index.tz_localize(None)
        current_price = float(close.iloc[-1])
        now = pd.Timestamp.now()

        def _pct(days_ago):
            past = close[close.index <= now - pd.Timedelta(days=days_ago)]
            if past.empty:
                return None
            old = float(past.iloc[-1])
            return round((current_price - old) / old * 100, 1) if old else None

        perf_1m = _pct(30)
        perf_3m = _pct(90)
        ytd_past = close[close.index <= pd.Timestamp(now.year, 1, 1)]
        if not ytd_past.empty:
            ytd_old = float(ytd_past.iloc[-1])
            perf_ytd = round((current_price - ytd_old) / ytd_old * 100, 1) if ytd_old else None

        # SMA50 / SMA200 — last valid value
        sma50_series = close.rolling(50).mean().dropna()
        sma200_series = close.rolling(200).mean().dropna()
        if not sma50_series.empty:
            sma50 = round(float(sma50_series.iloc[-1]), 2)
        if not sma200_series.empty:
            sma200 = round(float(sma200_series.iloc[-1]), 2)

    # Next earnings
    next_earnings = None
    earnings_in_days = None
    try:
        from datetime import date as _date
        today = _date.today()
        earnings_dates = cal.get("Earnings Date") or []
        if not isinstance(earnings_dates, list):
            earnings_dates = [earnings_dates]
        for ed in earnings_dates:
            ed_date = ed.date() if hasattr(ed, "date") else _date.fromisoformat(str(ed)[:10])
            if ed_date >= today:
                next_earnings = ed_date.isoformat()
                earnings_in_days = (ed_date - today).days
                break
    except Exception:
        pass

    # Scan result (entry/SL/TP/CRV) — fall back to latest scan date if today has no result
    _scan_date = get_latest_scan_date() or date.today()
    scan_result = get_result_by_ticker(sym, _scan_date)
    scan_block = ""
    if scan_result:
        scan_block = (
            f"\nSCAN-ERGEBNIS (aktuell):\n"
            f"Setup: {scan_result.setup_type} | "
            f"Entry: {scan_result.entry_zone or '–'} | "
            f"SL: {scan_result.stop_loss or '–'} | "
            f"TP: {scan_result.target or '–'} | "
            f"CRV: {scan_result.crv_calculated or '–'}"
        )

    # News headlines
    news_lines = "\n".join(f"- {n.get('title', '')}" for n in news[:3]) if news else "– Keine aktuellen News –"

    # Build system prompt
    price_str = f"${current_price:.2f}" if current_price else "–"
    sma50_str  = f"${sma50}"  if sma50  else "–"
    sma200_str = f"${sma200}" if sma200 else "–"
    perf_str = f"1M {perf_1m:+.1f}% | 3M {perf_3m:+.1f}% | YTD {perf_ytd:+.1f}%" if all(
        x is not None for x in [perf_1m, perf_3m, perf_ytd]
    ) else "–"
    earnings_str = (
        f"{next_earnings} (in {earnings_in_days} Tagen)" if next_earnings else "–"
    )

    system_prompt = f"""Du bist ein Trading-Analyse-Assistent für Swing-Trading.

TICKER: {sym} | {info.get('longName') or info.get('shortName') or sym} | Sektor: {info.get('sector') or '–'}
KURS: {price_str} | Beta: {info.get('beta') or '–'} | KGV: {info.get('trailingPE') or '–'}
52W: ${info.get('fiftyTwoWeekLow') or '–'}–${info.get('fiftyTwoWeekHigh') or '–'}
SMA50: {sma50_str} | SMA200: {sma200_str}
Performance: {perf_str}
Short Float: {f"{round(float(info['shortPercentOfFloat'])*100,1)}%" if info.get('shortPercentOfFloat') else '–'}
Earnings: {earnings_str}
{scan_block}

NEWS (aktuell):
{news_lines}

Antworte auf Deutsch. Keine Anlageberatung.
Wenn du konkrete Trade-Parameter vorschlägst, füge am Ende deiner Antwort einen JSON-Block ein (kein Markdown):
TRADE_JSON:{{"entry_low":X,"entry_high":X,"stop_loss":X,"target":X}}"""

    # ── Build messages for Haiku ─────────────────────────────────────────────
    messages = []
    for h in history:
        role = h.get("role")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            system=system_prompt,
            messages=messages,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Ungültiger Anthropic API Key")
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API Fehler: {exc.message}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API nicht erreichbar: {exc}")

    raw_reply = response.content[0].text if response.content else ""
    tokens_used = response.usage.input_tokens + response.usage.output_tokens

    # ── Parse TRADE_JSON marker ───────────────────────────────────────────────
    suggested_plan = None
    reply_text = raw_reply

    trade_json_match = re.search(r"TRADE_JSON:(\{.*\})", raw_reply, re.DOTALL)
    if trade_json_match:
        try:
            import json as _json
            suggested_plan = _json.loads(trade_json_match.group(1))
            # Remove the marker from the displayed reply
            reply_text = raw_reply[:trade_json_match.start()].rstrip()
        except Exception:
            pass

    return {
        "reply": reply_text,
        "suggested_plan": suggested_plan,
        "tokens_used": tokens_used,
    }


# ---------------------------------------------------------------------------
# Multi-Broker OMS — Trade Plans
# ---------------------------------------------------------------------------

@app.get("/api/trade-plans/performance-stats")
async def trade_plan_performance_stats(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Return Auto vs. Manual TradePlan counts (for GhostPortfolio performance comparison).
    Buckets: auto_trade=True vs False, grouped by status.
    """
    from backend.database import get_all_trade_plans
    plans = get_all_trade_plans(current_user.tenant_id, limit=500)
    auto_plans   = [p for p in plans if p.auto_trade]
    manual_plans = [p for p in plans if not p.auto_trade]

    def _bucket(plist):
        return {
            "total":     len(plist),
            "active":    sum(1 for p in plist if p.status in ("pending", "active", "partial", "in_position")),
            "closed":    sum(1 for p in plist if p.status in ("closed", "done")),
            "cancelled": sum(1 for p in plist if p.status == "cancelled"),
        }

    return {
        "auto":   _bucket(auto_plans),
        "manual": _bucket(manual_plans),
    }


@app.get("/api/trade-plans")
async def list_trade_plans(
    active_only: bool = True,
    status: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    plans = get_active_trade_plans(current_user.tenant_id) if active_only \
            else get_all_trade_plans(current_user.tenant_id)
    if status:
        plans = [p for p in plans if p.status == status]
    return [p.model_dump() for p in plans]


@app.post("/api/trade-plans")
async def create_trade_plan(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    from datetime import datetime as _dt
    el = float(data["entry_low"])
    eh = float(data["entry_high"])
    sl = float(data["stop_loss"])
    tgt = float(data["target"]) if data.get("target") else None

    if sl >= el:
        raise HTTPException(status_code=400, detail="Stop Loss muss unter Entry Low liegen.")
    if tgt is not None and tgt <= eh:
        raise HTTPException(status_code=400, detail="Target muss über Entry High liegen.")
    if tgt is not None and (eh - sl) > 0:
        crv = (tgt - eh) / (eh - sl)
        if crv <= 0:
            raise HTTPException(status_code=400, detail="CRV muss positiv sein.")

    plan = TradePlan(
        tenant_id=current_user.tenant_id,
        ticker=data["ticker"].upper(),
        isin=data.get("isin"),
        entry_low=el,
        entry_high=eh,
        stop_loss=sl,
        target=tgt,
        risk_pct=float(data.get("risk_pct", 1.0)),
        broker_ids_json=json.dumps(data.get("broker_ids", [])),
        status="pending",
        strategy_module=data.get("strategy_module"),
        setup_type=data.get("setup_type"),
        notes=data.get("notes"),
        scan_result_id=data.get("scan_result_id"),
        created_at=_dt.utcnow(),
        updated_at=_dt.utcnow(),
    )
    saved = save_trade_plan(plan)
    return saved.model_dump()


@app.get("/api/trade-plans/{plan_id}")
async def get_trade_plan_endpoint(
    plan_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")
    return plan.model_dump()


@app.put("/api/trade-plans/{plan_id}")
async def update_trade_plan_endpoint(
    plan_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")
    updated = update_trade_plan(plan_id, data)
    return updated.model_dump()


@app.delete("/api/trade-plans/{plan_id}")
async def cancel_trade_plan(
    plan_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")
    update_trade_plan(plan_id, {"status": "cancelled"})
    return {"status": "cancelled"}


@app.post("/api/trade-plans/{plan_id}/close")
async def close_trade_plan(
    plan_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Close a TradePlan: set status='closed', record exit price + date, auto-create JournalEntry.
    Body: { exit_price: float, shares?: float, exit_reason?: str }
    """
    from datetime import date as _date, datetime as _dt
    from backend.database import JournalEntry

    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")

    exit_price = float(data.get("exit_price", 0))
    if exit_price <= 0:
        raise HTTPException(status_code=422, detail="exit_price muss positiv sein")

    shares = float(data.get("shares") or plan.shares_executed or 0)
    exit_reason = data.get("exit_reason", "manual")
    today = _date.today()

    # Calculate P&L in EUR
    entry_price = plan.actual_entry_price or plan.entry_high
    pnl_eur: Optional[float] = None
    pnl_pct: Optional[float] = None
    if shares > 0 and entry_price:
        # Fetch EUR/USD rate (best-effort, fallback 1.09)
        eurusd = 1.09
        try:
            import yfinance as _yf
            _t = _yf.Ticker("EURUSD=X")
            _hist = _t.history(period="1d")
            if not _hist.empty:
                eurusd = round(float(_hist["Close"].iloc[-1]), 4)
        except Exception:
            pass
        pnl_usd = (exit_price - entry_price) * shares
        pnl_eur = round(pnl_usd / eurusd, 2)
        pnl_pct = round(((exit_price - entry_price) / entry_price) * 100, 2)

    update_data: dict = {
        "status": "closed",
        "actual_exit_price": exit_price,
        "exit_date": today.isoformat(),
    }
    if shares > 0:
        update_data["shares_executed"] = shares
    update_trade_plan(plan_id, update_data)

    # Auto-create JournalEntry so the trade appears in Journal Tab
    if entry_price:
        journal = JournalEntry(
            trade_date=plan.created_at.date(),
            ticker=plan.ticker,
            setup_reason=plan.notes or "",
            setup_type=plan.setup_type,
            entry_price=entry_price,
            stop_loss=plan.stop_loss,
            target=plan.target or exit_price,
            risk_eur=0.0,
            risk_reward=0.0,
            position_size=int(shares),
            exit_price=exit_price,
            exit_date=today,
            pnl_eur=pnl_eur,
            pnl_pct=pnl_pct,
            source="tradeplan",
        )
        save_journal_entry(journal)

    return {"status": "closed", "exit_price": exit_price, "pnl_eur": pnl_eur}


@app.post("/api/trade-plans/{plan_id}/execute/{broker_id}")
async def execute_trade_plan(
    plan_id: int,
    broker_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Execute a trade plan on a specific broker.
    data must include: qty (int)
    """
    from backend.brokers import get_connector

    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")

    # Load broker connection
    connections = get_all_broker_connections(current_user.tenant_id)
    conn = next((c for c in connections if c.id == broker_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")

    from backend.crypto import decrypt_or_none
    conn_dict = conn.model_dump()
    conn_dict["api_key"] = decrypt_or_none(conn.api_key_enc)
    conn_dict["api_secret"] = decrypt_or_none(conn.api_secret_enc)
    connector = get_connector(conn_dict)
    if not connector.supports_auto_trade():
        raise HTTPException(
            status_code=400,
            detail=f"{conn.label} unterstützt kein automatisches Trading. Bitte manuell ausführen."
        )

    plan_dict = {
        "ticker": plan.ticker,
        "isin": plan.isin,
        "entry_high": plan.entry_high,
        "stop_loss": plan.stop_loss,
        "target": plan.target,
        "qty": int(data.get("qty", 1)),
    }

    try:
        result = connector.place_order(plan_dict)
        # Update execution state
        exec_state = json.loads(plan.execution_state_json or "{}")
        exec_state[str(broker_id)] = "executed"
        fill_price = result.get("limit_price") or result.get("fill_price") or plan.entry_high
        update_trade_plan(plan_id, {
            "execution_state_json": json.dumps(exec_state),
            "status": "in_position",
            "shares_executed": float(plan_dict["qty"]),
            "actual_entry_price": float(fill_price) if fill_price else None,
        })
        # Create PortfolioPosition so the trade appears in the Portfolio tab
        create_position({
            "ticker": plan.ticker,
            "entry_price": float(fill_price) if fill_price else float(plan.entry_high),
            "shares": float(plan_dict["qty"]),
            "stop_loss": plan.stop_loss,
            "target": plan.target,
            "entry_date": date.today().isoformat(),
            "setup_type": plan.setup_type or "breakout",
            "notes": f"Alpaca-Ausführung via TradePlan #{plan_id}",
            "scan_result_id": plan.scan_result_id,
            "broker_id": broker_id,
        })
        return {"order": result, "broker": conn.label}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/trade-plans/{plan_id}/checklist/{broker_id}")
async def get_trade_plan_checklist(
    plan_id: int,
    broker_id: int,
    qty: Optional[int] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Return EUR-converted execution checklist for a manual broker."""
    from backend.brokers import get_connector
    import asyncio

    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")

    connections = get_all_broker_connections(current_user.tenant_id)
    conn = next((c for c in connections if c.id == broker_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")

    connector = get_connector(conn.model_dump())

    # Use qty override if provided, else calculate from risk
    if qty and qty > 0:
        resolved_qty = qty
    else:
        try:
            balance = connector.get_balance()
            buying_power = balance.get("buying_power", 0)
            risk_amount = buying_power * (plan.risk_pct / 100)
            risk_per_share = plan.entry_high - plan.stop_loss
            resolved_qty = max(1, int(risk_amount / risk_per_share)) if risk_per_share > 0 else 1
        except Exception:
            resolved_qty = 1

    plan_dict = {
        "ticker": plan.ticker,
        "isin": plan.isin,
        "entry_low": plan.entry_low,
        "entry_high": plan.entry_high,
        "stop_loss": plan.stop_loss,
        "target": plan.target,
        "qty": resolved_qty,
    }

    if hasattr(connector, "get_checklist_data"):
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: connector.get_checklist_data(plan_dict))
        return result

    return {"steps": connector.get_execution_checklist(plan_dict), "qty": qty}


@app.post("/api/trade-plans/{plan_id}/tr-executed/{broker_id}")
async def tr_plan_executed(
    plan_id: int,
    broker_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Mark a TR trade plan as executed and auto-create portfolio entry.
    data: { qty: int }
    """
    from backend.portfolio import create_position
    from datetime import datetime as _dt

    plan = get_trade_plan(plan_id)
    if not plan or plan.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Trade Plan nicht gefunden")

    qty = int(data.get("qty", 1))

    # Fetch current EURUSD rate for EUR P&L tracking
    fx_rate = None
    try:
        import yfinance as _yf
        _t = _yf.Ticker("EURUSD=X")
        _hist = _t.history(period="1d")
        if not _hist.empty:
            fx_rate = round(float(_hist["Close"].iloc[-1]), 4)
    except Exception:
        fx_rate = 1.09  # fallback

    # Create portfolio entry from plan data
    pos_data = {
        "ticker": plan.ticker,
        "entry_price": plan.entry_high,
        "shares": qty,
        "stop_loss": plan.stop_loss,
        "target": plan.target,
        "entry_date": _dt.utcnow().date().isoformat(),
        "setup_type": plan.setup_type or "breakout",
        "notes": f"TR-Ausführung via TradePlan #{plan_id}",
        "scan_result_id": plan.scan_result_id,
        "broker_id": broker_id,
        "execution_fx_rate": fx_rate,
    }
    position = create_position(pos_data)

    # Update execution state
    exec_state = json.loads(plan.execution_state_json or "{}")
    exec_state[str(broker_id)] = "executed"
    update_trade_plan(plan_id, {
        "execution_state_json": json.dumps(exec_state),
        "status": "active",
        "shares_executed": float(qty),
    })

    return {"position_id": position.get("id"), "broker": broker_id, "qty": qty}


# ---------------------------------------------------------------------------
# Slippage Tracker
# ---------------------------------------------------------------------------

@app.patch("/api/trade-plans/{plan_id}/actual-entry")
async def set_actual_entry(
    plan_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Record the actual fill price after execution.
    Body: { "actual_entry_price": 145.50, "actual_entry_price_eur": 133.00 }
    actual_entry_price_eur is optional and stored in execution_state_json (TR broker only).
    Returns slippage vs. planned entry_high.
    """
    price = data.get("actual_entry_price")
    if price is None:
        raise HTTPException(status_code=422, detail="actual_entry_price required")
    plan = get_trade_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    update_data: dict = {"actual_entry_price": float(price)}

    # Optionally store EUR fill price in execution_state_json (no schema change needed)
    price_eur = data.get("actual_entry_price_eur")
    if price_eur is not None:
        exec_state = json.loads(plan.execution_state_json or "{}")
        exec_state["actual_entry_price_eur"] = round(float(price_eur), 2)
        update_data["execution_state_json"] = json.dumps(exec_state)

    update_trade_plan(plan_id, update_data)

    slippage = float(price) - plan.entry_high
    slippage_pct = (slippage / plan.entry_high * 100) if plan.entry_high else 0
    result = {
        "actual_entry_price": float(price),
        "planned_entry_high": plan.entry_high,
        "slippage": round(slippage, 4),
        "slippage_pct": round(slippage_pct, 3),
    }
    if price_eur is not None:
        result["actual_entry_price_eur"] = round(float(price_eur), 2)
    return result


# ---------------------------------------------------------------------------
# Broker Registry
# ---------------------------------------------------------------------------

@app.get("/api/brokers")
async def list_brokers(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all configured brokers with current balances."""
    import asyncio
    from backend.brokers import get_connector

    connections = get_all_broker_connections(current_user.tenant_id)
    result = []

    async def _get_balance(conn):
        try:
            from backend.crypto import decrypt_or_none
            conn_dict = conn.model_dump()
            # Decrypt API credentials — model_dump() returns encrypted values only
            if conn.api_key_enc:
                conn_dict["api_key"] = decrypt_or_none(conn.api_key_enc)
            if conn.api_secret_enc:
                conn_dict["api_secret"] = decrypt_or_none(conn.api_secret_enc)
            connector = get_connector(conn_dict)
            loop = asyncio.get_event_loop()
            balance = await loop.run_in_executor(None, connector.get_balance)
            return {**conn.model_dump(), "balance": balance, "error": None}
        except Exception as exc:
            return {**conn.model_dump(), "balance": None, "error": str(exc)}

    results = await asyncio.gather(*[_get_balance(c) for c in connections], return_exceptions=True)
    for r in results:
        if isinstance(r, dict):
            result.append(r)

    # Always include Alpaca fallback from .env if no DB connections exist
    if not result:
        try:
            from backend.database import get_broker_credentials
            creds = get_broker_credentials(current_user.tenant_id)
            from backend.brokers import AlpacaConnector
            connector = AlpacaConnector(creds)
            loop = asyncio.get_event_loop()
            balance = await loop.run_in_executor(None, connector.get_balance)
            result.append({
                "id": None,
                "broker_type": "alpaca",
                "label": "Alpaca (env)",
                "is_paper": creds.get("is_paper", True),
                "balance": balance,
                "error": None,
            })
        except Exception as exc:
            result.append({
                "id": None,
                "broker_type": "alpaca",
                "label": "Alpaca (env)",
                "balance": None,
                "error": str(exc),
            })

    return result


@app.post("/api/brokers/{broker_id}/balance")
async def update_manual_balance(
    broker_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update manual account balance for TR and other manual brokers."""
    conn = update_broker_manual_balance(
        broker_id,
        balance=float(data["balance"]),
        currency=data.get("currency", "EUR"),
    )
    if not conn:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")
    return conn.model_dump()


@app.post("/api/brokers")
async def create_broker(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Create a new broker connection."""
    if not data.get("broker_type"):
        raise HTTPException(status_code=400, detail="broker_type erforderlich")
    # Set broker-type defaults
    broker_type = data["broker_type"]
    if "supports_short_selling" not in data:
        data["supports_short_selling"] = broker_type in ("alpaca", "ibkr")
    if "fee_model_json" not in data:
        defaults = {
            "alpaca":          json.dumps({"type": "flat", "amount": 0.0}),
            "trade_republic":  json.dumps({"type": "flat", "amount": 1.0}),
            "ibkr":            json.dumps({
                "type": "tiered", "per_share": 0.005, "min": 0.35, "max_pct": 1.0
            }),
        }
        data["fee_model_json"] = defaults.get(broker_type, json.dumps({"type": "flat", "amount": 0.0}))
    conn = create_broker_connection(current_user.tenant_id, data)
    return conn.model_dump()


@app.put("/api/brokers/{broker_id}")
async def update_broker(
    broker_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update an existing broker connection."""
    conn = update_broker_connection(broker_id, current_user.tenant_id, data)
    if not conn:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")
    return conn.model_dump()


@app.delete("/api/brokers/{broker_id}")
async def delete_broker(
    broker_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Delete a broker connection."""
    ok = delete_broker_connection(broker_id, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")
    return {"status": "deleted"}


@app.post("/api/brokers/{broker_id}/test")
async def test_broker_connection_by_id(
    broker_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Test connection for a specific broker by ID."""
    from backend.database import get_all_broker_connections
    from backend.crypto import decrypt_or_none
    conns = get_all_broker_connections(current_user.tenant_id)
    conn = next((c for c in conns if c.id == broker_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="Broker nicht gefunden")

    # IBKR: test CP Gateway connection
    if conn.broker_type == "ibkr":
        from backend.brokers.ibkr import IBKRConnector
        connector = IBKRConnector(conn.model_dump())
        result = connector.test_connection()
        if result["ok"]:
            return {"status": "ok", **result}
        raise HTTPException(status_code=400, detail=result.get("message", "Verbindung fehlgeschlagen"))

    if conn.broker_type != "alpaca":
        raise HTTPException(status_code=400, detail="Verbindungstest nur für Alpaca und IBKR verfügbar")
    api_key = decrypt_or_none(conn.api_key_enc)
    api_secret = decrypt_or_none(conn.api_secret_enc)
    if not api_key or not api_secret:
        raise HTTPException(status_code=400, detail="API Key / Secret nicht gesetzt")
    try:
        from alpaca.trading.client import TradingClient
        client = TradingClient(api_key=api_key, secret_key=api_secret, paper=conn.is_paper)
        account = client.get_account()
        return {
            "status": "ok",
            "account_status": str(account.status),
            "buying_power": str(account.buying_power),
            "is_paper": conn.is_paper,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/orders/sell")
async def place_sell_order(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Place a market sell order for an existing Alpaca position.
    Body: { ticker, qty }
    """
    from backend.trading import place_market_sell
    try:
        creds = get_broker_credentials(current_user.tenant_id)
        return place_market_sell(creds, ticker=data["ticker"], qty=float(data["qty"]))
    except KeyError as e:
        raise HTTPException(status_code=422, detail=f"Missing field: {e}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# v3.1 — Near-Misses endpoint
# ---------------------------------------------------------------------------

@app.get("/api/scan/near-misses")
async def get_near_misses():
    """
    Returns tickers that narrowly failed a filter in the last scan.
    Pulled from in-memory funnel (populated by run_screener).
    """
    from backend.screener import get_last_funnel
    funnel = get_last_funnel()
    return {
        "near_misses": funnel.get("near_misses", []),
        "scan_date": funnel.get("ran_at", ""),
    }


# ---------------------------------------------------------------------------
# v3.2 — Trigger-Preis
# ---------------------------------------------------------------------------

@app.get("/api/scan/trigger-waiting")
async def get_trigger_waiting(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Returns active candidates that have a trigger_price set but not yet reached.
    Shown in Dashboard as '⏳ Wartet auf Trigger'.
    """
    from backend.database import get_trigger_waiting as _get_trigger_waiting
    from backend.database import get_latest_scan_date
    scan_date = date.today()
    candidates = _get_trigger_waiting(scan_date)
    if not candidates:
        latest = get_latest_scan_date()
        if latest and latest != scan_date:
            candidates = _get_trigger_waiting(latest)
    return {
        "candidates": [c.model_dump() for c in candidates],
        "count": len(candidates),
    }


@app.post("/api/scan/trigger-check")
async def manual_trigger_check(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Manually trigger a price check for all pending trigger candidates.
    Fires ntfy alerts for any that have reached their trigger price.
    """
    async def _run():
        from backend.signal_checker import check_candidate_triggers
        return await check_candidate_triggers()
    background_tasks.add_task(_run)
    return {"status": "started"}


# ---------------------------------------------------------------------------
# v3.1 — Dynamic Universe Management
# ---------------------------------------------------------------------------

@app.get("/api/universes")
async def list_universes(current_user: AuthenticatedUser = Depends(get_current_user)):
    """List all scan universes."""
    universes = get_all_universes()
    return [u.model_dump() for u in universes]


@app.patch("/api/universes/{universe_id}")
async def patch_universe(
    universe_id: int,
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Update a universe (is_active, tickers_json, etc.)."""
    allowed = {"is_active", "tickers_json", "name", "description", "regime_default", "sort_order"}
    payload = {k: v for k, v in data.items() if k in allowed}
    updated = update_universe(universe_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Universe not found")
    return updated.model_dump()


@app.post("/api/universes")
async def create_universe(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Create a custom scan universe."""
    from backend.database import ScanUniverse
    from sqlmodel import Session
    from backend.database import get_engine
    u = ScanUniverse(
        name=data.get("name", "Custom Universe"),
        type="custom",
        description=data.get("description"),
        tickers_source="custom_json",
        tickers_json=data.get("tickers_json", "[]"),
        regime_default=data.get("regime_default", "any"),
        is_active=data.get("is_active", False),
        sort_order=data.get("sort_order", 99),
    )
    with Session(get_engine()) as session:
        session.add(u)
        session.commit()
        session.refresh(u)
    return u.model_dump()


# ---------------------------------------------------------------------------
# v3.1 — AI Chat (8.5)
# ---------------------------------------------------------------------------

@app.post("/api/chat")
async def ai_chat(
    data: dict,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    AI Chat endpoint — send a question with scanner context, get Claude's answer.
    Body: { "message": str, "session_history": [...] }
    Returns: { "reply": str, "tokens_used": int }
    """
    import anthropic
    from backend.database import get_ai_status, set_ai_error, clear_ai_error

    message = (data.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message darf nicht leer sein")
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Kein ANTHROPIC_API_KEY konfiguriert")

    session_history = data.get("session_history", [])

    try:
        # Build context: today's candidates + regime
        scan_date = date.today()
        candidates = get_results_for_date(scan_date)
        if not candidates:
            latest = get_latest_scan_date()
            if latest:
                candidates = get_results_for_date(latest)
                scan_date = latest

        regime_data = get_latest_regime()
        # regime_data is a MarketRegime SQLModel instance, not a dict — use attribute access
        regime = regime_data.regime if regime_data else "neutral"

        # Build compact candidate context
        cand_lines = []
        for c in candidates[:20]:  # cap at 20 to control token cost
            crv = f"CRV:{c.crv_calculated:.1f}" if c.crv_calculated else ""
            cand_lines.append(
                f"- {c.ticker} [{c.strategy_module}] {c.setup_type} conf={c.confidence} "
                f"{crv} entry={c.entry_zone} stop={c.stop_loss} target={c.target} "
                f"status={c.candidate_status}"
            )

        # Build TradePlan context (active + recently closed)
        active_plans = get_active_trade_plans(tenant_id=current_user.tenant_id)
        closed_plans = get_closed_trade_plans(tenant_id=current_user.tenant_id)
        plan_lines = []
        for p in active_plans[:15]:
            plan_lines.append(
                f"- [{p.status.upper()}] {p.ticker} {p.direction} "
                f"entry={p.entry_low}-{p.entry_high} SL={p.stop_loss} "
                f"TP={p.target or '–'} setup={p.setup_type or '–'}"
            )
        for p in closed_plans[:5]:
            pnl = ""
            if p.actual_entry_price and p.actual_exit_price:
                pnl_val = (p.actual_exit_price - p.actual_entry_price) * (1 if p.direction == "long" else -1)
                pnl = f" P&L={pnl_val:+.2f}"
            plan_lines.append(
                f"- [CLOSED {p.exit_date or '?'}] {p.ticker} "
                f"entry={p.actual_entry_price or p.entry_low} SL={p.stop_loss} "
                f"exit={p.actual_exit_price or '–'}{pnl}"
            )

        # Build Journal context (last 10 entries)
        journal_entries = get_journal_entries()[:10]
        journal_lines = []
        for j in journal_entries:
            outcome = f"exit={j.exit_price} P&L={j.pnl_eur}€" if j.exit_price else "offen"
            journal_lines.append(
                f"- {j.trade_date} {j.ticker} entry={j.entry_price} SL={j.stop_loss} "
                f"TP={j.target} {outcome} setup={j.setup_type or '–'}"
            )

        system_prompt = f"""Du bist ein erfahrener Swing-Trading-Assistent. Du hast Zugriff auf die aktuellen Scanner-Ergebnisse, offene TradePläne und das Trading-Journal des Users.

AKTUELLES REGIME: {regime.upper()}
SCAN-DATUM: {scan_date}

KANDIDATEN ({len(candidates)} total, zeige Top 20):
{chr(10).join(cand_lines) if cand_lines else "Keine Kandidaten heute."}

AKTIVE & KÜRZLICH GESCHLOSSENE TRADEPLÄNE ({len(active_plans)} aktiv):
{chr(10).join(plan_lines) if plan_lines else "Keine TradePläne vorhanden."}

JOURNAL (letzte {len(journal_entries)} Einträge):
{chr(10).join(journal_lines) if journal_lines else "Kein Journal vorhanden."}

Beantworte Fragen präzise und faktenbasiert. Wenn du unsicher bist, sage es. Gib keine Anlageberatung — weise darauf hin dass dies keine Rechts- oder Finanzberatung ist. Antworte auf Deutsch."""

        # Prepare messages
        messages = []
        for h in session_history[-10:]:  # keep last 10 turns
            if h.get("role") in ("user", "assistant") and h.get("content"):
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": message})

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=800,
            system=system_prompt,
            messages=messages,
        )
        reply = response.content[0].text
        tokens_used = response.usage.input_tokens + response.usage.output_tokens
        clear_ai_error()
        return {"reply": reply, "tokens_used": tokens_used}
    except HTTPException:
        raise
    except Exception as exc:
        error_msg = str(exc)
        set_ai_error(error_msg)
        raise HTTPException(status_code=503, detail=f"Claude API Fehler: {error_msg}")


# ---------------------------------------------------------------------------
# Chart Data — OHLCV + SMA50/200 via yfinance
# ---------------------------------------------------------------------------

_VALID_PERIODS = {"1mo", "3mo", "6mo", "1y"}


@app.get("/api/chart/{symbol}")
async def get_chart_data(
    symbol: str,
    period: str = "3mo",
    interval: str = "1d",
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Return OHLCV bars + SMA50/200 for the given symbol via yfinance.
    All price values are rounded via Decimal to avoid float artefacts.
    """
    from decimal import Decimal, ROUND_HALF_UP
    import pandas as pd
    import yfinance as yf

    if period not in _VALID_PERIODS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period '{period}'. Allowed: {sorted(_VALID_PERIODS)}",
        )

    try:
        ticker = yf.Ticker(symbol.upper())
        hist = ticker.history(period=period, interval=interval)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance error: {exc}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data found for symbol '{symbol}'")

    two_dp = Decimal("0.01")

    def to_dec(val: float) -> float:
        return float(Decimal(str(val)).quantize(two_dp, rounding=ROUND_HALF_UP))

    bars = []
    for ts, row in hist.iterrows():
        bars.append(
            {
                "time": ts.strftime("%Y-%m-%d"),
                "open": to_dec(row["Open"]),
                "high": to_dec(row["High"]),
                "low": to_dec(row["Low"]),
                "close": to_dec(row["Close"]),
                "volume": int(row["Volume"]),
            }
        )

    close_series = hist["Close"]
    sma50_raw = close_series.rolling(50).mean()
    sma200_raw = close_series.rolling(200).mean()

    def _series_to_list(series: "pd.Series") -> list:
        result = []
        for ts, val in series.items():
            if not pd.isna(val):
                result.append({"time": ts.strftime("%Y-%m-%d"), "value": to_dec(val)})
        return result

    return {
        "symbol": symbol.upper(),
        "bars": bars,
        "indicators": {
            "sma50": _series_to_list(sma50_raw),
            "sma200": _series_to_list(sma200_raw),
        },
    }
