"""
Push notifications via ntfy.sh and email via Resend.
"""
import logging
from typing import Optional
import json as _json

import requests

from backend.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ntfy.sh push notifications
# ---------------------------------------------------------------------------

def send_push(
    title: str,
    message: str,
    priority: str = "default",
    tags: str = "chart_with_upwards_trend",
) -> bool:
    """Send push notification via ntfy.sh."""
    if not settings.ntfy_topic:
        logger.debug("ntfy_topic not configured, skipping push")
        return False

    try:
        resp = requests.post(
            "https://ntfy.sh/",
            json={
                "topic":    settings.ntfy_topic,
                "title":    title,
                "message":  message,
                "priority": {"default": 3, "low": 2, "high": 4, "urgent": 5}.get(priority, 3),
                "tags":     [tags] if tags else [],
            },
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("Push sent: %s", title)
        return True
    except Exception as exc:
        logger.error("ntfy push failed: %s", exc)
        return False


def notify_sell_signal(ticker: str, signal_type: str, description: str, severity: str):
    priority_map = {"high": "urgent", "medium": "high", "low": "default"}
    tag_map = {"high": "rotating_light", "medium": "warning", "low": "bell"}
    send_push(
        title=f"⚠️ Sell Signal: {ticker}",
        message=f"{signal_type.upper()}\n{description}",
        priority=priority_map.get(severity, "default"),
        tags=tag_map.get(severity, "bell"),
    )


def notify_watchlist_alert(ticker: str, condition: str, current_price: float):
    send_push(
        title=f"👀 Watchlist Alert: {ticker}",
        message=f"Condition triggered: {condition}\nCurrent price: ${current_price:.2f}",
        priority="high",
        tags="eyes",
    )


def notify_scan_complete(
    candidates_found: int,
    top_candidates: list,  # list of ScanResult objects
    regime: str = "",
):
    """
    Scan-complete push. Includes top candidates with CRV + regime.
    top_candidates: list of ScanResult (sorted by composite_score desc).
    """
    from backend.database import get_ntfy_alerts
    if not get_ntfy_alerts().get("alerts_scan", True):
        return

    if not top_candidates:
        msg = "📭 Keine Kandidaten heute."
    else:
        lines = []
        for r in top_candidates[:3]:
            crv = f"CRV {r.crv_calculated:.1f}" if r.crv_calculated else ""
            lines.append(f"{r.ticker} {crv}".strip())
        msg = "Top: " + ", ".join(lines)

    if regime:
        msg += f"\nRegime: {regime.upper()}"

    title = (
        f"🔍 Scan: {candidates_found} Kandidaten"
        if candidates_found > 0
        else "📭 Scan: Keine Kandidaten"
    )
    send_push(title=title, message=msg, priority="default", tags="chart_with_upwards_trend")


def notify_daily_summary(
    scan_date,
    active_results: list,  # list of ScanResult with candidate_status == "active"
    regime: str = "",
):
    """
    22:55 UTC summary push. Uses the same formatting as notify_scan_complete
    but is called from daily_summary_notification with the latest scan date.
    Only active candidates are included (filtered_avoid / watchlist_pending excluded).
    """
    from backend.database import get_ntfy_alerts
    if not get_ntfy_alerts().get("alerts_scan", True):
        return

    top = active_results[:3]
    count = len(active_results)

    if top:
        lines = []
        for r in top:
            crv = f"CRV {r.crv_calculated:.1f}" if r.crv_calculated else ""
            lines.append(f"{r.ticker} {crv}".strip())
        msg = "Top: " + ", ".join(lines)
        if regime:
            msg += f"\nRegime: {regime.upper()}"
        kandidat = "Kandidat" if count == 1 else "Kandidaten"
        title = f"🔍 Scan {scan_date}: {count} {kandidat}"
        tags = "chart_with_upwards_trend"
    else:
        msg = f"Regime: {regime.upper()} — Keine Kandidaten heute." if regime else "Keine Kandidaten heute."
        title = f"📭 Scan {scan_date}: Keine Kandidaten"
        tags = "calendar"

    send_push(title=title, message=msg, priority="default", tags=tags)
    logger.info("Daily summary push sent: %s", title)


def notify_regime_change(old_regime: str, new_regime: str, spy_close: float, sma50: float, sma200: float):
    """Push when the market regime changes (e.g. bear → neutral)."""
    from backend.database import get_ntfy_alerts
    if not get_ntfy_alerts().get("alerts_regime", True):
        return

    icons = {"bull": "📈", "bear": "📉", "neutral": "➡️"}
    icon = icons.get(new_regime, "❓")
    send_push(
        title=f"{icon} Regime-Wechsel: {old_regime.upper()} → {new_regime.upper()}",
        message=f"SPY ${spy_close:.2f} · SMA50 ${sma50:.2f} · SMA200 ${sma200:.2f}",
        priority="high",
        tags="warning",
    )


def notify_trigger_reached(
    ticker: str,
    trigger_price: float,
    current_price: float,
    setup_type: str = "",
    crv: Optional[float] = None,
    strategy_module: str = "",
):
    """Push when a candidate's breakout trigger price is hit."""
    crv_str = f" · CRV {crv:.1f}" if crv else ""
    module_str = f" [{strategy_module}]" if strategy_module else ""
    setup_str = f" · {setup_type}" if setup_type else ""
    send_push(
        title=f"⚡ {ticker} Trigger erreicht!{module_str}",
        message=(
            f"Preis: ${current_price:.2f} ≥ Trigger ${trigger_price:.2f}"
            f"{setup_str}{crv_str}\nSetup jetzt aktiv — Entry prüfen."
        ),
        priority="high",
        tags="zap",
    )


def notify_entry_zone(
    ticker: str,
    price: float,
    entry_low: float,
    entry_high: float,
    setup_type: str = "",
    crv: Optional[float] = None,
):
    """Push when a pending TradePlan enters the entry zone."""
    from backend.database import get_ntfy_alerts, set_ntfy_entry_sent, was_ntfy_entry_sent
    if not get_ntfy_alerts().get("alerts_entry_zone", True):
        return
    if was_ntfy_entry_sent(ticker):
        return

    crv_str = f" · CRV {crv:.1f}" if crv else ""
    setup_str = f" · {setup_type}" if setup_type else ""
    send_push(
        title=f"🚨 {ticker} in Kaufzone!",
        message=f"Preis: ${price:.2f} (Zone ${entry_low:.2f}–${entry_high:.2f}){setup_str}{crv_str}",
        priority="high",
        tags="rotating_light",
    )
    set_ntfy_entry_sent(ticker)


def notify_market_update_critical(ticker: str, alert_msg: str, market_change: float):
    """🔴 Critical alert — immediate push for stop-loss proximity or major risk."""
    change_str = f"{market_change:+.1f}%" if market_change else ""
    send_push(
        title=f"🔴 PORTFOLIO ALERT: {ticker}",
        message=f"{alert_msg}\nMarkt heute {change_str}. Sofort prüfen.",
        priority="urgent",
        tags="rotating_light",
    )


def notify_market_update_warning(positions_affected: int, market_change: float):
    """🟠 Warning — push + email for review-worthy market move."""
    change_str = f"{market_change:+.1f}%" if market_change else ""
    send_push(
        title="🟠 Portfolio Review empfohlen",
        message=f"{positions_affected} Position(en) unter Druck nach {change_str} Tag. Details im Scanner.",
        priority="high",
        tags="warning",
    )


# ---------------------------------------------------------------------------
# Email via Resend
# ---------------------------------------------------------------------------

def send_email(subject: str, html_body: str) -> bool:
    """Send email via Resend API."""
    if not settings.resend_api_key or not settings.notification_email:
        logger.debug("Resend not configured, skipping email")
        return False

    try:
        import resend
        resend.api_key = settings.resend_api_key
        resend.Emails.send({
            "from": "swing-scanner@resend.dev",
            "to": settings.notification_email,
            "subject": subject,
            "html": html_body,
        })
        logger.info("Email sent: %s", subject)
        return True
    except Exception as exc:
        logger.error("Resend email failed: %s", exc)
        return False


def send_daily_summary_email(
    regime: str,
    top_candidates: list[dict],
    active_signals: list[dict],
    watchlist_alerts: list[str],
    market_update: Optional[dict] = None,
):
    """Send formatted daily summary email."""
    candidates_html = "".join([
        f"<li><b>{c.get('ticker')}</b> — {c.get('setup_type')} "
        f"(confidence: {c.get('confidence')})</li>"
        for c in top_candidates[:3]
    ])
    signals_html = "".join([
        f"<li><b>{s.get('ticker')}</b> — {s.get('signal_type')}: {s.get('description')}</li>"
        for s in active_signals
    ])
    watchlist_html = "".join([f"<li>{t}</li>" for t in watchlist_alerts])

    regime_color = {"bull": "#22c55e", "bear": "#ef4444", "neutral": "#f59e0b"}.get(regime, "#6b7280")

    # Market update section
    market_update_html = ""
    if market_update:
        spy = market_update.get("spy_change_pct")
        qqq = market_update.get("qqq_change_pct")
        spy_str = f"S&P {spy:+.1f}%" if spy is not None else ""
        qqq_str = f"NASDAQ {qqq:+.1f}%" if qqq is not None else ""
        summary = market_update.get("portfolio_summary", "")
        action = market_update.get("overall_action", "hold_all")
        action_color = {"hold_all": "#22c55e", "review_positions": "#f59e0b", "defensive": "#ef4444"}.get(action, "#6b7280")

        alerts_html = ""
        critical_json = market_update.get("critical_alerts_json")
        if critical_json:
            try:
                alerts = _json.loads(critical_json)
                alerts_html = "".join([
                    f"<li style='color:#ef4444'><b>{a.get('ticker')}</b>: {a.get('alert')}</li>"
                    for a in alerts
                ])
            except Exception:
                pass

        market_update_html = f"""
    <h3>📊 Market Update</h3>
    <p>{spy_str} | {qqq_str}</p>
    <p><b>Empfehlung:</b> <span style="color:{action_color}; font-weight:bold;">{action.replace('_', ' ').upper()}</span></p>
    <p>{summary}</p>
    {f'<ul>{alerts_html}</ul>' if alerts_html else ''}
    """

    html = f"""
    <html><body style="font-family: sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px;">
    <h2>📊 Swing Scanner Daily Summary</h2>
    <p><b>Market Regime:</b> <span style="color:{regime_color}; font-weight:bold;">{regime.upper()}</span></p>

    {market_update_html}

    <h3>Top Scanner Candidates</h3>
    <ul>{candidates_html if candidates_html else "<li>No candidates today</li>"}</ul>

    <h3>Active Portfolio Signals</h3>
    <ul>{signals_html if signals_html else "<li>No active signals</li>"}</ul>

    <h3>Watchlist Alerts</h3>
    <ul>{watchlist_html if watchlist_html else "<li>No alerts triggered</li>"}</ul>
    </body></html>
    """

    send_email("Swing Scanner Daily Summary", html)
