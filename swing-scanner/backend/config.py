from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    polygon_api_key: str = ""
    anthropic_api_key: str = ""
    database_url: str = "sqlite:///./swing_scanner.db"
    scan_time_utc: str = "22:15"

    # Polygon rate limit: Free tier = 5 calls/min
    polygon_rate_limit_sleep: float = 12.0

    # Screener thresholds
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
    min_confidence: int = 6


settings = Settings()
