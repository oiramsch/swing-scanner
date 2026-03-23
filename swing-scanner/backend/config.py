from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
    )

    # Alpaca (primary data source)
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_paper: bool = True
    alpaca_base_url: str = "https://paper-api.alpaca.markets"

    # Polygon (optional fallback — used when alpaca_api_key is empty)
    polygon_api_key: str = ""
    # Polygon free tier: 5 calls/min — only relevant when used as fallback
    polygon_rate_limit_sleep: float = 12.0

    anthropic_api_key: str = ""
    database_url: str = "sqlite:///./swing_scanner.db"
    redis_url: str = "redis://localhost:6379"
    scan_time_utc: str = "22:15"

    # Notifications
    ntfy_topic: str = ""
    resend_api_key: str = ""
    notification_email: str = ""

    # Screener defaults (overridden by active FilterProfile)
    min_price: float = 10.0
    min_volume: int = 500_000
    min_rsi: float = 45.0
    max_rsi: float = 70.0
    volume_multiplier: float = 1.5
    max_candidates: int = 50
    lookback_days: int = 60

    # Claude
    claude_model: str = "claude-sonnet-4-20250514"
    claude_max_tokens: int = 500
    claude_deep_max_tokens: int = 1000
    min_confidence: int = 6
    deep_analysis_threshold: int = 7
    deep_analysis_top_n: int = 10


settings = Settings()
