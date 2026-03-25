"""
News, Earnings, Corporate Actions & CRV validation for scanner candidates.
Uses Polygon.io news endpoint + Claude Haiku for corporate action detection.
"""
import asyncio
import json
import logging
import re
from datetime import date, timedelta
from typing import Optional

import httpx
import pandas as pd
import anthropic

from backend.config import settings

logger = logging.getLogger(__name__)

POLYGON_BASE = "https://api.polygon.io"
HAIKU_MODEL = "claude-haiku-4-5"  # cheapest, ~20x less than Sonnet


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.polygon_api_key}"}


# ---------------------------------------------------------------------------
# Polygon news
# ---------------------------------------------------------------------------

async def get_ticker_news(ticker: str) -> list[dict]:
    """
    Fetch last 5 news headlines for a ticker via Polygon /v2/reference/news.
    Returns list of {title, published_utc, publisher}.
    """
    url = f"{POLYGON_BASE}/v2/reference/news"
    params = {"ticker": ticker, "limit": 5, "order": "desc",
              "apiKey": settings.polygon_api_key}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        results = data.get("results", [])
        return [
            {
                "title": r.get("title", ""),
                "published_utc": r.get("published_utc", "")[:10],
                "publisher": r.get("publisher", {}).get("name", ""),
            }
            for r in results
        ]
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", ticker, exc)
        return []


# ---------------------------------------------------------------------------
# Earnings dates
# ---------------------------------------------------------------------------

async def get_earnings_dates(ticker: str, headlines: list[dict]) -> dict:
    """
    Determine if there were recent (last 3 days) or upcoming (next 7 days) earnings.
    Primary: yfinance calendar for upcoming dates.
    Fallback: headline keyword detection for recent earnings.
    """
    earnings_keywords = [
        "earnings", "quarterly results", "q1", "q2", "q3", "q4",
        "eps", "revenue", "fiscal", "beats", "misses", "guidance",
    ]
    today = date.today()
    recent_cutoff = today - timedelta(days=3)
    upcoming_cutoff = today + timedelta(days=7)

    has_recent = False
    has_upcoming = False
    next_date = None

    # Headline-based recent detection
    for h in headlines:
        title_lower = h.get("title", "").lower()
        pub_date_str = h.get("published_utc", "")[:10]
        if any(kw in title_lower for kw in earnings_keywords):
            try:
                pub_date = date.fromisoformat(pub_date_str)
                if pub_date >= recent_cutoff:
                    has_recent = True
            except Exception:
                pass

    # yfinance calendar for upcoming earnings date
    try:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        cal = await loop.run_in_executor(None, lambda: yf.Ticker(ticker).calendar)
        if cal:
            earnings_dates = cal.get("Earnings Date") or []
            if not isinstance(earnings_dates, list):
                earnings_dates = [earnings_dates]
            for ed in earnings_dates:
                try:
                    ed_date = ed.date() if hasattr(ed, "date") else date.fromisoformat(str(ed)[:10])
                    if ed_date < today:
                        continue
                    if next_date is None or ed_date < date.fromisoformat(next_date):
                        next_date = ed_date.isoformat()
                    if ed_date <= upcoming_cutoff:
                        has_upcoming = True
                        break
                except Exception:
                    continue
    except Exception as exc:
        logger.debug("yfinance calendar lookup failed for %s: %s", ticker, exc)

    return {
        "recent": has_recent,
        "upcoming": has_upcoming,
        "next_date": next_date,
    }


# ---------------------------------------------------------------------------
# Corporate action detection via Claude Haiku
# ---------------------------------------------------------------------------

def _filter_attributed_headlines(ticker: str, headlines: list[str]) -> list[str]:
    """
    Keep only headlines where the ticker symbol appears explicitly as a word.
    This prevents sector/market news (e.g. 'Meta lawsuits', 'BP charges') from
    being used to invalidate an unrelated stock.
    Falls back to all headlines if none match, so Haiku can still see context —
    but the prompt then instructs strict attribution.
    """
    pattern = re.compile(r'\b' + re.escape(ticker.upper()) + r'\b')
    attributed = [h for h in headlines if pattern.search(h.upper())]
    return attributed if attributed else headlines


def detect_corporate_action(ticker: str, headlines: list[str]) -> dict:
    """
    Send headlines to Claude Haiku to detect corporate actions.
    ticker is passed explicitly so the prompt can enforce strict attribution.
    Very cheap: ~$0.0001 per call.
    """
    if not headlines or not settings.anthropic_api_key:
        return {
            "has_corporate_action": False,
            "action_type": "none",
            "action_description": None,
            "invalidates_technicals": False,
            "warning_message": None,
        }

    headlines_text = "\n".join(f"- {h}" for h in headlines[:5])
    prompt = f"""You are analyzing news headlines to detect corporate actions for the stock ticker {ticker}.

CRITICAL ATTRIBUTION RULE: You may ONLY flag a corporate action if the headline explicitly names {ticker} as the subject company.
- If a headline is about a different company (e.g. Meta, BP, Apple) → has_corporate_action MUST be false.
- If a headline is general market news, sector news, or an index summary → has_corporate_action MUST be false.
- Do NOT infer or assume that industry news affects {ticker} unless {ticker} is explicitly named.

Detect corporate actions ONLY for {ticker}:
- Earnings report / quarterly results
- Stock buyback / tender offer / share repurchase
- Merger, acquisition, or takeover
- Stock split or reverse split
- Dividend announcement
- FDA approval/rejection (for biotech)
- Major legal action or SEC investigation directly naming {ticker}

Headlines:
{headlines_text}

Respond ONLY with JSON:
{{
  "has_corporate_action": false,
  "action_type": "buyback|merger|earnings|split|dividend|fda|legal|none",
  "action_description": "One sentence summary mentioning {ticker} explicitly, or null",
  "invalidates_technicals": false,
  "warning_message": "Brief trader warning for {ticker} only, or null"
}}"""

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text if response.content else "{}"
        # Extract JSON
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            result = json.loads(match.group())
            result.setdefault("has_corporate_action", False)
            result.setdefault("action_type", "none")
            result.setdefault("action_description", None)
            result.setdefault("invalidates_technicals", False)
            result.setdefault("warning_message", None)
            return result
    except Exception as exc:
        logger.warning("Corporate action detection failed: %s", exc)

    return {
        "has_corporate_action": False,
        "action_type": "none",
        "action_description": None,
        "invalidates_technicals": False,
        "warning_message": None,
    }


# ---------------------------------------------------------------------------
# Gap detection
# ---------------------------------------------------------------------------

def detect_gap(df: pd.DataFrame) -> dict:
    """
    Compare today's Open with yesterday's Close to detect gaps.
    Returns gap_pct, is_gap_up, is_gap_down, gap_filled.
    """
    if df is None or len(df) < 2:
        return {"gap_pct": 0.0, "is_gap_up": False, "is_gap_down": False, "gap_filled": False}

    try:
        yesterday_close = float(df.iloc[-2]["Close"])
        today_open = float(df.iloc[-1]["Open"])
        today_high = float(df.iloc[-1]["High"])
        today_low = float(df.iloc[-1]["Low"])

        if yesterday_close == 0:
            return {"gap_pct": 0.0, "is_gap_up": False, "is_gap_down": False, "gap_filled": False}

        gap_pct = round((today_open - yesterday_close) / yesterday_close * 100, 2)
        is_gap_up = gap_pct > 5.0
        is_gap_down = gap_pct < -5.0

        # Gap filled = price came back to previous close during the day
        gap_filled = False
        if is_gap_up and today_low <= yesterday_close:
            gap_filled = True
        elif is_gap_down and today_high >= yesterday_close:
            gap_filled = True

        return {
            "gap_pct": gap_pct,
            "is_gap_up": is_gap_up,
            "is_gap_down": is_gap_down,
            "gap_filled": gap_filled,
        }
    except Exception as exc:
        logger.warning("Gap detection failed: %s", exc)
        return {"gap_pct": 0.0, "is_gap_up": False, "is_gap_down": False, "gap_filled": False}


# ---------------------------------------------------------------------------
# CRV calculation
# ---------------------------------------------------------------------------

def calculate_crv(entry_mid: float, stop: float, target: float) -> dict:
    """
    Calculate CRV from entry midpoint, stop loss, and target.
    Returns crv, crv_valid (>= 1.5), risk/reward per share, warning.
    """
    try:
        risk_per_share = abs(entry_mid - stop)
        reward_per_share = abs(target - entry_mid)

        if risk_per_share == 0:
            return {
                "crv": 0.0, "crv_valid": False,
                "risk_per_share": 0.0, "reward_per_share": reward_per_share,
                "warning": "Stop loss equals entry price — ungültige Position",
            }

        crv = round(reward_per_share / risk_per_share, 2)
        crv_valid = crv >= 1.5
        warning = None if crv_valid else f"CRV {crv} unter 1.5 — ungünstiges Chance-Risiko-Verhältnis"

        return {
            "crv": crv,
            "crv_valid": crv_valid,
            "risk_per_share": round(risk_per_share, 2),
            "reward_per_share": round(reward_per_share, 2),
            "warning": warning,
        }
    except Exception as exc:
        logger.warning("CRV calculation failed: %s", exc)
        return {"crv": 0.0, "crv_valid": False, "risk_per_share": 0.0,
                "reward_per_share": 0.0, "warning": "CRV-Berechnung fehlgeschlagen"}


def _parse_entry_mid(entry_zone: Optional[str]) -> Optional[float]:
    """Parse midpoint from entry_zone string like '37.00-37.50' or '37.25'."""
    if not entry_zone:
        return None
    try:
        parts = str(entry_zone).replace("$", "").split("-")
        if len(parts) == 2:
            return (float(parts[0].strip()) + float(parts[1].strip())) / 2
        return float(parts[0].strip())
    except Exception:
        return None


def _parse_price(val: Optional[str]) -> Optional[float]:
    if not val:
        return None
    try:
        return float(str(val).replace("$", "").strip())
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Combined news check
# ---------------------------------------------------------------------------

async def run_full_news_check(ticker: str, df: Optional[pd.DataFrame]) -> dict:
    """
    Run all news/event checks for a ticker and return a combined result dict
    ready to be merged into ScanResult fields.
    """
    # 1. Fetch news (with rate-limit sleep)
    await asyncio.sleep(settings.polygon_rate_limit_sleep)
    news_items = await get_ticker_news(ticker)
    headlines = [n["title"] for n in news_items]

    # 2. Earnings check from headlines
    earnings = await get_earnings_dates(ticker, news_items)

    # 3. Pre-filter: only headlines that explicitly name this ticker
    attributed_headlines = _filter_attributed_headlines(ticker, headlines)
    logger.debug("%s: %d headlines total, %d attributed", ticker, len(headlines), len(attributed_headlines))

    # 4. Corporate action via Haiku — uses attributed headlines + strict prompt
    corp = detect_corporate_action(ticker, attributed_headlines)

    # 5. Gap detection from OHLCV
    gap = detect_gap(df)

    # Determine overall sentiment
    sentiment = "neutral"
    if corp["has_corporate_action"]:
        sentiment = "corporate_action"
    elif gap["is_gap_up"] and not corp["has_corporate_action"]:
        sentiment = "bullish"
    elif gap["is_gap_down"]:
        sentiment = "bearish"

    # Compile warning text
    warnings = []
    if corp["warning_message"]:
        warnings.append(corp["warning_message"])
    if gap["is_gap_up"] and not gap["gap_filled"]:
        warnings.append(f"Gap up +{gap['gap_pct']}% — erhöhtes Rückschlagrisiko.")
    if gap["is_gap_down"]:
        warnings.append(f"Gap down {gap['gap_pct']}% — schwaches Momentum.")
    if earnings["recent"]:
        warnings.append("Kurs-Bewegung könnte durch Earnings getrieben sein.")
    if earnings["upcoming"]:
        warnings.append("Earnings in den nächsten 5 Tagen — erhöhte Volatilität möglich.")

    news_warning = " ".join(warnings)[:300] if warnings else None

    return {
        # News
        "news_headlines": json.dumps(headlines) if headlines else None,
        "news_sentiment": sentiment,
        "news_warning": news_warning,
        # Earnings
        "has_earnings_recent": earnings["recent"],
        "has_earnings_upcoming": earnings["upcoming"],
        # Corporate action
        "has_corporate_action": corp["has_corporate_action"],
        "corporate_action_type": corp.get("action_type", "none"),
        "corporate_action_description": corp.get("action_description"),
        "invalidates_technicals": corp.get("invalidates_technicals", False),
        # Gap
        "gap_pct": gap["gap_pct"],
        "is_gap_up": gap["is_gap_up"],
        "is_gap_down": gap["is_gap_down"],
        "gap_filled": gap["gap_filled"],
    }
