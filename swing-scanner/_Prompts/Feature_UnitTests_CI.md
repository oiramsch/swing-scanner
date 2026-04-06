# Feature: Echte Unit-Tests für CI/CD

## Ziel
`backend/tests/` ist leer — pytest läuft aber findet nichts. Echte Tests verhindern
dass Claude Code oder andere PRs unbemerkt Regressionen einbauen.

## Betroffene Dateien
- `backend/tests/test_indicators.py` — neu erstellen
- `backend/tests/test_scanner.py` — neu erstellen
- `backend/tests/test_database.py` — neu erstellen
- `backend/tests/test_api.py` — neu erstellen
- `backend/tests/conftest.py` — Fixtures (In-Memory SQLite, Test-Client)

## Aufgaben

### conftest.py — Fixtures
- [ ] `test_db` Fixture: In-Memory SQLite mit allen Tabellen (kein produktiver Dateistand)
- [ ] `test_client` Fixture: FastAPI TestClient mit test_db
- [ ] Keine echten API-Calls (yfinance, Alpaca, Claude) — alles mocken

### test_indicators.py — Technische Indikatoren
- [ ] `test_rsi_basic()` — RSI bei konstantem Preis = 50
- [ ] `test_rsi_overbought()` — Steigende Preise → RSI > 70
- [ ] `test_rsi_oversold()` — Fallende Preise → RSI < 30
- [ ] `test_sma_calculation()` — SMA über bekannte Werte prüfen
- [ ] `test_atr_positive()` — ATR immer > 0
- [ ] `test_connors_rsi2()` — RSI-2 reagiert sensitiver als RSI-14

### test_scanner.py — Scanner-Logik
- [ ] `test_scan_missing_threshold()` — SCAN_MISSING_THRESHOLD_HOURS Konstante = 26
- [ ] `test_regime_detection_bull()` — SPY > SMA50 > SMA200 → "bull"
- [ ] `test_regime_detection_bear()` — SPY < SMA50 < SMA200 → "bear"
- [ ] `test_crv_calculation()` — CRV = (target - entry) / (entry - stop)
- [ ] `test_composite_score()` — Score = confidence × clamp(crv/2, 0.5, 1.5)

### test_database.py — DB-Funktionen
- [ ] `test_get_last_scan_datetime_empty()` — leere DB → None zurück
- [ ] `test_get_last_scan_datetime_with_data()` — neuester Eintrag wird zurückgegeben
- [ ] `test_scan_missing_flag()` — hours_since_last_scan > 26 → scan_missing = True

### test_api.py — API-Endpoints
- [ ] `test_scan_status_no_data()` — GET /api/scan/status bei leerer DB → scan_missing = True
- [ ] `test_scan_status_fresh_scan()` — GET /api/scan/status nach frischem Scan → scan_missing = False
- [ ] `test_health_endpoint()` — GET /api/health → 200 OK

## Definition of Done

- [ ] `pytest backend/tests/` läuft ohne Fehler durch
- [ ] Mindestens 15 Tests, alle grün
- [ ] Keine echten Netzwerk-Calls (yfinance/Alpaca/Claude gemockt)
- [ ] `ci-tests.yml` findet die Tests automatisch (kein Konfig-Aufwand)
- [ ] Kein `print()` in Test-Code
- [ ] `gh pr create --fill --label "Ready for Review"`
