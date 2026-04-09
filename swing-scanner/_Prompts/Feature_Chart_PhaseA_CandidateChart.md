# Feature: Interaktiver Candlestick-Chart im Kandidaten-Detail (Phase A)

## Ziel
Jedem Kandidaten einen interaktiven Candlestick-Chart hinzufügen der sich öffnet
wenn man auf eine CandidateCard klickt. Chart zeigt OHLCV-Daten mit eingezeichneten
Setup-Levels (Entry-Zone, Stop-Loss, Target) und technischen Indikatoren.

## Bibliothek
`lightweight-charts` von TradingView (npm, MIT Lizenz, kein API-Key nötig).
Installation: `npm install lightweight-charts` im `frontend/` Verzeichnis.

## Backend

### Neuer Endpoint: `GET /api/chart/{symbol}`
Parameter:
- `period`: `1mo` / `3mo` / `6mo` / `1y` (default: `3mo`)
- `interval`: `1d` (default)

Response:
```json
{
  "symbol": "AAPL",
  "bars": [
    {"time": "2026-01-01", "open": 150.0, "high": 155.0, "low": 149.0, "close": 153.0, "volume": 1000000}
  ],
  "indicators": {
    "sma50": [{"time": "2026-01-01", "value": 148.5}],
    "sma200": [{"time": "2026-01-01", "value": 142.0}]
  }
}
```

Implementierung in `backend/main.py` oder neuer `backend/chart.py`:
- yfinance `Ticker(symbol).history(period=period, interval=interval)`
- SMA50 + SMA200 berechnen via pandas `rolling(50).mean()` / `rolling(200).mean()`
- Auth-geschützt (bestehende JWT Middleware)

## Frontend

### Neues Component: `frontend/src/components/chart/CandidateChart.jsx`
- Verwendet `lightweight-charts` `createChart()`
- Candlestick Series + Volume Histogram unten
- Overlays als LineSeries:
  - SMA50 (orange, dünn)
  - SMA200 (blau, dünn)
- Horizontale Preislinien (PriceLine API):
  - Entry Low / Entry High → grüne gestrichelte Zone
  - Stop Loss → rote Linie mit Label "SL"
  - Target → blaue Linie mit Label "TP"
- Zeitraum-Buttons: 1M / 3M / 6M / 1Y (State: selectedPeriod)
- Loading Spinner während API-Call
- Responsive: `chart.applyOptions({ width: container.clientWidth })`

### Integration in `CandidateCard.jsx` oder `TradingCockpit.jsx`
- Klick auf CandidateCard → Modal/Drawer öffnet sich
- Modal enthält `<CandidateChart symbol={candidate.symbol} scanResult={candidate} />`
- scanResult enthält entry_low, entry_high, stop_loss, target_price aus DB

## Kernprinzipien
- Decimal für alle Preisberechnungen im Backend
- Zero Fixkosten: nur yfinance (bereits im Stack)
- Kein neues Dependency außer `lightweight-charts`
- Auth auf neuem Endpoint zwingend

## Definition of Done
- [ ] `GET /api/chart/{symbol}?period=3mo` liefert OHLCV + SMA50/200
- [ ] CandidateChart.jsx rendert Candlestick-Chart mit Lightweight Charts
- [ ] Entry-Zone (grün), SL (rot), TP (blau) als Preislinien eingezeichnet
- [ ] SMA50 + SMA200 als Overlays sichtbar
- [ ] Zeitraum-Buttons 1M/3M/6M/1Y funktionieren
- [ ] Chart öffnet sich beim Klick auf Kandidaten
- [ ] Responsive (passt sich Containerbreite an)
- [ ] PR mit Label "Ready for Review"
