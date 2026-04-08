# Feature: Paper Auto-Trading (Phase 3)

## Zielsetzung
Nach Phase 2 (Bear Bounce Short) läuft das Scanner-System und liefert Short-Kandidaten. Phase 3 fügt automatisches Paper-Trading hinzu: täglich um 15:35 UTC werden aktive Kandidaten automatisch als Bracket Orders auf dem Alpaca Paper-Konto platziert.

⚠️ **Voraussetzung:** Phase 2 (Bear Bounce Short) muss deployed und getestet sein. Niemals Phase 3 aktivieren bevor Phase 2 nachweislich funktioniert.

## Kontext & betroffene Dateien
- `backend/scheduler.py` — ARQ Jobs (neuer Auto-Trading Job)
- `backend/brokers/alpaca.py` — Bracket Order Ausführung
- `backend/models.py` — TradePlan Status + Auto-Trade Flag
- `backend/main.py` — Feature-Flag API
- `frontend/src/components/TradingCockpit.jsx` — 🤖 Badge für Auto-Trades
- `frontend/src/App.jsx` — Settings für Feature-Flag

## Implementierung

### 1. Feature-Flag
- `PAPER_AUTO_TRADING` in AppSettings (SQLite, nicht .env)
- Default: `false`
- Nur auf Paper-Konto wirksam — Hard Guard im Code
- Einstellbar über Settings-UI

### 2. ARQ-Job "auto_paper_trade"

In `backend/scheduler.py`:
- Trigger: täglich 15:35 UTC (25 Min vor Market Close)
- Lädt alle ScanResults des heutigen Tages mit Status `active`
- Nur wenn `PAPER_AUTO_TRADING = true`
- Sicherheits-Limits (alle MÜSSEN eingehalten werden):
  - Max 5% des Konto-Kapitals pro Trade
  - Max 3 gleichzeitige offene Auto-Trades
  - PDT-Schutz: keine Same-Day-Close-Positionen
  - Nur Paper-Konto (`is_paper = true` Guard)
- Für jeden Kandidaten: Bracket Order platzieren via `AlpacaConnector.place_bracket_order()`
- Ergebnis in TradePlan speichern mit `auto_trade = true`

### 3. ntfy Push-Notification
- Erfolg: `🤖 Alpaca Paper: {direction} {ticker} {qty} Stk @ {price:.2f} automatisch eröffnet`
- Fehler: `⚠️ Auto-Trade {ticker} fehlgeschlagen: {error}`
- Zusammenfassung: `📊 Auto-Trading: {n} Trades platziert, {total_risk:.0f}$ Risiko`

### 4. UI-Anpassungen

In `TradingCockpit.jsx`:
- 🤖 Badge auf TradePlan-Karten die automatisch erstellt wurden
- Tooltip: "Automatisch um 15:35 UTC platziert"

Im Ghost Portfolio Tab:
- Performance-Vergleich: Auto-Trades vs. Manuelle Trades
- Separate Hit-Rate-Zeile für Auto vs. Manuell

### 5. Journal
- Auto-Trades mit `source = "auto"` in Journal-CSV Export

## Definition of Done
@claude: Erstelle den PR erst wenn ALLE Punkte erfüllt sind:
- [ ] `PAPER_AUTO_TRADING` Feature-Flag in AppSettings (SQLite) mit Default `false`
- [ ] ARQ-Job `auto_paper_trade` um 15:35 UTC implementiert
- [ ] Alle 4 Sicherheits-Limits implementiert und getestet (5% max, 3 Trades max, PDT-Schutz, Paper-Guard)
- [ ] Hard Guard: Job wird sofort abgebrochen wenn `is_paper = false`
- [ ] ntfy-Push bei Ausführung (Erfolg + Fehler + Zusammenfassung)
- [ ] 🤖 Badge in TradingCockpit für Auto-Trade Pläne
- [ ] Performance-Vergleich Auto vs. Manuell im Ghost Portfolio Tab
- [ ] Kein Float/Double für Kurse/Beträge — ausschließlich Decimal
- [ ] Unit Test für Sicherheits-Limits (Mock Alpaca)
- [ ] CI Tests grün
