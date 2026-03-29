# Phase 3.2 – Trading Cockpit (Pre-Market View)

## Ziel
Dedizierter Tab als Kommandozentrale für die US-Markteröffnung (15:30 MEZ / 09:30 ET).

## Betroffene Dateien
- `frontend/src/components/TradingCockpit.jsx` — neu erstellen
- `frontend/src/hooks/useAlpacaWebsocket.js` — neu erstellen
- `frontend/src/App.jsx` — neuen Tab/Route hinzufügen
- `backend/main.py` — ggf. neuer Endpoint für Cockpit-Daten

## Aufgaben

### Schritt 1: UI-Gerüst & Header
- [ ] Neuen Tab "Cockpit" in der Navigation anlegen
- [ ] Header mit Countdown-Timer bauen (Zeit bis US-Markteröffnung 15:30 MEZ oder Marktschluss 22:00 MEZ)
- [ ] DST-aware Logik für New York Time (America/New_York)
- [ ] PDT-Counter im Header: "Daytrades: X/3 diese Woche" — rote Warnung wenn 3 erreicht. Nur für Alpaca-Konten < $25.000

### Schritt 2: Kandidaten-Grid
- [ ] Datenquelle: NUR TradePläne mit `status = "PENDING"` laden (nicht alle Scanner-Kandidaten)
- [ ] Kompakte Kacheln (kleiner als CandidateCard) mit:
  - Ticker + Modul-Badge + Live-Preis
  - Zonen-Status farbkodiert:
    - 🟢 Grün = Preis in Entry-Zone ODER Trigger-Preis erreicht
    - 🟡 Gelb = Nah dran (< 2% unter Entry-Low)
    - 🟠 Orange = Below Zone (> 2% unter Entry-Low)
    - 🔴 Rot = Above Zone (> Entry-High + 2%) oder ungültig
  - Spread-Anzeige (Bid/Ask)
  - Volumen-Indikator vs. Durchschnittsvolumen
  - `+ Plan` Button (öffnet PlanModal — Trigger-Preis-Integration: Button erst aktiv wenn Trigger erreicht)
- [ ] Zuerst mit Mock-Daten implementieren, Design validieren bevor WebSocket eingebaut wird

### Schritt 3: WebSocket Hook
- [ ] `useAlpacaWebsocket.js` Hook erstellen:
  - Nimmt Array von Tickern entgegen
  - Verbindet sich mit Alpaca Free WebSocket (max 30 Symbole)
  - Pusht Live-Preise an Kacheln
  - Reconnect-Logik mit exponential backoff
- [ ] Mock-Fallback: Wenn `MOCK_WEBSOCKET=true` in `.env` oder Alpaca keine Daten liefert:
  - Alle 2 Sekunden leichte Preisänderungen um gestrigen Schlusskurs simulieren
  - Ermöglicht Testen der Zonen-Farbwechsel ohne Marktzugang (Wochenende)
- [ ] Fallback auf yfinance-Polling wenn WebSocket nicht verfügbar

## Implementierungs-Reihenfolge
1. Schritt 1 + 2 mit Mock-Daten umsetzen
2. Code zeigen / PR erstellen → Mario reviewt Design
3. Erst nach Feedback: Schritt 3 (WebSocket)

## Hinweise
- Alpaca Free WebSocket: max 30 Symbole gleichzeitig — reicht für 5-15 Kandidaten
- PDT-Regel: Bei Konten < $25.000 maximal 3 Daytrades pro 5-Tage-Fenster
- Kein neuer Kauf-Flow — `+ Plan` öffnet das bestehende PlanModal
