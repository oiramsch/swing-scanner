"""
FastAPI application — serves scan results and chart images.
"""
import asyncio
import logging
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from backend.database import (
    ScanResult,
    get_results_for_date,
    get_result_by_ticker,
    get_session,
    init_db,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Swing Scanner API", version="1.0.0")

# CORS for Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHARTS_DIR = Path("/tmp/charts")


@app.on_event("startup")
async def on_startup():
    init_db()
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("DB initialized, charts dir ready.")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

@app.get("/api/candidates", response_model=list[ScanResult])
async def list_candidates(date_str: Optional[str] = None):
    """
    Return all scan results for a given date (default: today).
    Query param: ?date=YYYY-MM-DD
    """
    if date_str:
        try:
            scan_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        scan_date = date.today()

    results = get_results_for_date(scan_date)
    return results


@app.get("/api/candidates/{ticker}", response_model=ScanResult)
async def get_candidate(ticker: str, date_str: Optional[str] = None):
    """Return a single ticker's scan result (default: today)."""
    if date_str:
        try:
            scan_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format.")
    else:
        scan_date = date.today()

    result = get_result_by_ticker(ticker.upper(), scan_date)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No result for {ticker} on {scan_date}")
    return result


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

@app.get("/api/charts/{ticker}")
async def get_chart(ticker: str):
    """Return the chart PNG for a ticker."""
    chart_path = CHARTS_DIR / f"{ticker.upper()}.png"
    if not chart_path.exists():
        raise HTTPException(status_code=404, detail=f"Chart not found for {ticker}")
    return FileResponse(str(chart_path), media_type="image/png")


# ---------------------------------------------------------------------------
# Manual scan trigger
# ---------------------------------------------------------------------------

_scan_running = False
_last_scan: Optional[dict] = None


async def _run_scan_bg():
    global _scan_running, _last_scan
    _scan_running = True
    try:
        # Import here to avoid circular imports at module level
        from backend.scheduler import run_scan
        result = await run_scan()
        _last_scan = result
        logger.info("Manual scan completed: %s", result)
    except Exception as exc:
        logger.error("Manual scan failed: %s", exc)
        _last_scan = {"status": "error", "error": str(exc)}
    finally:
        _scan_running = False


@app.post("/api/scan/trigger")
async def trigger_scan(background_tasks: BackgroundTasks):
    """Trigger a manual scan in the background."""
    global _scan_running
    if _scan_running:
        return {"status": "already_running", "message": "A scan is already in progress."}

    background_tasks.add_task(_run_scan_bg)
    return {"status": "started", "message": "Scan started in background."}


@app.get("/api/scan/status")
async def scan_status():
    """Return current scan status and last scan result."""
    return {
        "running": _scan_running,
        "last_scan": _last_scan,
    }
