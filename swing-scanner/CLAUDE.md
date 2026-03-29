# Swing Scanner – Claude Code Anweisungen

## Projekt-Überblick
Stock Screening App für Swing Trading. Täglich werden ~500 S&P 500 Aktien + ETFs
gescannt und Kandidaten mit Entry/Stop/Target bewertet.

**Stack:**
- Backend: Python 3.11, FastAPI, SQLite, ARQ/Redis
- Frontend: React 18, Vite, Tailwind CSS, Recharts
- Data: yfinance (kostenlos, kein API-Key)
- Broker: Alpaca (Paper + Live), Trade Republic (manuell), IBKR (CP Gateway)
- Deployment: Docker auf Synology NAS, deploy via `./update.sh`

## Wie du mit Prompts arbeitest
Alle Aufgaben liegen als Markdown-Dateien in `_Prompts/`.

**Wenn Mario sagt "lies [Dateiname]":**
→ Direkt `_Prompts/[Dateiname].md` öffnen und umsetzen

**Wenn Mario sagt "was ist offen":**
→ Alle `_Prompts/*.md` auf offene `- [ ]` Checkboxen prüfen

## Ablauf nach jeder Aufgabe
1. Änderungen committen mit aussagekräftiger Message
2. Branch pushen
3. PR automatisch erstellen mit: `gh pr create --fill`

## Wichtige Dateipfade

### Backend (Python/FastAPI)
- `backend/scanner/screener.py` — Haupt-Scanner-Pipeline
- `backend/scanner/fact_extractor.py` — Stage 1: Chart-Fakten via Claude Vision
- `backend/scanner/setup_classifier.py` — Stage 2: Regelbasierte Setup-Ableitung
- `backend/scanner/indicators.py` — Technische Indikatoren (RSI, SMA, ATR etc.)
- `backend/scanner/universe.py` — Dynamic Universe Management
- `backend/models.py` — SQLite DB-Modelle (ScanResult, TradePlan, ScanUniverse etc.)
- `backend/scheduler.py` — ARQ Jobs (daily_scan, ghost_portfolio_resolve etc.)
- `backend/brokers/alpaca.py` — AlpacaConnector
- `backend/brokers/tr.py` — TRConnector (manuell + pytr)
- `backend/brokers/ibkr.py` — IBKRConnector (CP Gateway REST)
- `backend/main.py` — FastAPI App, alle API-Routen

### Frontend (React/Vite)
- `frontend/src/components/CandidateCard.jsx` — Kandidaten-Kachel
- `frontend/src/components/PlanModal.jsx` — Trade-Plan erstellen
- `frontend/src/components/DealCockpit.jsx` — Ausführungs-Ansicht
- `frontend/src/components/Portfolio.jsx` — Portfolio-Übersicht
- `frontend/src/components/settings/SettingsTab.jsx` — Einstellungen
- `frontend/src/components/ChatTab.jsx` — AI Chat
- `frontend/src/App.jsx` — Haupt-App, Routing

### Konfiguration
- `backend/.env` — API Keys (nie committen!)
- `docker-compose.yml` — Container-Konfiguration
- `update.sh` — NAS Deploy Script

## Strategie-Module (nie ohne Auftrag ändern)
- **Bull Breakout** — Regime: bull, RSI 45-75, SMA20+SMA50
- **Bear Relative Strength** — Regime: bear, Close > SMA200, RSI 35-65
- **Mean Reversion** — Regime: bear/neutral, RSI < 40, Umkehrkerze
- **Connors RSI-2** — Regime: bull/neutral, RSI_2 < 10, Close < SMA5, Close > SMA200

## Kernprinzipien (unveränderlich)
- **ZERO FIXKOSTEN**: Kein Paid API solange nicht profitabel
- **Data Provider Abstraction**: Scanner nie direkt yfinance/alpaca aufrufen
- **Determinismus**: `temperature=0` für alle Claude Vision Calls
- `tenant_id` in allen DB-Tabellen — SaaS-Migration ohne Schema-Änderung
- Broker-Keys AES-256 verschlüsselt in DB, nie in `.env` oder Code

## Nicht verändern ohne explizite Anweisung
- `fact_extractor.py` und `setup_classifier.py` — Zwei-Stufen-Analyse-Kern
- `prediction_archive` DB-Tabelle — Ghost Portfolio Daten
- Bestehende Strategie-Modul-DB-Einträge
- `docker-compose.yml` ohne Deploy-Test
