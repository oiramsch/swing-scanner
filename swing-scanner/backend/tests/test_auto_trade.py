"""
Unit tests for Phase 3 — Paper Auto-Trading safety limits.
All Alpaca/broker calls are mocked — no real network traffic.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session, delete

import backend.database as _db
from backend.database import (
    AppSetting,
    BrokerConnection,
    ScanResult,
    TradePlan,
    count_active_auto_trades,
    get_paper_auto_trading,
    set_paper_auto_trading,
    save_trade_plan,
    get_active_trade_plans,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clear(engine, *models):
    with Session(engine) as s:
        for m in models:
            s.exec(delete(m))
        s.commit()


def _make_candidate(ticker="AAPL", status="active", direction="long") -> ScanResult:
    return ScanResult(
        ticker=ticker,
        scan_date=date.today(),
        setup_type="breakout",
        confidence=7,
        entry_zone="145.00-148.00",
        stop_loss="142.00",
        target="160.00",
        candidate_status=status,
        direction=direction,
    )


def _make_paper_conn(engine) -> BrokerConnection:
    conn = BrokerConnection(
        tenant_id=1,
        broker_type="alpaca",
        label="Alpaca Paper Test",
        is_paper=True,
        is_active=True,
    )
    with Session(engine) as s:
        s.add(conn)
        s.commit()
        s.refresh(conn)
        return conn


# ---------------------------------------------------------------------------
# Feature-Flag tests
# ---------------------------------------------------------------------------

def test_feature_flag_default_false(engine):
    """PAPER_AUTO_TRADING defaults to False if not set."""
    _clear(engine, AppSetting)
    assert get_paper_auto_trading() is False


def test_feature_flag_toggle(engine):
    """set_paper_auto_trading() persists and is readable via get_paper_auto_trading()."""
    _clear(engine, AppSetting)
    set_paper_auto_trading(True)
    assert get_paper_auto_trading() is True
    set_paper_auto_trading(False)
    assert get_paper_auto_trading() is False


# ---------------------------------------------------------------------------
# Safety Limit 1 — Paper Guard
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_safety_hard_paper_guard(engine):
    """
    Safety Limit 1: If the broker connection has is_paper=False the job MUST
    abort immediately and send an urgent push notification.
    """
    _clear(engine, AppSetting, BrokerConnection, ScanResult)
    set_paper_auto_trading(True)

    # Create a LIVE (not paper) broker connection
    live_conn = BrokerConnection(
        tenant_id=1, broker_type="alpaca", label="Alpaca Live",
        is_paper=False, is_active=True,
    )
    with Session(engine) as s:
        s.add(live_conn)
        s.commit()
        s.refresh(live_conn)

    with patch("backend.scheduler.get_all_broker_connections", return_value=[live_conn]), \
         patch("backend.scheduler.get_results_for_date", return_value=[_make_candidate()]), \
         patch("backend.scheduler.send_push") as mock_push:
        from backend.scheduler import auto_paper_trade
        await auto_paper_trade({})

    # Must have sent an urgent push about the hard guard
    calls = [str(c) for c in mock_push.call_args_list]
    assert any("BLOCKED" in c or "Hard Guard" in c or "urgent" in c for c in calls), (
        "Expected urgent push for live-account guard violation"
    )


# ---------------------------------------------------------------------------
# Safety Limit 2 — Feature flag off
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_safety_feature_flag_off(engine):
    """Safety Limit 2: job returns immediately if PAPER_AUTO_TRADING=False."""
    _clear(engine, AppSetting)
    set_paper_auto_trading(False)

    with patch("backend.scheduler.get_results_for_date") as mock_results:
        from backend.scheduler import auto_paper_trade
        await auto_paper_trade({})
        # Should not even query candidates
        mock_results.assert_not_called()


# ---------------------------------------------------------------------------
# Safety Limit 3 — Max 3 concurrent auto-trades
# ---------------------------------------------------------------------------

def test_safety_count_active_auto_trades(engine):
    """count_active_auto_trades() correctly counts open auto-trade plans."""
    _clear(engine, TradePlan)

    # Add 2 auto trades + 1 manual
    with Session(engine) as s:
        s.add(TradePlan(ticker="AAPL", entry_low=140, entry_high=148, stop_loss=135,
                        target=160, auto_trade=True, status="active"))
        s.add(TradePlan(ticker="MSFT", entry_low=300, entry_high=310, stop_loss=290,
                        target=340, auto_trade=True, status="pending"))
        s.add(TradePlan(ticker="GOOG", entry_low=150, entry_high=155, stop_loss=145,
                        target=170, auto_trade=False, status="active"))
        s.commit()

    assert count_active_auto_trades(tenant_id=1) == 2


@pytest.mark.asyncio
async def test_safety_max_3_auto_trades_blocks_new(engine):
    """
    Safety Limit 3: When 3 auto-trades are already open, no new orders are placed.
    """
    _clear(engine, AppSetting, BrokerConnection, ScanResult, TradePlan)
    set_paper_auto_trading(True)

    paper_conn = _make_paper_conn(engine)

    # Pre-fill 3 active auto-trade plans
    with Session(engine) as s:
        for ticker in ("AAPL", "MSFT", "GOOG"):
            s.add(TradePlan(ticker=ticker, entry_low=140, entry_high=148,
                            stop_loss=135, target=160,
                            auto_trade=True, status="active"))
        s.commit()

    placed_orders = []
    mock_connector = MagicMock()
    mock_connector.place_order.side_effect = lambda p: placed_orders.append(p)

    with patch("backend.scheduler.get_all_broker_connections", return_value=[paper_conn]), \
         patch("backend.scheduler.get_results_for_date", return_value=[_make_candidate("TSLA")]), \
         patch("backend.scheduler.get_connector", return_value=mock_connector), \
         patch("backend.scheduler.count_active_auto_trades", return_value=3):
        from backend.scheduler import auto_paper_trade
        await auto_paper_trade({})

    assert len(placed_orders) == 0, "Expected no orders when 3 auto-trades already open"


# ---------------------------------------------------------------------------
# Safety Limit 4 — Max 5% of account per trade
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_safety_position_size_5pct(engine):
    """
    Safety Limit 4: qty is calculated so that risk <= 5% of buying_power.
    """
    _clear(engine, AppSetting, BrokerConnection, ScanResult, TradePlan)
    set_paper_auto_trading(True)

    paper_conn = _make_paper_conn(engine)

    # Candidate: entry=148, stop=142 → risk_per_share = 6
    # buying_power = 10_000 → max_risk = 500 → qty = 500 / 6 = 83
    candidate = _make_candidate("AAPL")

    placed_orders = []
    mock_connector = MagicMock()
    mock_connector.get_balance.return_value = {"buying_power": 10_000, "is_paper": True}
    mock_connector.get_portfolio.return_value = []
    mock_connector.place_order.side_effect = lambda p: placed_orders.append(p) or {"limit_price": 148}

    with patch("backend.scheduler.get_all_broker_connections", return_value=[paper_conn]), \
         patch("backend.scheduler.get_results_for_date", return_value=[candidate]), \
         patch("backend.scheduler.get_connector", return_value=mock_connector), \
         patch("backend.scheduler.count_active_auto_trades", return_value=0), \
         patch("backend.scheduler.save_trade_plan", return_value=MagicMock()):
        from backend.scheduler import auto_paper_trade
        await auto_paper_trade({})

    assert len(placed_orders) == 1
    qty = placed_orders[0]["qty"]
    # qty should be floor(500 / 6) = 83
    assert qty == 83, f"Expected qty=83, got {qty}"
    # Verify max risk: qty * risk_per_share <= 5% of 10_000
    risk = qty * 6  # 6 = 148 - 142
    assert risk <= 500, f"Risk {risk} exceeds 5% limit of 500"


# ---------------------------------------------------------------------------
# PDT guard — skip ticker with existing position
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_safety_pdt_existing_position_skipped(engine):
    """PDT guard: if an open position exists for the ticker, skip it."""
    _clear(engine, AppSetting, BrokerConnection, ScanResult, TradePlan)
    set_paper_auto_trading(True)

    paper_conn = _make_paper_conn(engine)
    candidate = _make_candidate("AAPL")

    placed_orders = []
    mock_connector = MagicMock()
    mock_connector.get_balance.return_value = {"buying_power": 50_000, "is_paper": True}
    # Simulate existing open position for AAPL → PDT guard fires
    mock_connector.get_portfolio.return_value = [{"ticker": "AAPL", "qty": 100}]
    mock_connector.place_order.side_effect = lambda p: placed_orders.append(p)

    with patch("backend.scheduler.get_all_broker_connections", return_value=[paper_conn]), \
         patch("backend.scheduler.get_results_for_date", return_value=[candidate]), \
         patch("backend.scheduler.get_connector", return_value=mock_connector), \
         patch("backend.scheduler.count_active_auto_trades", return_value=0):
        from backend.scheduler import auto_paper_trade
        await auto_paper_trade({})

    assert len(placed_orders) == 0, "Expected no order placed due to PDT guard"
