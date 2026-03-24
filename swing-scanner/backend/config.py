from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
    )

    # ── Data Provider ─────────────────────────────────────────────────────────
    # yfinance: free, no key needed, S&P 500 universe (Phase 1-2 default)
    # alpaca:   uses Alpaca IEX feed (free plan, ~237 symbols via IEX)
    data_provider: str = "yfinance"

    # Universe of stocks to scan
    # sp500       — ~503 most liquid US stocks (recommended)
    # russell1000 — ~1 000 US large/mid caps
    # custom      — load from CUSTOM_SYMBOLS_FILE
    stock_universe: str = "sp500"

    # Path to a JSON file with ["AAPL", "MSFT", ...] for custom universe
    custom_symbols_file: str = ""

    # ── Alpaca (broker + optional data source) ────────────────────────────────
    # Used for: live portfolio quotes, paper/live trading orders (Phase 3)
    # NOT used for scanner data when DATA_PROVIDER=yfinance
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_paper: bool = True
    alpaca_base_url: str = "https://paper-api.alpaca.markets"

    # ── Polygon (legacy — kept for backward compatibility only) ───────────────
    # Previously used as primary data source. Now only referenced if explicitly
    # wired up in custom code. Can be left empty.
    polygon_api_key: str = ""
    polygon_rate_limit_sleep: float = 12.0

    # ── AI ────────────────────────────────────────────────────────────────────
    anthropic_api_key: str = ""

    # ── App ───────────────────────────────────────────────────────────────────
    database_url: str = "sqlite:///./swing_scanner.db"
    redis_url: str = "redis://localhost:6379"
    scan_time_utc: str = "22:15"

    # ── Notifications ─────────────────────────────────────────────────────────
    ntfy_topic: str = ""
    resend_api_key: str = ""
    notification_email: str = ""

    # ── Screener defaults (overridden by active FilterProfile) ────────────────
    min_price: float = 10.0
    min_volume: int = 500_000
    min_rsi: float = 45.0
    max_rsi: float = 70.0
    volume_multiplier: float = 1.5
    max_candidates: int = 50
    lookback_days: int = 60

    # ── Claude ────────────────────────────────────────────────────────────────
    claude_model: str = "claude-sonnet-4-20250514"
    claude_max_tokens: int = 500
    claude_deep_max_tokens: int = 1000
    min_confidence: int = 6
    deep_analysis_threshold: int = 7
    deep_analysis_top_n: int = 10


settings = Settings()
