# Swing Trading Scanner

AI-powered swing trading scanner using Polygon.io data + Claude Vision analysis.

## Stack
- **Backend**: FastAPI + ARQ + SQLite (SQLModel)
- **Data**: Polygon.io REST API (Free Tier, EOD)
- **Indicators**: pandas-ta (SMA20, SMA50, RSI, ATR)
- **Charts**: mplfinance (dark theme candlesticks)
- **AI**: Anthropic Claude Vision (`claude-sonnet-4-20250514`)
- **Frontend**: React + Vite + Tailwind CSS

## Setup

### Backend
```bash
cd swing-scanner
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cp .env.example .env
# Fill in your API keys in .env
uvicorn backend.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## API Endpoints
- `GET /api/candidates?date=YYYY-MM-DD` — Scan results for a date
- `GET /api/candidates/{ticker}` — Single ticker detail
- `GET /api/charts/{ticker}` — Chart PNG
- `POST /api/scan/trigger` — Trigger manual scan
- `GET /health` — Health check

## Scheduler
The ARQ worker runs `daily_scan` at 22:15 UTC every day.
Start the worker:
```bash
arq backend.scheduler.WorkerSettings
```

## Rate Limits
Polygon.io Free tier: 5 calls/min → 12s sleep between requests.
Full scan of 50 tickers takes ~10 minutes.

## Deploy to Railway
1. Push to GitHub
2. Connect repo in Railway
3. Set environment variables (POLYGON_API_KEY, ANTHROPIC_API_KEY)
4. Deploy — Railway auto-detects `railway.toml`
