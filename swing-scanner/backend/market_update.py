"""
Daily market update: fetch market context, generate AI portfolio impact analysis.
"""
import json
import logging
from datetime import date, timedelta
from typing import Optional

import anthropic
import httpx

from backend.config import settings
from backend.database import MarketUpdate, save_market_update
from backend.market_regime import get_current_regime

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"

# Sector ETFs for sector movers
SECTOR_ETFS = {
    "Technology": "XLK",
    "Financials": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Consumer Disc.": "XLY",
    "Consumer Staples": "XLP",
    "Utilities": "XLU",
    "Real Estate": "XLRE",
    "Materials": "XLB",
    "Communication": "XLC",
}


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


async def _fetch_daily_change(ticker: str) -> Optional[float]:
    """Fetch today's change % for a ticker via Polygon daily open/close."""
    today = date.today()
    # Try yesterday if today's data not available yet
    for days_back in [0, 1, 2]:
        target = today - timedelta(days=days_back)
        url = f"{POLYGON_BASE}/v1/open-close/{ticker}/{target.isoformat()}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers=_headers(), params={"adjusted": "true"})
                if resp.status_code == 200:
                    data = resp.json()
                    open_p = data.get("open")
                    close_p = data.get("close")
                    if open_p and close_p and open_p > 0:
                        return round(((close_p - open_p) / open_p) * 100, 2)
        except Exception as exc:
            logger.debug("Daily change fetch failed for %s: %s", ticker, exc)
    return None


async def get_market_context() -> dict:
    """
    Fetch current market data: SPY, QQQ, VIX, sector movers, regime.
    Returns a dict ready for the AI prompt.
    """
    import asyncio

    # Fetch SPY, QQQ, VIX + sector ETFs concurrently
    tickers_to_fetch = ["SPY", "QQQ", "VIXY"] + list(SECTOR_ETFS.values())
    tasks = [_fetch_daily_change(t) for t in tickers_to_fetch]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    changes = {}
    for ticker, result in zip(tickers_to_fetch, results):
        if isinstance(result, Exception) or result is None:
            changes[ticker] = None
        else:
            changes[ticker] = result

    spy_change = changes.get("SPY")
    qqq_change = changes.get("QQQ")
    vix_proxy = changes.get("VIXY")  # VIXY as VIX proxy (VIX itself not directly available)

    # Build sector movers
    sector_changes = {}
    for sector_name, etf in SECTOR_ETFS.items():
        val = changes.get(etf)
        if val is not None:
            sector_changes[sector_name] = val

    sorted_sectors = sorted(sector_changes.items(), key=lambda x: x[1], reverse=True)
    top_3 = sorted_sectors[:3]
    bottom_3 = sorted_sectors[-3:][::-1]

    regime = get_current_regime()

    # VIX level estimation: use latest regime VIX or estimate from VIXY proxy
    from backend.database import get_latest_regime
    latest_regime = get_latest_regime()
    vix_level = latest_regime.vix_level if latest_regime and latest_regime.vix_level else None

    return {
        "spy_change_pct": spy_change,
        "qqq_change_pct": qqq_change,
        "vix_level": vix_level,
        "market_regime": regime,
        "sector_changes": sector_changes,
        "top_sectors": [f"{name} {chg:+.1f}%" for name, chg in top_3],
        "bottom_sectors": [f"{name} {chg:+.1f}%" for name, chg in bottom_3],
        "sector_movers_json": json.dumps({"top": top_3, "bottom": bottom_3}),
    }


def _determine_notification_level(update_data: dict) -> str:
    """Determine notification level based on update content."""
    critical_alerts = update_data.get("critical_alerts", [])
    if critical_alerts:
        return "critical"
    overall_action = update_data.get("overall_action", "hold_all")
    if overall_action == "defensive":
        return "warning"
    if overall_action == "review_positions":
        return "warning"
    return "info"


async def generate_market_update(
    positions: list[dict],
    market_context: dict,
    update_type: str = "auto",
) -> MarketUpdate:
    """
    Generate an AI market update for open positions.
    Saves and returns the MarketUpdate object.
    """
    spy_change = market_context.get("spy_change_pct")
    qqq_change = market_context.get("qqq_change_pct")
    vix_level = market_context.get("vix_level")
    regime = market_context.get("market_regime", "neutral")
    top_sectors = market_context.get("top_sectors", [])
    bottom_sectors = market_context.get("bottom_sectors", [])

    spy_str = f"{spy_change:+.1f}%" if spy_change is not None else "N/A"
    qqq_str = f"{qqq_change:+.1f}%" if qqq_change is not None else "N/A"
    vix_str = f"{vix_level:.1f}" if vix_level else "N/A"

    # VIX interpretation
    vix_interp = "unbekannt"
    if vix_level:
        if vix_level < 15:
            vix_interp = "sehr niedrig"
        elif vix_level < 20:
            vix_interp = "niedrig"
        elif vix_level < 25:
            vix_interp = "moderat"
        elif vix_level < 30:
            vix_interp = "erhöht"
        else:
            vix_interp = "hoch"

    positions_json = json.dumps(positions, ensure_ascii=False, indent=2)

    prompt = f"""You are a portfolio manager reviewing open trading positions after today's market close.

Market Context Today:
- S&P 500: {spy_str} | NASDAQ: {qqq_str}
- VIX: {vix_str} ({vix_interp})
- Market Regime: {regime}
- Strongest sectors: {", ".join(top_sectors) if top_sectors else "N/A"}
- Weakest sectors: {", ".join(bottom_sectors) if bottom_sectors else "N/A"}

Open Positions:
{positions_json}

For each position analyze how TODAY's market movement affects it.
Then provide an overall portfolio assessment.

Respond ONLY with JSON:
{{
  "market_summary": "1 sentence on today's market",
  "portfolio_impact": "positive|negative|neutral",
  "overall_action": "hold_all|review_positions|defensive",
  "positions": [
    {{
      "ticker": "TICKER",
      "impact": "positive|negative|neutral",
      "impact_reason": "Why today's market affects this position",
      "action": "hold|tighten_stop|take_partial|exit|add",
      "action_detail": "Specific instruction",
      "urgency": "immediate|today|monitor",
      "stop_adjustment": null
    }}
  ],
  "critical_alerts": [
    {{
      "ticker": "TICKER",
      "alert": "Stop-Loss gefährdet — heute -3.2%",
      "action": "Sofort prüfen",
      "urgency": "immediate"
    }}
  ],
  "opportunities": "Any position that could be added to or upgraded, or null",
  "risk_summary": "Overall portfolio risk comment",
  "tomorrow_watchlist": "What to watch at market open tomorrow"
}}"""

    system_prompt = (
        "You are a professional portfolio manager. Analyze market impact on trading positions. "
        "Be specific and actionable. Respond ONLY with valid JSON, no markdown, no extra text."
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        update_data = json.loads(raw)
        logger.info("Market update generated: action=%s", update_data.get("overall_action"))
    except json.JSONDecodeError as exc:
        logger.error("Market update JSON parse error: %s", exc)
        update_data = {
            "market_summary": "Analyse nicht verfügbar",
            "portfolio_impact": "neutral",
            "overall_action": "hold_all",
            "positions": [],
            "critical_alerts": [],
            "risk_summary": "Keine Analyse verfügbar",
            "tomorrow_watchlist": "",
        }
    except Exception as exc:
        logger.error("Market update generation failed: %s", exc)
        raise

    notification_level = _determine_notification_level(update_data)

    update = MarketUpdate(
        update_date=date.today(),
        update_type=update_type,
        spy_change_pct=market_context.get("spy_change_pct"),
        qqq_change_pct=market_context.get("qqq_change_pct"),
        vix_level=market_context.get("vix_level"),
        market_regime=market_context.get("market_regime"),
        sector_movers_json=market_context.get("sector_movers_json"),
        positions_affected_json=json.dumps(update_data.get("positions", [])),
        critical_alerts_json=json.dumps(update_data.get("critical_alerts", [])),
        portfolio_summary=update_data.get("market_summary"),
        recommendations_json=json.dumps({
            "opportunities": update_data.get("opportunities"),
            "risk_summary": update_data.get("risk_summary"),
            "tomorrow_watchlist": update_data.get("tomorrow_watchlist"),
            "overall_action": update_data.get("overall_action"),
            "portfolio_impact": update_data.get("portfolio_impact"),
        }),
        overall_action=update_data.get("overall_action", "hold_all"),
        notification_sent=False,
        notification_level=notification_level,
    )

    saved = save_market_update(update)
    logger.info("Market update saved: id=%s level=%s", saved.id, notification_level)
    return saved
