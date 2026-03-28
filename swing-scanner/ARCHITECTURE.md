# 🏛 Swing Scanner - AI Architecture & Development Rules

Dieses Dokument ist die Single Source of Truth für alle KI-Agenten (Claude, Copilot, Gemini) und menschlichen Entwickler, die an der "Swing Scanner" Codebase arbeiten. 
Verstöße gegen diese Regeln führen zur sofortigen Ablehnung (CHANGES REQUESTED) von Pull Requests.

## 1. Projekt-Überblick
* [cite_start]Der Swing Scanner ist ein technisches Trading-Tool für diskretionäre Swing-Trader[cite: 43, 221].
* [cite_start]Das System scannt das S&P 500 Universum, bewertet Chancen-Risiko-Verhältnisse (CRV) und ermöglicht Paper-Trading direkt aus dem Dashboard[cite: 43, 221].
* [cite_start]Das Projekt ist als Zero-Fixkosten-Stack aufgebaut, muss aber zwingend "SaaS-ready" entwickelt werden[cite: 2, 218].

## 2. Tech-Stack (Strict)
* [cite_start]**Backend:** Python 3.11, FastAPI, SQLite, ARQ / Redis[cite: 97, 279].
* [cite_start]**Frontend:** React 18, Vite, Tailwind CSS, Recharts[cite: 97, 279].
* [cite_start]**Market Data:** yfinance (kostenlos, keine API-Keys)[cite: 97, 279].
* [cite_start]**Broker:** Alpaca (Paper/Live), Trade Republic (manuell via Checklist), IBKR (geplant)[cite: 97, 279].
* [cite_start]**Auth & Security:** JWT (python-jose, bcrypt), Fernet / AES-256[cite: 97, 279].
* [cite_start]**Deployment:** Docker, auf privatem NAS hinter VPN[cite: 97, 279].

## 3. Unveränderliche Architektur-Regeln (Kritisch!)
* [cite_start]**Multi-Tenant Pflicht:** Alle neuen und bestehenden Datenbank-Tabellen MÜSSEN zwingend eine `tenant_id` enthalten, um eine spätere SaaS-Migration ohne Schema-Änderung zu garantieren[cite: 99, 281].
* [cite_start]**Absolute Security:** Broker-Keys (API Key/Secret) dürfen NIEMALS im Klartext im Code oder in `.env`-Dateien gespeichert werden[cite: 94, 276]. 
* [cite_start]Broker-Keys MÜSSEN in der Datenbank mit AES-256 verschlüsselt gespeichert werden[cite: 94, 276, 282].
* [cite_start]Der Auth-Layer muss strikt wiederverwendbar für Multi-Tenant/SaaS-Setups bleiben[cite: 101, 283].

## 4. Trading- & Broker-Logik
* [cite_start]**Abstraktion:** Nutze für neue Broker zwingend das `BrokerConnector ABC` Interface (mit `get_balance()`, `place_order()`, `get_execution_checklist()`, `supports_auto_trade`)[cite: 70, 252, 368].
* [cite_start]**Agnostische Daten:** Ein `TradePlan` in der Datenbank MUSS broker-agnostisch sein[cite: 69, 251, 348]. 
* [cite_start]**Währungen:** Die Währungsumrechnung (z.B. EUR/USD) erfolgt live via yfinance `EURUSD=X` mit einem Fallback auf 1.09[cite: 72, 256, 352].

## 5. Machine Learning Pipeline (Ghost Portfolio)
* [cite_start]**Datensammeln:** Jeder Scan-Kandidat muss zwingend als "Prediction" für das Ghost Portfolio archiviert werden[cite: 86, 266].
* [cite_start]**Kein Datenverlust:** Die automatische Resolution (WIN / LOSS / TIMEOUT) läuft täglich per Cronjob (22:20 UTC) gegen EOD-Daten[cite: 87, 268]. [cite_start]Ein "TIMEOUT" darf für spätere ML-Modelle (XGBoost/LightGBM) niemals pauschal als "LOSS" gewertet werden[cite: 189].
* [cite_start]**Slippage:** Für realistische ML-Backtests ist der Slippage-Tracker (`actual_entry_price` auf dem TradePlan) zwingend zu pflegen[cite: 28, 161, 327].

## 6. Frontend & UI UX
* [cite_start]UI-Updates im "Deal Cockpit Tab" pollt Live-Preise in einem 5-Sekunden-Intervall[cite: 73, 257].
* [cite_start]Es muss ein einheitlicher Trade-Flow eingehalten werden: PlanModal -> Deal Cockpit -> Ausführen[cite: 139, 140, 141].
* [cite_start]Technisch ungültige Setups (oder Aktien mit problematischen Corporate Actions) werden im UI visuell gedimmt oder mit Warn-Bannern markiert (z.B. Earnings-Warnung bei <= 7 Tagen)[cite: 58, 59, 65, 239, 240, 245].
