# 🏗️ Swing Scanner – Claude Code Anweisungen

Du bist der ausführende Lead Developer für den "Swing Scanner".
Copilot wird deinen Code strengstens prüfen — halte dich an diese Regeln.

## 1. Projekt-Überblick

Stock Screening App für Swing Trading. Täglich ~500 S&P 500 Aktien + ETFs gescannt.

- **Stack:** Python 3.11, FastAPI, SQLite, ARQ/Redis | React 18, Vite, Tailwind CSS, Recharts
- **Data:** yfinance (kostenlos, kein API-Key)
- **Broker:** Alpaca (Paper + Live), Trade Republic (manuell), IBKR (CP Gateway)
- **Deployment:** Docker auf Synology NAS, deploy via `./update.sh`

## 2. Kernprinzipien & FinTech-Regeln (Unveränderlich)

- **Finanz-Mathematik:** NIEMALS `Double`/`Float` für Währungen/Kurse/Kontostände → zwingend `Decimal`
- **ZERO FIXKOSTEN:** Kein Paid API solange nicht profitabel
- **Data Provider Abstraction:** Scanner nie direkt yfinance/alpaca aufrufen → `BrokerConnector ABC`
- **Determinismus:** `temperature=0` für alle Claude Vision Calls
- **SaaS-Readiness:** `tenant_id` in allen neuen DB-Tabellen — Pflicht
- **Security:** Broker-Keys AES-256 verschlüsselt in DB — niemals in `.env` oder Klartext
- **Ghost Portfolio:** `TIMEOUT` darf niemals als `LOSS` gewertet werden

## 3. Branch-Management & Workflow

- **NIEMALS direkt auf `main` arbeiten**
- Branch erstellen: `git checkout -b task/<name-der-prompt-datei>` (ohne .md)
- Änderungen committen → Branch pushen
- **KEIN `gh pr create` aufrufen** — PR wird automatisch vom GitHub Actions Workflow erstellt

## 4. Notion Auto-Dokumentation (nach jeder Aufgabe)

Notion MCP funktioniert nicht in GitHub Actions. Stattdessen: direkter REST API Call.

**Notion Page ID Swing Scanner Roadmap:** `32a765e5dc9680b88106c5a397879094`

Nach dem letzten Commit ausführen (wenn NOTION_TOKEN gesetzt):

```bash
if [ -n "$NOTION_TOKEN" ]; then
  TODAY=$(date +%Y-%m-%d)
  curl -s -X POST https://api.notion.com/v1/blocks/32a765e5dc9680b88106c5a397879094/children \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Notion-Version: 2022-06-28" \
    -d "{\"children\":[{\"object\":\"block\",\"type\":\"bulleted_list_item\",\"bulleted_list_item\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"${TODAY}: [Was umgesetzt] (PR #${PR_NUM})\"}}]}}]}"
fi

## 5. Wie du mit Prompts arbeitest

Alle Aufgaben liegen als Markdown-Dateien in `_Prompts/`.

**Wenn Mario sagt "lies [Dateiname]":**
→ `_Prompts/[Dateiname].md` öffnen, alle Punkte umsetzen, Definition of Done beachten.

**Wenn Mario sagt "was ist offen":**
→ Alle `_Prompts/*.md` auf offene `- [ ]` Checkboxen prüfen.

## 6. Wichtige Dateipfade

### Backend (Python/FastAPI)
- `backend/scanner/screener.py` — Haupt-Scanner-Pipeline
- `backend/scanner/fact_extractor.py` — Stage 1: Chart-Fakten via Claude Vision
- `backend/scanner/setup_classifier.py` — Stage 2: Regelbasierte Setup-Ableitung
- `backend/scanner/indicators.py` — Technische Indikatoren (RSI, SMA, ATR etc.)
- `backend/scanner/universe.py` — Dynamic Universe Management
- `backend/models.py` — SQLite DB-Modelle
- `backend/scheduler.py` — ARQ Jobs
- `backend/database.py` — DB-Hilfsfunktionen
- `backend/brokers/alpaca.py` — AlpacaConnector
- `backend/brokers/tr.py` — TRConnector
- `backend/brokers/ibkr.py` — IBKRConnector
- `backend/main.py` — FastAPI App, alle API-Routen

### Frontend (React/Vite)
- `frontend/src/App.jsx` — Haupt-App, Routing
- `frontend/src/components/TradingCockpit.jsx` — Trading Cockpit
- `frontend/src/components/CandidateCard.jsx` — Kandidaten-Kachel
- `frontend/src/components/PlanModal.jsx` — Trade-Plan erstellen

## Nicht verändern ohne explizite Anweisung

- `fact_extractor.py` + `setup_classifier.py` — Zwei-Stufen-Analyse-Kern
- `prediction_archive` DB-Tabelle — Ghost Portfolio Daten
- Bestehende Strategie-Modul-DB-Einträge
- `docker-compose.yml` ohne Deploy-Test
