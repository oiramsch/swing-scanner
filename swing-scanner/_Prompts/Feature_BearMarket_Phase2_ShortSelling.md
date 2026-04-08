# Feature Bear-Markt Phase 2 — Bear Bounce Short (Dead Cat Bounce)

## Strategie-Entscheidung
Phase 1 (Filter-Tuning für Longs) wurde bewusst verworfen.
0 Long-Signale im Bear-Markt = korrekter Schutzmechanismus, kein Bug.
Stattdessen: neues Modul das auf Bear Market Rallies (Dead Cat Bounces) wettet.

## Konzept: Dead Cat Bounce Short
```
Aktie im klaren Abwärtstrend
    ↓
Kurzfristige Erholung (Bounce) nach extremem Sell-Off
    ↓
Preis berührt Widerstand (SMA20 / letzte Hochs) von unten
    ↓
RSI kurzfristig überkauft (> 60) im übergeordneten Downtrend
    ↓
SHORT ENTRY: Wette auf Fortsetzung des Downtrends
```

## Betroffene Dateien
- `backend/scanner/setup_classifier.py` — neuer Branch `bear_bounce_short`
- `backend/scanner/indicators.py` — SMA20 prüfen ob bereits vorhanden
- `backend/brokers/alpaca.py` — Short Order Logik
- `backend/models.py` — `direction = "short"` bereits vorhanden, prüfen
- `backend/scheduler.py` — ntfy-Alert bei Short-Signal
- `frontend/src/components/CandidateCard.jsx` — Short-Badge
- `frontend/src/components/PlanModal.jsx` — Short CRV-Rechner
- `frontend/src/components/TradingCockpit.jsx` — Short-Zonen-Logik

## Aufgaben

### 1. Neues Strategie-Modul: Bear Bounce Short Classifier

In `setup_classifier.py` neuen Branch hinzufügen:

```python
# Bear Bounce Short — Dead Cat Bounce
# Regime: bear (zwingend)
if (regime == "bear"
    and close < sma50            # Übergeordneter Downtrend intakt
    and sma50 < sma200           # SMA50 unter SMA200 bestätigt
    and rsi14 > 60               # Kurzfristig überkauft (Bounce)
    and trend_lower_highs        # Aus extracted_facts_json
    and close >= nearest_resistance * 0.97  # Nah an Widerstand (< 3% darunter)
    and last_candle_type in ["reversal_red", "shooting_star", "bearish_engulfing"]):

    direction = "short"
    setup_type = "reversal"
    entry_zone = f"{nearest_resistance * 0.97:.2f}-{nearest_resistance:.2f}"
    stop_loss  = f"{nearest_resistance * 1.03:.2f}"  # 3% über Widerstand
    target     = f"{nearest_support:.2f}"
    reasoning  = (
        f"Bear Bounce Short: RSI({rsi14:.0f}) überkauft im Downtrend. "
        f"Preis nähert sich Widerstand {nearest_resistance:.2f}. "
        f"SMA50({sma50:.2f}) < SMA200({sma200:.2f}). Dead Cat Bounce erwartet."
    )
```

- [ ] Modul in DB registrieren: Name "Bear Bounce Short", Regime "bear", Badge-Farbe Dunkelrot
- [ ] Short-CRV = `(entry - target) / (stop - entry)` — Mindest-CRV: 2.0
- [ ] `regime_default` S&P 500 Universe enthält "bear" — bereits korrekt ✅

### 2. Alpaca Short Order

In `alpaca.py`:
- [ ] `place_short_bracket_order(ticker, qty, entry, stop_loss, take_profit)`:
  - `side="sell"` für Short Entry
  - Stop/TP werden automatisch als "buy to cover" behandelt
- [ ] Guard: nur Paper-Konto (`is_paper=True`) — niemals Live
- [ ] `supports_short_selling()` → `True` auf AlpacaConnector setzen

### 3. UI-Anpassungen

- [ ] `CandidateCard.jsx`: Dunkelrotes "SHORT ↓" Badge wenn `direction="short"`
- [ ] `PlanModal.jsx`: CRV-Rechner invertiert für Shorts + rote Warnung "Stop liegt ÜBER Entry"
- [ ] `TradingCockpit.jsx`: Zonen-Logik invertiert für Shorts (Grün = nah an Widerstand)

### 4. ntfy-Alert bei neuem Short-Signal

- [ ] Bei `daily_scan` wenn Short-Kandidat `active` wird:
  ```python
  send_push(
      title=f"🔴 Short-Signal: {ticker}",
      message=f"Bear Bounce Short | Entry {entry_zone} | Stop {stop_loss} | Target {target} | CRV {crv:.1f}",
      priority="high",
      tags="chart_with_downwards_trend"
  )
  ```

### 5. PDT-Schutz

- [ ] Short-Positionen als Daytrades zählen wenn same-day eröffnet + geschlossen
- [ ] PDT-Counter im Trading Cockpit berücksichtigt Shorts

## Definition of Done

- [ ] `Bear Bounce Short` erscheint in Scanner-Ergebnissen im Bear-Markt
- [ ] Setup-Bedingungen korrekt: RSI > 60, Preis < SMA50 < SMA200, Reversal-Kerze, nah an Widerstand
- [ ] CRV-Berechnung für Shorts korrekt (Stop über Entry, Target unter Entry)
- [ ] Alpaca Short Bracket Order korrekt (nur Paper, niemals Live)
- [ ] SHORT-Badge in CandidateCard sichtbar
- [ ] ntfy-Push bei neuem Short-Signal
- [ ] Ghost Portfolio tracked Short-Kandidaten korrekt
- [ ] Alle Unit-Tests grün + neue Tests für Short-CRV-Berechnung
- [ ] Notion Roadmap aktualisieren (Page ID: 32a765e5-dc96-80b8-8106-c5a397879094)
- [ ] `gh pr create --fill --label "Ready for Review"`
