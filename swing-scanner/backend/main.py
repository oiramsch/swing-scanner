"""
FastAPI application — all API endpoints.
"""
import json
import logging
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.auth import AuthenticatedUser, authenticate_user, create_access_token, get_current_user
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

    # Fix A/B/C: only show actionable candidates by default
    if not include_filtered:
        actionable = []
        for r in results:
            status = r.candidate_status or "active"
            if status != "active":
                continue
            # Safety net for old NULL-status records: skip direction mismatches
            if r.entry_zone and r.stop_loss:
                try:
                    import re as _re
                    nums = [float(x) for x in _re.findall(r"[\d.]+", str(r.entry_zone))]
                    entry_trigger = max(nums) if nums else None
                    if entry_trigger and float(r.stop_loss) >= entry_trigger:
                        continue  # stop >= entry → direction mismatch
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

    return [r.model_dump() for r in results]


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
async def trigger_scan(background_tasks: BackgroundTasks):
    if _scan_running:
        return {"status": "already_running"}
    background_tasks.add_task(_run_scan_bg)
    return {"status": "started"}


@app.get("/api/scan/status")
async def scan_status():
    return {
        "running": _scan_running,
        "progress": _scan_progress,
        "last_scan": _last_scan,
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
        context = await get_market_context()
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
    updated = update_lesson(entry_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return updated.model_dump()


@app.get("/api/journal/stats")
async def journal_stats():
    return get_journal_stats()


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


@app.get("/api/quotes")
async def get_live_quotes(
    symbols: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Fetch latest prices for comma-separated symbols via yfinance.
    Returns { AAPL: 182.50, MSFT: null, ... }
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
                result[sym] = round(float(price), 2) if price else None
            except Exception:
                result[sym] = None
        return result

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch)
