# Feature Bear-Markt Phase 4 — Pair Trading (Markt-neutral)

## Ziel
Long defensive Sektoren + Short schwache Sektoren = markt-neutrales Portfolio.
Funktioniert in jedem Regime, besonders effektiv im Bear-Markt.
Kein Direktionsrisiko — nur relative Performance zweier ETFs wird getradet.

## Voraussetzungen
- Phase 1-3 deployed und getestet
- Mindestens 4 Wochen Auto-Trading Daten für Kalibrierung

## Konzept
```
Pair: Long XLU (Utilities) + Short XLK (Technology)
→ Wenn Markt fällt: XLU fällt weniger als XLK → Spread wächst → Profit
→ Wenn Markt steigt: XLK steigt mehr → Verlust begrenzt durch XLU-Gewinn
```

## Betroffene Dateien
- `backend/scanner/pairs.py` — neu erstellen
- `backend/scheduler.py` — Pair-Scan Job
- `backend/models.py` — `PairTrade` Modell
- `frontend/src/components/PairTradingTab.jsx` — neu erstellen

## Vordefinierte Pairs

| Long | Short | Logik |
|---|---|---|
| XLU (Utilities) | XLK (Technology) | Defensiv vs. Wachstum |
| XLV (Healthcare) | XLY (Consumer Disc.) | Defensiv vs. zyklisch |
| GLD (Gold) | SPY (S&P 500) | Safe Haven vs. Markt |
| TLT (Anleihen) | QQQ (Nasdaq) | Zinssensitiv vs. Wachstum |

## Aufgaben

### 1. Pair-Analyse Modul (`pairs.py`)
- [ ] `calculate_spread(long_ticker, short_ticker)`:
  - Spread = Preis Long / Preis Short (normalisiert)
  - Z-Score des Spreads über 20 Tage
  - Signal wenn Z-Score > 2.0 (Spread zu weit auseinander → Long Trade)
  - Signal wenn Z-Score < -2.0 (Spread zu eng → Short Trade)
- [ ] `get_pair_candidates()`: prüft alle 4 Pairs täglich

### 2. PairTrade Modell
- [ ] `PairTrade(id, long_ticker, short_ticker, zscore, direction, status, created_at)`
- [ ] Status: `pending`, `active`, `closed`
- [ ] Automatische Auflösung wenn Z-Score zurück auf 0

### 3. ARQ-Job: pair_scan
- [ ] Läuft täglich um 22:00 UTC (nach daily_scan)
- [ ] Prüft Z-Score aller Pairs
- [ ] Erstellt PairTrade-Eintrag bei Signal
- [ ] ntfy-Push wenn neues Pair-Signal

### 4. UI: Pair Trading Tab
- [ ] Neue Sektion im Dashboard
- [ ] Zeigt aktuelle Pair-Spreads mit Z-Score
- [ ] Historische Spread-Charts (Recharts)
- [ ] Aktive Pair-Trades mit P&L

## Definition of Done

- [ ] Pair-Analyse berechnet Z-Score korrekt
- [ ] Pair-Signale erscheinen im Dashboard
- [ ] Spread-Charts werden angezeigt
- [ ] ntfy-Push bei neuem Signal
- [ ] Notion Roadmap aktualisieren (Page ID: 32a765e5-dc96-80b8-8106-c5a397879094)
- [ ] `gh pr create --fill --label "Ready for Review"`
