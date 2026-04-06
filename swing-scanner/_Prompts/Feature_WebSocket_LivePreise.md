# Feature 3.x — WebSocket Live-Kurse (Alpaca Free)

## Ziel
Aktuell läuft das Trading Cockpit mit 5s Polling via `/api/quotes`.
Upgrade auf echten Alpaca Free WebSocket für Live-Kurse ohne Polling-Delay.
Max. 30 Symbole gleichzeitig — reicht für 5-15 PENDING TradePläne.

## Betroffene Dateien
- `frontend/src/hooks/useAlpacaWebSocket.js` — neu erstellen
- `frontend/src/components/TradingCockpit.jsx` — WebSocket Hook einbauen
- `backend/main.py` — ggf. neuer `/api/alpaca/ws-token` Endpoint für Auth
- `frontend/src/.env` — `VITE_MOCK_WEBSOCKET=false` Variable

## Architektur-Entscheidung
Alpaca Free WebSocket läuft **direkt im Browser** (Client-Side) —
kein Backend-Proxy nötig. Der API Key wird dabei NICHT im Frontend exponiert,
da Alpaca für den Free SIP Feed keine Auth braucht (public feed).

Falls doch Auth nötig: Backend-Endpoint `/api/alpaca/ws-token` gibt
kurzlebiges Token zurück (Key bleibt im Backend).

## Aufgaben

### useAlpacaWebSocket.js — React Hook
- [ ] Hook nimmt Array von Tickern entgegen: `useAlpacaWebSocket(tickers)`
- [ ] Verbindet sich mit `wss://stream.data.alpaca.markets/v2/iex`
- [ ] Subscribed auf `trades` für alle Ticker im Array
- [ ] Gibt zurück: `{ prices: {AAPL: 182.50, ...}, connected: bool, error }`
- [ ] Reconnect-Logik: exponential backoff (1s, 2s, 4s, max 30s)
- [ ] Cleanup: WebSocket schließen wenn Component unmounted

**Mock-Modus** (`VITE_MOCK_WEBSOCKET=true` in `.env`):
- Simuliert alle 2s kleine Preisänderungen (±0.5%) um letzten Schlusskurs
- Ermöglicht Testen der Zonen-Farbwechsel ohne Marktzugang (Wochenende)
- Fallback: automatisch aktiv wenn WebSocket-Verbindung fehlschlägt

### TradingCockpit.jsx — Integration
- [ ] Bestehende 5s Polling-Logik (`setInterval` + `/api/quotes`) durch WebSocket Hook ersetzen
- [ ] `const { prices, connected } = useAlpacaWebSocket(pendingTickers)`
- [ ] Verbindungs-Status-Anzeige im Header: 🟢 Live / 🟡 Mock / 🔴 Offline
- [ ] Fallback auf `/api/quotes` Polling wenn WebSocket nicht verfügbar

### Limits & Constraints
- Alpaca Free WebSocket: max 30 Symbole — wenn > 30 PENDING Pläne: Top 30 nach Score
- Nur während US-Marktzeiten aktiv (15:30–22:00 MEZ) — außerhalb: Mock-Modus
- Keine Änderung an `/api/quotes` Backend-Endpoint (bleibt als Fallback)

## Definition of Done

- [ ] WebSocket verbindet sich mit Alpaca IEX Feed
- [ ] Live-Kurse erscheinen in Kacheln ohne sichtbares Polling-Delay
- [ ] Verbindungs-Status sichtbar im Header
- [ ] Mock-Modus funktioniert (`VITE_MOCK_WEBSOCKET=true`)
- [ ] Fallback auf Polling wenn WebSocket nicht verfügbar
- [ ] Max 30 Symbole werden subscribed
- [ ] Cleanup bei Component-Unmount (kein Memory Leak)
- [ ] Kein `print()` / `console.log()` im Produktionscode
- [ ] `gh pr create --fill --label "Ready for Review"`
