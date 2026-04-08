# Feature: Bear Bounce Short / Dead Cat Bounce (Phase 2)

## Zielsetzung
Im aktuellen Bear-Markt liefert der Scanner 0 Long-Kandidaten — das ist korrekt (Falling Knife Schutz). Ziel dieses Features: Short-Selling-Fähigkeit hinzufügen um Dead Cat Bounces zu handeln.

Ein Dead Cat Bounce tritt auf wenn eine Aktie im Abwärtstrend kurzfristig erholt. Short Entry wenn RSI > 60 (überkauft) + Preis unter SMA50 und SMA200 + Reversal-Kerze an Widerstand.

## Kontext & betroffene Dateien
- `backend/scanner/screener.py` — Haupt-Scanner-Pipeline
- `backend/scanner/setup_classifier.py` — Stage 2: neues Short-Modul hinzufügen
- `backend/scanner/indicators.py` — Indikatoren (RSI, SMA bereits vorhanden)
- `backend/models.py` — ScanResult Modell (direction-Feld prüfen)
- `backend/brokers/alpaca.py` — Short Bracket Order implementieren
- `frontend/src/components/CandidateCard.jsx` — SHORT Badge
- `frontend/src/components/TradingCockpit.jsx` — invertierte Zonen-Logik

## Implementierung

### 1. Neues Strategie-Modul "Bear Bounce Short"

In `setup_classifier.py` neues Modul hinzufügen:
- Aktivierung: nur wenn `regime = BEAR`
- Signalkriterien:
  - `RSI > 60` (kurzfristig überkauft im Abwärtstrend)
  - `close < SMA50 < SMA200` (Abwärtstrend bestätigt)
  - Reversal-Kerze erkennbar (z.B. Bearish Engulfing, Shooting Star — einfache Heuristik reicht)
  - Preis nahe Widerstand (z.B. innerhalb 2% von SMA50 oder SMA200)
- `direction = "short"`
- Modul-Name: `"Bear Bounce Short"`

### 2. Short-CRV Berechnung
- Entry = aktueller Kurs
- Stop = Entry + ATR * 1.5 (Stop ÜBER Entry bei Short)
- Target = Entry - ATR * 2.5
- `crv = (entry - target) / (stop - entry)`
- Mindest-CRV: 2.0

### 3. Alpaca Short Bracket Order

In `backend/brokers/alpaca.py`:
- Entry: `side="sell"` (sell short)
- Stop: `side="buy"` (buy to cover) mit Stop-Order
- Target: `side="buy"` (buy to cover) mit Limit-Order
- Guard: nur auf Paper-Konto ausführen — `if not self.is_paper: raise ValueError("Short selling nur auf Paper-Konto")`

### 4. UI-Anpassungen

In `CandidateCard.jsx`:
- Dunkelrotes Badge "SHORT ↓" für `direction="short"` Kandidaten
- Zone-Anzeige invertiert: Entry-Zone oben = Widerstand

In `TradingCockpit.jsx`:
- "Above Zone" = Short-Entry Trigger (Kurs über Entry-Zone = gut für Short)
- "Below Zone" = Short-Stop gefährdet

### 5. ntfy Push-Notification
- Bei neuem Short-Signal: `🔴 Short-Signal: {ticker} | RSI: {rsi:.0f} | CRV: {crv:.1f}`

## Definition of Done
@claude: Erstelle den PR erst wenn ALLE Punkte erfüllt sind:
- [ ] Neues Modul "Bear Bounce Short" in `setup_classifier.py` implementiert und mit `direction="short"` im ScanResult gespeichert
- [ ] Short-CRV Berechnung korrekt: Stop ÜBER Entry, Target UNTER Entry
- [ ] Alpaca Short Bracket Order implementiert mit Paper-Konto Guard
- [ ] SHORT ↓ Badge in CandidateCard sichtbar bei direction="short"
- [ ] Ghost Portfolio tracked Shorts korrekt (direction-aware WIN/LOSS — war bereits in PR #13 implementiert, sicherstellen dass es funktioniert)
- [ ] ntfy-Push bei neuem Short-Signal
- [ ] Kein Float/Double für Kurse — ausschließlich Decimal
- [ ] Kein direkter yfinance/alpaca Aufruf im Scanner — BrokerConnector ABC verwenden
- [ ] CI Tests grün
