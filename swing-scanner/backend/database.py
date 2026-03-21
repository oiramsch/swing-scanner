from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, select

from backend.config import settings


class ScanResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticker: str = Field(index=True)
    scan_date: date = Field(index=True)
    setup_type: str  # breakout | pullback | pattern | momentum | none
    pattern_name: Optional[str] = None
    confidence: int
    entry_zone: Optional[str] = None
    stop_loss: Optional[str] = None
    target: Optional[str] = None
    reasoning: Optional[str] = None
    chart_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        connect_args = {"check_same_thread": False}
        _engine = create_engine(
            settings.database_url,
            connect_args=connect_args,
            echo=False,
        )
    return _engine


def init_db():
    SQLModel.metadata.create_all(get_engine())


def get_session():
    with Session(get_engine()) as session:
        yield session


def save_scan_result(result: ScanResult) -> ScanResult:
    with Session(get_engine()) as session:
        session.add(result)
        session.commit()
        session.refresh(result)
        return result


def get_results_for_date(scan_date: date) -> list[ScanResult]:
    with Session(get_engine()) as session:
        statement = (
            select(ScanResult)
            .where(ScanResult.scan_date == scan_date)
            .order_by(ScanResult.confidence.desc())
        )
        return session.exec(statement).all()


def get_result_by_ticker(ticker: str, scan_date: date) -> Optional[ScanResult]:
    with Session(get_engine()) as session:
        statement = (
            select(ScanResult)
            .where(ScanResult.ticker == ticker)
            .where(ScanResult.scan_date == scan_date)
        )
        return session.exec(statement).first()
