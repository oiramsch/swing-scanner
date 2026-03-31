# 🏭 Swing Scanner – Claude Code Anweisungen

Du bist der ausführende Lead Developer für den "Swing Scanner". Bevor du Code schreibst, änderst oder einen Pull Request erstellst, MUSST du diese Regeln strikt befolgen. Copilot wird deinen Code danach strengstens auf diese Kriterien prüfen!

## 1. Projekt-Überblick
Stock Screening App für Swing Trading. Täglich werden ~500 S&P 500 Aktien + ETFs gescannt und Kandidaten mit Entry/Stop/Target bewertet.
* **Stack:** Backend: Python 3.11, FastAPI, SQLite, ARQ/Redis | Frontend: React 18, Vite, Tailwind CSS, Recharts.
* **Data:** yfinance (kostenlos, kein API-Key).
* **Broker:** Alpaca (Paper + Live), Trade Republic (manuell), IBKR (CP Gateway).
* **Deployment:** Docker auf Synology NAS, deploy via `./update.sh`.

## 2. Kernprinzipien & FinTech-Regeln (Unveränderlich)
* **Finanz-Mathematik:** Nutze NIEMALS `Double` oder `Float` für Währungen, Aktienkurse, P&L oder Kontostände. Nutze zwingend `Decimal` zur Vermeidung von Floating-Point-Fehlern.
* **ZERO FIXKOSTEN:** Kein Paid API solange nicht profitabel.
* **Data Provider Abstraction:** Scanner nie direkt yfinance/alpaca aufrufen. Halte dich an das einheitliche Interface `BrokerConnector ABC`.
* **Determinismus:** `temperature=0` für alle Claude Vision Calls.
* **SaaS-Readiness:** `tenant_id` in allen DB-Tabellen ist Pflicht — SaaS-Migration ohne Schema-Änderung.
* **Security:** Broker-Keys (API Key/Secret) MÜSSEN in der Datenbank AES-256 verschlüsselt sein. Niemals im Klartext, Code oder unverschlüsselt in `.env`.
* **Ghost Portfolio (ML Pipeline):** Der `actual_entry_price` (Slippage Tracker) muss immer im `TradePlan` gespeichert werden. Ein `TIMEOUT`-Status darf für ML-Auswertungen niemals pauschal als `LOSS` gewertet werden.

## 3. Branch-Management & Workflow
* **NIEMALS direkt auf `main` arbeiten.**
* Bevor du Code schreibst, erstelle zwingend einen neuen Branch: `git checkout -b task/<name-der-prompt-datei>` (ohne .md).
* 1. Änderungen committen mit aussagekräftiger Message.
* 2. Branch pushen.
* 3. **PR automatisch erstellen mit Trigger-Label:** * Bei neuen PRs zwingend: `gh pr create --fill --label "Ready for Review"`
   * Bei Fixes in bestehenden PRs: `gh pr edit <PR-NUMMER> --add-label "Ready for Review"`

## 4. Wie du mit Prompts arbeitest
Alle Aufgaben liegen als Markdown-Dateien in `_Prompts/`.
* **Wenn Mario sagt "lies [Dateiname]":**
  → Direkt `_Prompts/[Dateiname].md` öffnen und umsetzen. Achte zwingend auf die "Definition of Done" (Checkliste) am Ende der Prompt-Datei. Erstelle den PR erst, wenn alle Punkte erfüllt sind!
* **Wenn Mario sagt "was ist offen":**
  → Alle `_Prompts/*.md` auf offene `- [ ]` Checkboxen prüfen.

## 5. Wichtige Dateipfade

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

## Nicht verändern ohne explizite Anweisung
- `fact_extractor.py` und `setup_classifier.py` — Zwei-Stufen-Analyse-Kern
- `prediction_archive` DB-Tabelle — Ghost Portfolio Daten
- Bestehende Strategie-Modul-DB-Einträge
- `docker-compose.yml` ohne Deploy-Test
