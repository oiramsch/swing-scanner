# Feature: Zeichenwerkzeuge + Multi-Chart Deal Cockpit (Phase B)

## Voraussetzung
Phase A (Feature_Chart_PhaseA_CandidateChart.md) muss deployed und getestet sein.

## Teil 1: Zeichenwerkzeuge im Kandidaten-Chart

### Werkzeuge
- **Horizontale Linie** — Klick auf Chart setzt horizontale Preislinie
- **Trendlinie** — Zwei Punkte definieren eine diagonale Linie
- **Fibonacci Retracement** — Zwei Punkte → automatische Fib-Level (23.6%, 38.2%, 50%, 61.8%, 78.6%)

### Implementierung
Toolbar oberhalb des Charts mit Icon-Buttons (Lucide Icons):
- `Minus` → Horizontale Linie
- `TrendingUp` → Trendlinie  
- `BarChart2` → Fibonacci

Lightweight Charts bietet keine native Zeichenwerkzeug-API.
Lösung: Canvas-Overlay über dem Chart (`position: absolute`) für Trendlinien + Fibonacci.
Horizontale Linien: `series.createPriceLine({ price, color, lineStyle })`.

Persistenz: Gezeichnete Linien im React State halten (kein Backend nötig für Phase B).
Optional: LocalStorage-Persistenz pro Symbol (`chart_drawings_{symbol}`).

### Löschen
Rechtsklick auf Linie → Context Menu → "Linie löschen"
Oder: "Alle löschen" Button in Toolbar.

## Teil 2: Multi-Chart im Deal Cockpit

### Layout
Unterhalb der bestehenden TradePlan-Tabelle im DealCockpit Tab:
- Grid: 2 Spalten, dynamisch viele Zeilen
- Jedes Tile: 300px Höhe, Ticker als Header, Mini-Chart

### Neuer Endpoint: `GET /api/chart/{symbol}/intraday`
- yfinance `history(period="5d", interval="15m")`
- Gibt 15-Minuten OHLCV der letzten 5 Handelstage zurück
- Entry/SL/TP aus dem zugehörigen TradePlan mitliefern

### Neues Component: `frontend/src/components/chart/DealCockpitCharts.jsx`
- Liest alle aktiven TradePläne mit Status `pending` / `active`
- Für jeden Plan: Mini-CandlestickChart (lightweight-charts, 15min)
- Preislinien: Entry (grün), SL (rot), TP (blau)
- Live-Update: `setInterval` alle 60s → neuer API-Call → Chart update
- Kein Zoom, keine Zeichenwerkzeuge (nur lesen)

### Integration
In `DealCockpitTab.jsx` unterhalb der bestehenden Tabelle einbinden.
Toggle-Button "Charts ein/ausblenden" um Platz zu sparen.

## Kernprinzipien
- Decimal für alle Preisberechnungen im Backend
- Zero Fixkosten: nur yfinance + lightweight-charts
- Canvas-Overlay darf Chart-Performance nicht beeinträchtigen

## Definition of Done
- [ ] Toolbar mit 3 Zeichenwerkzeugen im Kandidaten-Chart
- [ ] Horizontale Linie via PriceLine API funktioniert
- [ ] Trendlinie via Canvas-Overlay funktioniert
- [ ] Fibonacci-Level via Canvas-Overlay funktioniert
- [ ] Löschen per Rechtsklick oder "Alle löschen"
- [ ] `GET /api/chart/{symbol}/intraday` liefert 15min Daten
- [ ] DealCockpitCharts.jsx zeigt alle aktiven TradePläne als Mini-Charts
- [ ] Live-Update alle 60s
- [ ] Toggle ein/ausblenden
- [ ] PR mit Label "Ready for Review"
