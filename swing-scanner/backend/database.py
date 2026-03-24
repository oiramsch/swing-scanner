"""
SQLModel database models and CRUD helpers.
"""
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, delete, select

from backend.config import settings

logger = logging.getLogger(__name__)

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            connect_args={"check_same_thread": False},
        )
    return _engine


def init_db():
    SQLModel.metadata.create_all(get_engine())
    _apply_migrations()
    _seed_default_filters()
    _migrate_filter_defaults()
    _seed_strategy_modules()
    logger.info("Database initialized.")


def _apply_migrations():
    """Add missing columns to existing tables (safe ALTER TABLE migrations)."""
    new_cols = [
        ("scanresult", "flags", "TEXT"),
        ("scanresult", "gap_pct", "REAL"),
        ("scanresult", "has_earnings_recent", "INTEGER DEFAULT 0"),
        ("scanresult", "has_earnings_upcoming", "INTEGER DEFAULT 0"),
        ("scanresult", "has_corporate_action", "INTEGER DEFAULT 0"),
        ("scanresult", "news_headlines", "TEXT"),
        ("scanresult", "news_sentiment", "TEXT"),
        ("scanresult", "news_warning", "TEXT"),
        ("scanresult", "crv_calculated", "REAL"),
        ("scanresult", "crv_valid", "INTEGER DEFAULT 1"),
        ("scanresult", "technical_setup_valid", "INTEGER DEFAULT 1"),
        ("scanresult", "invalidation_reason", "TEXT"),
        # v2.2 — Trade-Setting fields on PortfolioPosition
        ("portfolioposition", "trade_type", "TEXT"),
        ("portfolioposition", "action_setting_json", "TEXT"),
        ("portfolioposition", "stop_loss_initial", "REAL"),
        ("portfolioposition", "stop_loss_trailing", "INTEGER"),
        ("portfolioposition", "target_1", "REAL"),
        ("portfolioposition", "target_2", "REAL"),
        ("portfolioposition", "target_1_action", "TEXT"),
        ("portfolioposition", "target_2_action", "TEXT"),
        ("portfolioposition", "hold_days_min", "INTEGER"),
        ("portfolioposition", "hold_days_max", "INTEGER"),
        ("portfolioposition", "exit_trigger_json", "TEXT"),
        ("portfolioposition", "position_size_warning", "TEXT"),
        ("portfolioposition", "setting_generated_at", "TEXT"),
        # v2.3 — FilterProfile volume_multiplier
        ("filterprofile", "volume_multiplier", "REAL DEFAULT 1.5"),
        # v2.5 — ScanResult strategy_module tag
        ("scanresult", "strategy_module", "TEXT"),
        # v2.5 — candidate quality status
        # active | watchlist_pending | direction_mismatch | filtered_avoid
        ("scanresult", "candidate_status", "TEXT DEFAULT 'active'"),
        # v2.6 — CRV-adjusted composite score for ranking
        ("scanresult", "composite_score", "REAL"),
    ]
    engine = get_engine()
    with engine.connect() as conn:
        for table, col, col_type in new_cols:
            try:
                conn.execute(
                    __import__("sqlalchemy").text(
                        f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"
                    )
                )
                conn.commit()
                logger.info("Migration: added column %s.%s", table, col)
            except Exception:
                pass  # Column already exists — ignore


def get_session():
    with Session(get_engine()) as session:
        yield session


def _migrate_filter_defaults():
    """
    v2.4 — Ensure the 3 built-in filter presets have the correct canonical values.
    Runs on every startup; only touches rows whose name matches exactly.
    User-created custom filters are never modified.
    """
    import sqlalchemy
    engine = get_engine()
    updates = [
        # name, column, value
        # Strikt — high quality, few results
        ("Strikt", "price_min",          20.0),
        ("Strikt", "price_max",         500.0),
        ("Strikt", "avg_volume_min",  1000000),
        ("Strikt", "rsi_min",            45.0),
        ("Strikt", "rsi_max",            70.0),
        ("Strikt", "price_above_sma50",     1),  # True
        ("Strikt", "price_above_sma20",     0),  # False
        ("Strikt", "volume_multiplier",   1.5),
        ("Strikt", "confidence_min",        7),
        # Standard — recommended default (bear-aware: sma20 not sma50)
        ("Standard", "price_min",        10.0),
        ("Standard", "price_max",       500.0),
        ("Standard", "avg_volume_min",  500000),
        ("Standard", "rsi_min",          35.0),
        ("Standard", "rsi_max",          75.0),
        ("Standard", "price_above_sma50",   0),  # False — sma50 too restrictive in bear
        ("Standard", "price_above_sma20",   1),  # True  — requires short-term uptrend
        ("Standard", "volume_multiplier", 1.0),
        ("Standard", "confidence_min",      6),
        # Breit — maximum results, more noise
        ("Breit", "price_min",            5.0),
        ("Breit", "price_max",          999.0),
        ("Breit", "avg_volume_min",    200000),
        ("Breit", "rsi_min",             25.0),
        ("Breit", "rsi_max",             80.0),
        ("Breit", "price_above_sma50",      0),  # False
        ("Breit", "price_above_sma20",      0),  # False
        ("Breit", "volume_multiplier",    0.8),
        ("Breit", "confidence_min",         5),
    ]
    with engine.connect() as conn:
        for name, col, val in updates:
            try:
                conn.execute(
                    sqlalchemy.text(
                        f"UPDATE filterprofile SET {col} = :val WHERE name = :name"
                    ),
                    {"val": val, "name": name},
                )
            except Exception as exc:
                logger.warning("Filter migration failed (%s.%s): %s", name, col, exc)
        conn.commit()
    logger.info("Filter defaults migration applied (Strikt / Standard / Breit).")


def _seed_default_filters():
    """Create the 3 built-in filter presets if none exist yet."""
    with Session(get_engine()) as session:
        existing = list(session.exec(select(FilterProfile)).all())
        if existing:
            return  # Already seeded — don't overwrite user settings

        defaults = [
            FilterProfile(
                name="Strikt",
                price_min=20.0,
                price_max=500.0,
                avg_volume_min=1_000_000,
                rsi_min=45.0,
                rsi_max=70.0,
                price_above_sma50=True,
                price_above_sma20=False,
                volume_multiplier=1.5,
                confidence_min=7,
                is_active=False,
            ),
            FilterProfile(
                name="Standard",
                price_min=10.0,
                price_max=500.0,
                avg_volume_min=500_000,
                rsi_min=35.0,
                rsi_max=75.0,
                price_above_sma50=False,
                price_above_sma20=True,
                volume_multiplier=1.0,
                confidence_min=6,
                is_active=True,   # ← default active
            ),
            FilterProfile(
                name="Breit",
                price_min=5.0,
                price_max=999.0,
                avg_volume_min=200_000,
                rsi_min=25.0,
                rsi_max=80.0,
                price_above_sma50=False,
                price_above_sma20=False,
                volume_multiplier=0.8,
                confidence_min=5,
                is_active=False,
            ),
        ]
        for fp in defaults:
            session.add(fp)
        session.commit()
        logger.info("Seeded 3 default filter profiles (Strikt / Standard / Breit).")


def _seed_strategy_modules():
    """Seed 3 built-in regime-switching strategy modules (runs only if none exist)."""
    with Session(get_engine()) as session:
        if session.exec(select(StrategyModule)).first():
            return  # already seeded

        modules = [
            # ── Modul 1: Bull Breakout ─────────────────────────────────────
            StrategyModule(
                name="Bull Breakout",
                description=(
                    "Classic bull-market filter. Requires price above SMA20 & SMA50. "
                    "Targets breakout and momentum setups in a confirmed uptrend."
                ),
                regime="bull",
                direction="long",
                is_active=True,
                auto_activate=True,
                price_min=15.0,
                price_max=500.0,
                avg_volume_min=500_000,
                rsi_min=45.0,
                rsi_max=75.0,
                price_above_sma20=True,
                price_above_sma50=True,
                close_above_sma200=None,   # don't filter — assumed in bull
                rsi_bear_cap=None,         # no bear cap in bull regime
                volume_multiplier=1.2,
                relative_strength_vs_spy=False,
                confidence_min=6,
                setup_types='["breakout","momentum"]',
            ),
            # ── Modul 2: Bear Relative Strength ───────────────────────────
            StrategyModule(
                name="Bear Relative Strength",
                description=(
                    "Bear-market filter. Finds 'spartans' — stocks holding up better than the "
                    "broad market. Removes SMA20/50 requirement; instead requires close > SMA200 "
                    "(long-term uptrend intact) and relative strength vs SPY over 20 days."
                ),
                regime="bear",
                direction="long",
                is_active=True,
                auto_activate=True,
                price_min=10.0,
                price_max=500.0,
                avg_volume_min=500_000,
                rsi_min=35.0,
                rsi_max=65.0,
                price_above_sma20=None,    # don't filter — most stocks are below SMA20 in bear
                price_above_sma50=False,   # explicitly disabled
                close_above_sma200=True,   # long-term uptrend must remain intact
                rsi_bear_cap=65.0,         # override default 60-cap → allow up to 65
                volume_multiplier=1.0,
                relative_strength_vs_spy=True,
                confidence_min=6,
                setup_types='["pullback","reversal","momentum"]',
            ),
            # ── Modul 3: Mean Reversion ───────────────────────────────────
            StrategyModule(
                name="Mean Reversion",
                description=(
                    "Catches extremely oversold stocks with reversal signals. "
                    "Price must be far below SMA20 (deep pullback), RSI < 40, "
                    "and close to major support (SMA200). Smaller position sizes recommended."
                ),
                regime="bear",  # also activates in neutral via any-logic
                direction="long",
                is_active=True,
                auto_activate=True,
                price_min=10.0,
                price_max=500.0,
                avg_volume_min=300_000,
                rsi_min=20.0,
                rsi_max=40.0,
                price_above_sma20=False,   # explicitly must be below SMA20 (deep pullback)
                price_above_sma50=False,
                close_above_sma200=None,   # don't require — stock may be deeply oversold
                rsi_bear_cap=None,         # RSI max=40 already handles this
                volume_multiplier=0.8,
                relative_strength_vs_spy=False,
                confidence_min=5,
                setup_types='["reversal","pullback"]',
                feature_flags_json='{"position_size_reduce": true, "note": "Reduce size 50% due to mean-reversion risk"}',
            ),
        ]
        for m in modules:
            session.add(m)
        session.commit()
        logger.info("Seeded 3 strategy modules: Bull Breakout / Bear Relative Strength / Mean Reversion.")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ScanResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticker: str = Field(index=True)
    scan_date: date = Field(index=True)
    setup_type: str = "none"
    pattern_name: Optional[str] = None
    confidence: int = 0
    entry_zone: Optional[str] = None
    stop_loss: Optional[str] = None
    target: Optional[str] = None
    risk_reward: Optional[str] = None
    reasoning: Optional[str] = None
    chart_path: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap: Optional[str] = None
    exchange: Optional[str] = None
    country: Optional[str] = None
    avg_volume: Optional[int] = None
    float_shares: Optional[float] = None
    pct_from_52w_high: Optional[float] = None
    has_deep_analysis: bool = False
    deep_analysis_json: Optional[str] = None
    # News & Corporate Action flags (v2.1)
    flags: Optional[str] = None              # JSON-Array: ["gap_up","post_earnings",...]
    gap_pct: Optional[float] = None          # Overnight gap in % (positive=up, negative=down)
    has_earnings_recent: bool = False         # Earnings in last 3 days
    has_earnings_upcoming: bool = False       # Earnings in next 5 days
    has_corporate_action: bool = False        # M&A, buyback, split, etc.
    news_headlines: Optional[str] = None     # JSON-Array: last 5 headlines
    news_sentiment: Optional[str] = None     # bullish|bearish|neutral|corporate_action
    news_warning: Optional[str] = None       # AI-generated one-sentence warning
    crv_calculated: Optional[float] = None   # Calculated CRV from entry/stop/target
    crv_valid: bool = True                   # True if CRV >= 1.5
    technical_setup_valid: bool = True       # False if news event invalidates technicals
    invalidation_reason: Optional[str] = None  # Explanation if technical_setup_valid=False
    strategy_module: Optional[str] = None   # v2.5 — which strategy module found this (e.g. "Bear Relative Strength")
    # v2.5 — output quality status
    # active             — normal, actionable candidate
    # watchlist_pending  — no full setup (entry+stop+target missing) → watch, not trade
    # direction_mismatch — stop > entry in a long module → hidden short setup
    # filtered_avoid     — deep analysis recommendation == "avoid"
    candidate_status: str = "active"
    # v2.6 — CRV-adjusted composite ranking score
    # Formula: confidence * clamp(crv / 2.0, 0.5, 1.5)
    # CRV=2.0 is neutral, below=penalty, above=bonus
    composite_score: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PerformanceResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    scan_result_id: int
    ticker: str
    scan_date: date
    entry_price_at_scan: float
    price_day1: Optional[float] = None
    price_day3: Optional[float] = None
    price_day5: Optional[float] = None
    price_day10: Optional[float] = None
    price_day20: Optional[float] = None
    entry_zone_hit: bool = False
    stop_triggered: bool = False
    target_reached: bool = False
    max_gain_pct: Optional[float] = None
    max_loss_pct: Optional[float] = None
    result: Optional[str] = None  # win|loss|breakeven|pending
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FilterProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    price_min: float = 10.0
    price_max: float = 500.0
    avg_volume_min: int = 500_000
    float_min: Optional[float] = None
    float_max: Optional[float] = None
    market_cap: str = "all"
    exchanges: str = '["NYSE","NASDAQ"]'
    country: str = '["US"]'
    sectors: str = '[]'
    industries: Optional[str] = None
    rsi_min: float = 45.0
    rsi_max: float = 70.0
    price_above_sma20: bool = False
    price_above_sma50: bool = True
    pct_from_52w_high_max: Optional[float] = None
    setup_types: str = '["breakout","pullback","pattern","momentum"]'
    confidence_min: int = 6
    respect_market_regime: bool = True
    volume_multiplier: float = 1.5
    is_active: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StrategyModule(SQLModel, table=True):
    """
    Regime-switching strategy module (v2.5).

    Each module defines a complete filter configuration tailored to a specific
    market regime. The scanner auto-selects all active modules matching the
    current regime and runs them in parallel.

    regime:  bull | bear | neutral | any
    direction: long | short | both  (short requires broker support)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    regime: str = "any"                     # bull | bear | neutral | any
    direction: str = "long"                 # long | short | both
    is_active: bool = True
    auto_activate: bool = True              # auto-use when regime matches
    # Price / volume filters
    price_min: float = 10.0
    price_max: float = 500.0
    avg_volume_min: int = 500_000
    # Technical filters (Optional = None means "skip this filter")
    rsi_min: float = 35.0
    rsi_max: float = 75.0
    price_above_sma20: Optional[bool] = None    # None = don't filter
    price_above_sma50: Optional[bool] = None    # None = don't filter
    close_above_sma200: Optional[bool] = None   # None = don't filter
    rsi_bear_cap: Optional[float] = None        # Override default 60-cap in bear regime
    volume_multiplier: float = 1.0
    relative_strength_vs_spy: bool = False      # Require ticker to outperform SPY 20d return
    # Output / ranking
    confidence_min: int = 6
    setup_types: str = '["breakout","pullback","pattern","momentum"]'
    # Feature flags as JSON: {"allow_short": false, "allow_earnings": false}
    feature_flags_json: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PortfolioBudget(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    start_budget: float = 10000.0
    risk_per_trade_pct: float = 1.0
    max_positions: int = 10
    max_sector_exposure_pct: float = 30.0
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PortfolioPosition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticker: str
    entry_date: date
    entry_price: float
    shares: float
    position_value: float
    stop_loss: float
    target: Optional[float] = None
    risk_amount: float = 0.0
    risk_reward: Optional[float] = None
    notes: Optional[str] = None
    setup_type: Optional[str] = None
    sector: Optional[str] = None
    scan_result_id: Optional[int] = None
    is_open: bool = True
    exit_date: Optional[date] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None
    pnl_eur: Optional[float] = None
    pnl_pct: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Trade-Setting fields (v2.2)
    trade_type: Optional[str] = None               # swing|position
    action_setting_json: Optional[str] = None      # Full AI-generated setting as JSON
    stop_loss_initial: Optional[float] = None
    stop_loss_trailing: Optional[bool] = None
    target_1: Optional[float] = None
    target_2: Optional[float] = None
    target_1_action: Optional[str] = None          # e.g. "50% verkaufen"
    target_2_action: Optional[str] = None          # e.g. "Rest verkaufen"
    hold_days_min: Optional[int] = None
    hold_days_max: Optional[int] = None
    exit_trigger_json: Optional[str] = None        # JSON array of exit triggers
    position_size_warning: Optional[str] = None
    setting_generated_at: Optional[datetime] = None


class SignalAlert(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    position_id: int
    ticker: str
    signal_type: str
    signal_date: date
    price_at_signal: float
    description: str
    is_notified: bool = False
    severity: str = "medium"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class JournalEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    position_id: Optional[int] = None
    trade_date: date
    ticker: str
    setup_reason: str = ""
    setup_type: Optional[str] = None
    chart_path: Optional[str] = None
    entry_price: float
    stop_loss: float
    target: float
    risk_eur: float = 0.0
    risk_reward: float = 0.0
    position_size: int = 0
    exit_price: Optional[float] = None
    exit_date: Optional[date] = None
    pnl_eur: Optional[float] = None
    pnl_pct: Optional[float] = None
    emotion_entry: Optional[str] = None
    emotion_exit: Optional[str] = None
    followed_rules: Optional[bool] = None
    lesson: Optional[str] = None
    mistakes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WatchlistItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticker: str
    added_date: date
    reason: str
    alert_condition: str = ""
    sector: Optional[str] = None
    scan_result_id: Optional[int] = None
    is_active: bool = True
    triggered: bool = False
    triggered_date: Optional[date] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MarketRegime(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    spy_close: float
    spy_sma50: float
    spy_sma200: float
    regime: str  # bull|bear|neutral
    vix_level: Optional[float] = None
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PredictionArchive(SQLModel, table=True):
    """
    Ghost Portfolio — silent ML data collector (v2.5 / Phase 1.7).

    Every active + watchlist_pending scan result is archived here automatically.
    A daily cron job resolves PENDING predictions against EOD data.
    This table is the ground truth for future ML training (Phase 4).

    Status lifecycle:
      PENDING  → WIN      if daily_high >= target_price
      PENDING  → LOSS     if daily_low  <= stop_loss
      PENDING  → TIMEOUT  if age >= 14 days (neither stop nor target hit)

    TIMEOUT is a distinct label — never reclassified to LOSS.
    Predictions without stop/target (watchlist_pending) stay PENDING
    until manually resolved or TIMEOUT.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    scan_date: date = Field(index=True)          # The date the scan ran
    ticker: str = Field(index=True)
    regime: str                                  # bull | bear | neutral
    strategy_module: str = "unknown"             # which module found this
    candidate_status: str = "active"             # active | watchlist_pending
    setup_type: Optional[str] = None
    # Trade levels (parsed floats — None for watchlist_pending without setup)
    entry_price: Optional[float] = None          # midpoint of entry_zone
    stop_loss: Optional[float] = None
    target_price: Optional[float] = None
    crv: Optional[float] = None
    confidence: int = 0
    # Resolution
    status: str = "PENDING"                      # PENDING | WIN | LOSS | TIMEOUT
    resolved_at: Optional[datetime] = None
    resolved_price: Optional[float] = None
    days_to_resolve: Optional[int] = None
    notes: Optional[str] = None


class ScanFunnel(SQLModel, table=True):
    """Persists the filter funnel breakdown for every scan run."""
    id: Optional[int] = Field(default=None, primary_key=True)
    scan_date: date
    ran_at: datetime = Field(default_factory=datetime.utcnow)
    regime: str = "unknown"
    filter_profile: Optional[str] = None
    # Counts per pipeline step
    universe_count:   int = 0
    snapshot_count:   int = 0
    pre_filter_count: int = 0
    ohlcv_fetched:    int = 0
    ohlcv_failed:     int = 0
    # Rejection reasons (first-failure counts)
    fail_insufficient_bars: int = 0
    fail_nan_indicators:    int = 0
    fail_price_range:       int = 0
    fail_volume_min:        int = 0
    fail_sma50:             int = 0
    fail_sma20:             int = 0
    fail_rsi_range:         int = 0
    fail_rsi_bear:          int = 0
    fail_volume_surge:      int = 0
    fail_error:             int = 0
    # Output
    candidates_count: int = 0
    # Full params snapshot for reproducibility
    filter_params_json: Optional[str] = None


class MarketUpdate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    update_date: date
    update_type: str = "auto"             # auto|manual
    # Market context
    spy_change_pct: Optional[float] = None
    qqq_change_pct: Optional[float] = None
    vix_level: Optional[float] = None
    market_regime: Optional[str] = None   # bull|bear|neutral
    sector_movers_json: Optional[str] = None  # JSON: top/worst sectors
    # Portfolio impact
    positions_affected_json: Optional[str] = None
    critical_alerts_json: Optional[str] = None
    portfolio_summary: Optional[str] = None
    # Recommendations
    recommendations_json: Optional[str] = None
    overall_action: Optional[str] = None  # hold_all|review_positions|defensive
    # Notification
    notification_sent: bool = False
    notification_level: Optional[str] = None  # info|warning|critical
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# ScanResult CRUD
# ---------------------------------------------------------------------------

def clear_results_for_date(scan_date: date):
    with Session(get_engine()) as session:
        session.exec(delete(ScanResult).where(ScanResult.scan_date == scan_date))
        session.commit()


def save_scan_result(result: ScanResult) -> ScanResult:
    with Session(get_engine()) as session:
        session.add(result)
        session.commit()
        session.refresh(result)
        return result


def get_results_for_date(scan_date: date) -> list[ScanResult]:
    with Session(get_engine()) as session:
        stmt = (
            select(ScanResult)
            .where(ScanResult.scan_date == scan_date)
            # Sort by composite_score (CRV-adjusted) falling back to raw confidence
            .order_by(
                ScanResult.composite_score.desc().nulls_last(),
                ScanResult.confidence.desc(),
            )
        )
        return list(session.exec(stmt).all())


def get_result_by_ticker(ticker: str, scan_date: date) -> Optional[ScanResult]:
    with Session(get_engine()) as session:
        stmt = (
            select(ScanResult)
            .where(ScanResult.ticker == ticker)
            .where(ScanResult.scan_date == scan_date)
        )
        return session.exec(stmt).first()


def update_deep_analysis(result_id: int, deep_json: dict):
    with Session(get_engine()) as session:
        result = session.get(ScanResult, result_id)
        if result:
            result.has_deep_analysis = True
            result.deep_analysis_json = json.dumps(deep_json)
            session.add(result)
            session.commit()


def get_scan_dates() -> list[date]:
    with Session(get_engine()) as session:
        results = list(session.exec(select(ScanResult.scan_date)).all())
        return sorted(set(results), reverse=True)


def get_recent_scan_results(days: int = 20) -> list[ScanResult]:
    cutoff = date.today() - timedelta(days=days)
    with Session(get_engine()) as session:
        stmt = select(ScanResult).where(ScanResult.scan_date >= cutoff)
        return list(session.exec(stmt).all())


def update_candidate_status(result_id: int, status: str) -> None:
    """Set the candidate_status for a ScanResult (used by post-processing filters)."""
    with Session(get_engine()) as session:
        result = session.get(ScanResult, result_id)
        if result:
            result.candidate_status = status
            session.add(result)
            session.commit()


def get_watchlist_pending(scan_date: date) -> list[ScanResult]:
    """Return candidates with no full setup — for the 'watch, not trade' section."""
    with Session(get_engine()) as session:
        stmt = (
            select(ScanResult)
            .where(ScanResult.scan_date == scan_date)
            .where(ScanResult.candidate_status == "watchlist_pending")
            .order_by(ScanResult.confidence.desc())
        )
        return list(session.exec(stmt).all())


# ---------------------------------------------------------------------------
# FilterProfile CRUD
# ---------------------------------------------------------------------------

def get_active_filter() -> Optional[FilterProfile]:
    with Session(get_engine()) as session:
        stmt = select(FilterProfile).where(FilterProfile.is_active == True)
        return session.exec(stmt).first()


def get_all_filters() -> list[FilterProfile]:
    with Session(get_engine()) as session:
        return list(session.exec(select(FilterProfile)).all())


def save_filter(fp: FilterProfile) -> FilterProfile:
    with Session(get_engine()) as session:
        session.add(fp)
        session.commit()
        session.refresh(fp)
        return fp


def update_filter(filter_id: int, data: dict) -> Optional[FilterProfile]:
    with Session(get_engine()) as session:
        fp = session.get(FilterProfile, filter_id)
        if not fp:
            return None
        for k, v in data.items():
            if hasattr(fp, k):
                setattr(fp, k, v)
        session.add(fp)
        session.commit()
        session.refresh(fp)
        return fp


def activate_filter(filter_id: int):
    with Session(get_engine()) as session:
        for fp in session.exec(select(FilterProfile)).all():
            fp.is_active = False
            session.add(fp)
        target = session.get(FilterProfile, filter_id)
        if target:
            target.is_active = True
            session.add(target)
        session.commit()


def delete_filter(filter_id: int):
    with Session(get_engine()) as session:
        fp = session.get(FilterProfile, filter_id)
        if fp:
            session.delete(fp)
            session.commit()


# ---------------------------------------------------------------------------
# StrategyModule CRUD
# ---------------------------------------------------------------------------

def get_all_modules() -> list[StrategyModule]:
    with Session(get_engine()) as session:
        return list(session.exec(select(StrategyModule)).all())


def get_modules_for_regime(regime: str) -> list[StrategyModule]:
    """Return active auto-activating modules for a given regime (includes 'any')."""
    with Session(get_engine()) as session:
        stmt = select(StrategyModule).where(
            StrategyModule.is_active == True,
            StrategyModule.auto_activate == True,
        )
        all_active = list(session.exec(stmt).all())
    return [m for m in all_active if m.regime in (regime, "any")]


def get_module(module_id: int) -> Optional[StrategyModule]:
    with Session(get_engine()) as session:
        return session.get(StrategyModule, module_id)


def save_module(m: StrategyModule) -> StrategyModule:
    with Session(get_engine()) as session:
        session.add(m)
        session.commit()
        session.refresh(m)
        return m


def update_module(module_id: int, data: dict) -> Optional[StrategyModule]:
    with Session(get_engine()) as session:
        m = session.get(StrategyModule, module_id)
        if not m:
            return None
        for k, v in data.items():
            if hasattr(m, k):
                setattr(m, k, v)
        session.add(m)
        session.commit()
        session.refresh(m)
        return m


# ---------------------------------------------------------------------------
# PortfolioBudget CRUD
# ---------------------------------------------------------------------------

def get_budget() -> PortfolioBudget:
    with Session(get_engine()) as session:
        budgets = list(session.exec(select(PortfolioBudget)).all())
        if budgets:
            return budgets[0]
        default = PortfolioBudget()
        session.add(default)
        session.commit()
        session.refresh(default)
        return default


def update_budget(data: dict) -> PortfolioBudget:
    with Session(get_engine()) as session:
        budgets = list(session.exec(select(PortfolioBudget)).all())
        budget = budgets[0] if budgets else PortfolioBudget()
        for k, v in data.items():
            if hasattr(budget, k):
                setattr(budget, k, v)
        budget.updated_at = datetime.utcnow()
        session.add(budget)
        session.commit()
        session.refresh(budget)
        return budget


# ---------------------------------------------------------------------------
# PortfolioPosition CRUD
# ---------------------------------------------------------------------------

def get_open_positions() -> list[PortfolioPosition]:
    with Session(get_engine()) as session:
        stmt = select(PortfolioPosition).where(PortfolioPosition.is_open == True)
        return list(session.exec(stmt).all())


def get_closed_positions() -> list[PortfolioPosition]:
    with Session(get_engine()) as session:
        stmt = (
            select(PortfolioPosition)
            .where(PortfolioPosition.is_open == False)
            .order_by(PortfolioPosition.exit_date.desc())
        )
        return list(session.exec(stmt).all())


def get_position(position_id: int) -> Optional[PortfolioPosition]:
    with Session(get_engine()) as session:
        return session.get(PortfolioPosition, position_id)


def save_position(pos: PortfolioPosition) -> PortfolioPosition:
    with Session(get_engine()) as session:
        session.add(pos)
        session.commit()
        session.refresh(pos)
        return pos


def update_position(position_id: int, data: dict) -> Optional[PortfolioPosition]:
    with Session(get_engine()) as session:
        pos = session.get(PortfolioPosition, position_id)
        if not pos:
            return None
        for k, v in data.items():
            if hasattr(pos, k):
                setattr(pos, k, v)
        session.add(pos)
        session.commit()
        session.refresh(pos)
        return pos


# ---------------------------------------------------------------------------
# SignalAlert CRUD
# ---------------------------------------------------------------------------

def save_signal(signal: SignalAlert) -> SignalAlert:
    with Session(get_engine()) as session:
        session.add(signal)
        session.commit()
        session.refresh(signal)
        return signal


def get_signals_for_position(position_id: int) -> list[SignalAlert]:
    with Session(get_engine()) as session:
        stmt = select(SignalAlert).where(SignalAlert.position_id == position_id)
        return list(session.exec(stmt).all())


def get_unnotified_signals() -> list[SignalAlert]:
    with Session(get_engine()) as session:
        stmt = select(SignalAlert).where(SignalAlert.is_notified == False)
        return list(session.exec(stmt).all())


def mark_signals_notified(signal_ids: list[int]):
    with Session(get_engine()) as session:
        for sid in signal_ids:
            sig = session.get(SignalAlert, sid)
            if sig:
                sig.is_notified = True
                session.add(sig)
        session.commit()


# ---------------------------------------------------------------------------
# JournalEntry CRUD
# ---------------------------------------------------------------------------

def save_journal_entry(entry: JournalEntry) -> JournalEntry:
    with Session(get_engine()) as session:
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry


def get_journal_entries(
    ticker: Optional[str] = None,
    setup_type: Optional[str] = None,
    followed_rules: Optional[bool] = None,
) -> list[JournalEntry]:
    with Session(get_engine()) as session:
        stmt = select(JournalEntry)
        if ticker:
            stmt = stmt.where(JournalEntry.ticker == ticker.upper())
        if setup_type:
            stmt = stmt.where(JournalEntry.setup_type == setup_type)
        if followed_rules is not None:
            stmt = stmt.where(JournalEntry.followed_rules == followed_rules)
        stmt = stmt.order_by(JournalEntry.trade_date.desc())
        return list(session.exec(stmt).all())


def update_journal_entry(entry_id: int, data: dict) -> Optional[JournalEntry]:
    with Session(get_engine()) as session:
        entry = session.get(JournalEntry, entry_id)
        if not entry:
            return None
        for k, v in data.items():
            if hasattr(entry, k):
                setattr(entry, k, v)
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry


def get_journal_entry(entry_id: int) -> Optional[JournalEntry]:
    with Session(get_engine()) as session:
        return session.get(JournalEntry, entry_id)


# ---------------------------------------------------------------------------
# WatchlistItem CRUD
# ---------------------------------------------------------------------------

def get_watchlist() -> list[WatchlistItem]:
    with Session(get_engine()) as session:
        stmt = select(WatchlistItem).where(WatchlistItem.is_active == True)
        return list(session.exec(stmt).all())


def save_watchlist_item(item: WatchlistItem) -> WatchlistItem:
    with Session(get_engine()) as session:
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


def delete_watchlist_item(item_id: int):
    with Session(get_engine()) as session:
        item = session.get(WatchlistItem, item_id)
        if item:
            item.is_active = False
            session.add(item)
            session.commit()


def update_watchlist_item(item_id: int, data: dict) -> Optional[WatchlistItem]:
    with Session(get_engine()) as session:
        item = session.get(WatchlistItem, item_id)
        if not item:
            return None
        for k, v in data.items():
            if hasattr(item, k):
                setattr(item, k, v)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


# ---------------------------------------------------------------------------
# MarketRegime CRUD
# ---------------------------------------------------------------------------

def save_market_regime(regime: MarketRegime) -> MarketRegime:
    with Session(get_engine()) as session:
        session.add(regime)
        session.commit()
        session.refresh(regime)
        return regime


def get_latest_regime() -> Optional[MarketRegime]:
    with Session(get_engine()) as session:
        stmt = select(MarketRegime).order_by(MarketRegime.date.desc())
        return session.exec(stmt).first()


# ---------------------------------------------------------------------------
# PerformanceResult CRUD
# ---------------------------------------------------------------------------

def save_performance_result(perf: PerformanceResult) -> PerformanceResult:
    with Session(get_engine()) as session:
        session.add(perf)
        session.commit()
        session.refresh(perf)
        return perf


def get_performance_results(days: int = 30) -> list[PerformanceResult]:
    cutoff = date.today() - timedelta(days=days)
    with Session(get_engine()) as session:
        stmt = select(PerformanceResult).where(PerformanceResult.scan_date >= cutoff)
        return list(session.exec(stmt).all())


def update_performance_result(perf_id: int, data: dict) -> Optional[PerformanceResult]:
    with Session(get_engine()) as session:
        perf = session.get(PerformanceResult, perf_id)
        if not perf:
            return None
        for k, v in data.items():
            if hasattr(perf, k):
                setattr(perf, k, v)
        perf.updated_at = datetime.utcnow()
        session.add(perf)
        session.commit()
        session.refresh(perf)
        return perf


def get_performance_for_scan(scan_result_id: int) -> Optional[PerformanceResult]:
    with Session(get_engine()) as session:
        stmt = select(PerformanceResult).where(
            PerformanceResult.scan_result_id == scan_result_id
        )
        return session.exec(stmt).first()


# ---------------------------------------------------------------------------
# MarketUpdate CRUD
# ---------------------------------------------------------------------------

def save_market_update(update: MarketUpdate) -> MarketUpdate:
    with Session(get_engine()) as session:
        session.add(update)
        session.commit()
        session.refresh(update)
        return update


def get_latest_market_update() -> Optional[MarketUpdate]:
    with Session(get_engine()) as session:
        stmt = select(MarketUpdate).order_by(MarketUpdate.generated_at.desc())
        return session.exec(stmt).first()


def get_market_update_history(days: int = 7) -> list[MarketUpdate]:
    cutoff = date.today() - timedelta(days=days)
    with Session(get_engine()) as session:
        stmt = (
            select(MarketUpdate)
            .where(MarketUpdate.update_date >= cutoff)
            .order_by(MarketUpdate.generated_at.desc())
        )
        return list(session.exec(stmt).all())


def update_market_update_notified(update_id: int):
    with Session(get_engine()) as session:
        upd = session.get(MarketUpdate, update_id)
        if upd:
            upd.notification_sent = True
            session.add(upd)
            session.commit()


# ---------------------------------------------------------------------------
# ScanFunnel CRUD
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# PredictionArchive CRUD
# ---------------------------------------------------------------------------

def archive_prediction(pred: PredictionArchive) -> PredictionArchive:
    with Session(get_engine()) as session:
        session.add(pred)
        session.commit()
        session.refresh(pred)
        return pred


def get_archived_tickers_for_date(scan_date: date) -> set[str]:
    """Return set of tickers already archived for a given scan_date (for dedup)."""
    with Session(get_engine()) as session:
        stmt = select(PredictionArchive.ticker).where(
            PredictionArchive.scan_date == scan_date
        )
        return set(session.exec(stmt).all())


def get_pending_predictions() -> list[PredictionArchive]:
    """Return all predictions still awaiting resolution."""
    with Session(get_engine()) as session:
        stmt = (
            select(PredictionArchive)
            .where(PredictionArchive.status == "PENDING")
            .order_by(PredictionArchive.scan_date.asc())
        )
        return list(session.exec(stmt).all())


def resolve_prediction(
    pred_id: int,
    status: str,
    resolved_price: Optional[float] = None,
    notes: Optional[str] = None,
) -> None:
    with Session(get_engine()) as session:
        pred = session.get(PredictionArchive, pred_id)
        if not pred:
            return
        pred.status        = status
        pred.resolved_at   = datetime.utcnow()
        pred.resolved_price = resolved_price
        pred.days_to_resolve = (date.today() - pred.scan_date).days
        if notes:
            pred.notes = notes
        session.add(pred)
        session.commit()


def get_prediction_stats() -> dict:
    """
    Aggregate stats for the /api/predictions/stats endpoint.
    Returns overall counts + breakdown by regime and strategy_module.
    """
    with Session(get_engine()) as session:
        all_preds = list(session.exec(select(PredictionArchive)).all())

    if not all_preds:
        return {"total": 0, "message": "No predictions archived yet."}

    from collections import defaultdict

    total   = len(all_preds)
    pending = sum(1 for p in all_preds if p.status == "PENDING")
    wins    = sum(1 for p in all_preds if p.status == "WIN")
    losses  = sum(1 for p in all_preds if p.status == "LOSS")
    timeouts = sum(1 for p in all_preds if p.status == "TIMEOUT")

    decided = wins + losses
    win_rate = round(wins / decided * 100, 1) if decided else None

    # Avg days to resolve (WIN + LOSS only)
    resolved_days = [
        p.days_to_resolve for p in all_preds
        if p.status in ("WIN", "LOSS") and p.days_to_resolve is not None
    ]
    avg_days = round(sum(resolved_days) / len(resolved_days), 1) if resolved_days else None

    # Breakdown by regime
    by_regime: dict = defaultdict(lambda: {"WIN": 0, "LOSS": 0, "TIMEOUT": 0, "PENDING": 0})
    for p in all_preds:
        by_regime[p.regime][p.status] += 1

    # Breakdown by module
    by_module: dict = defaultdict(lambda: {"WIN": 0, "LOSS": 0, "TIMEOUT": 0, "PENDING": 0})
    for p in all_preds:
        by_module[p.strategy_module][p.status] += 1

    return {
        "total":         total,
        "pending":       pending,
        "wins":          wins,
        "losses":        losses,
        "timeouts":      timeouts,
        "win_rate_pct":  win_rate,
        "avg_days_to_resolve": avg_days,
        "by_regime":     dict(by_regime),
        "by_module":     dict(by_module),
        "note":          f"ML training ready when decided >= 500 (currently {decided})",
    }


def save_scan_funnel(funnel: ScanFunnel) -> ScanFunnel:
    with Session(get_engine()) as session:
        session.add(funnel)
        session.commit()
        session.refresh(funnel)
        return funnel


def get_latest_funnel() -> Optional[ScanFunnel]:
    with Session(get_engine()) as session:
        stmt = select(ScanFunnel).order_by(ScanFunnel.ran_at.desc())
        return session.exec(stmt).first()


def get_funnel_history(days: int = 30) -> list[ScanFunnel]:
    cutoff = date.today() - timedelta(days=days)
    with Session(get_engine()) as session:
        stmt = (
            select(ScanFunnel)
            .where(ScanFunnel.scan_date >= cutoff)
            .order_by(ScanFunnel.ran_at.desc())
        )
        return list(session.exec(stmt).all())
