# Feature: Pair Trading / Markt-neutral (Phase 4)

## Zielsetzung
Pair Trading ist eine markt-neutrale Strategie: gleichzeitig Long in einem Sektor-ETF und Short in einem anderen. Profitiert nicht von Marktrichtung sondern von relativer Performance zwischen zwei korrelierten Assets.

Z-Score basiert: wenn zwei normalerweise eng korrelierte ETFs auseinanderlaufen (Z-Score > 2.0), kehrt der Spread statistisch zur Mitte zurück.

⚠️ **Voraussetzung:** Phase 2+3 deployed und 2-4 Wochen Paper-Trading Daten vorhanden.

## Kontext & betroffene Dateien
- `backend/scanner/screener.py` — Haupt-Scanner-Pipeline (Pair-Scan hinzufügen)
- `backend/scanner/indicators.py` — Z-Score Berechnung hinzufügen
- `backend/models.py` — neues PairSignal Modell
- `backend/scheduler.py` — täglicher Pair-Scan ARQ-Job
- `backend/main.py` — neue `/api/pairs` Endpoints
- `frontend/src/App.jsx` — neuer "Pairs" Tab
- `frontend/src/components/PairsTab.jsx` — neue Komponente (neu erstellen)

## Die 4 Pairs

| Long | Short | Logik | Phase |
|------|-------|-------|-------|
| XLU (Utilities) | XLK (Technology) | Defensiv vs. Wachstum | Bear |
| XLV (Healthcare) | XLY (Consumer Disc.) | Defensiv vs. zyklisch | Bear |
| GLD (Gold) | SPY (S&P 500) | Safe Haven vs. Markt | Bear/Neutral |
| TLT (Anleihen) | QQQ (Nasdaq) | Zinssensitiv vs. Wachstum | Bear |

## Implementierung

### 1. Z-Score Berechnung

In `backend/scanner/indicators.py`:
```python
def calculate_zscore(series_a, series_b, window=20):
    """Z-Score des Spread-Verhältnisses über Rolling Window."""
    spread = series_a / series_b  # Ratio
    mean = spread.rolling(window).mean()
    std = spread.rolling(window).std()
    zscore = (spread - mean) / std
    return Decimal(str(zscore.iloc[-1]))
```

### 2. PairSignal Modell

In `backend/models.py`:
```python
class PairSignal(Base):
    id, tenant_id, scan_date
    pair_name  # z.B. "XLU/XLK"
    long_ticker, short_ticker
    zscore  # Decimal
    direction  # "long_spread" oder "short_spread"
    entry_zscore, exit_zscore_target  # Decimal
    status  # active, closed, expired
    created_at
```

### 3. Täglicher Pair-Scan ARQ-Job

In `backend/scheduler.py`:
- Trigger: täglich nach Haupt-Scan (z.B. 22:30 UTC)
- Für jedes der 4 Pairs:
  - Letzten 20 Tage Kursdaten holen (yfinance)
  - Z-Score berechnen
  - Signal wenn `|Z-Score| > 2.0`:
    - Z > +2.0: Long A / Short B (Spread kehrt zurück)
    - Z < -2.0: Short A / Long B
  - PairSignal in DB speichern
  - ntfy-Push: `📊 Pair-Signal: Long {long} / Short {short} | Z={zscore:.2f}`

### 4. API Endpoints

In `backend/main.py`:
- `GET /api/pairs` — aktuelle Pair-Signale
- `GET /api/pairs/history` — historische Signale mit Performance

### 5. PairsTab UI

Neue Komponente `frontend/src/components/PairsTab.jsx`:
- Tabelle mit 4 Pairs: aktueller Z-Score + Sparkline (7-Tage)
- Z-Score Ampel: Grün (neutral), Gelb (1.5-2.0), Rot (>2.0 = Signal)
- Aktive Signale mit Long/Short Richtung
- Historische Performance der Pairs

### 6. Navigation

In `frontend/src/App.jsx`:
- Neuer Tab "Pairs" neben anderen Tabs

## Definition of Done
@claude: Erstelle den PR erst wenn ALLE Punkte erfüllt sind:
- [ ] `calculate_zscore()` in `indicators.py` implementiert (Decimal, kein Float)
- [ ] `PairSignal` Modell mit `tenant_id` in DB
- [ ] ARQ-Job `daily_pair_scan` implementiert für alle 4 Pairs
- [ ] Signals nur bei `|Z-Score| > 2.0`
- [ ] ntfy-Push bei neuem Pair-Signal
- [ ] `GET /api/pairs` und `GET /api/pairs/history` Endpoints
- [ ] `PairsTab.jsx` mit Z-Score Ampel und aktiven Signalen
- [ ] Neuer "Pairs" Tab in Navigation
- [ ] Kein Float/Double — ausschließlich Decimal für alle Kurse/Scores
- [ ] Unit Tests für Z-Score Berechnung
- [ ] CI Tests grün
