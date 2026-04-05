# Bugfix: Scan-Monitoring + ETF News-Cache

## Betroffene Dateien
- `backend/main.py` — neuer `/api/scan/status` Endpoint
- `backend/scheduler.py` — optionaler Monitoring-Cron
- `frontend/src/App.jsx` oder `frontend/src/components/Header.jsx` — Banner-Anzeige
- `backend/scanner/news.py` oder `backend/main.py` Zeile ~1539 — yfinance News-Filter

---

## Bug 1 — Scan-Ausfälle sind unsichtbar (HOHE PRIO)

### Problem
Der ARQ-Cron (`hour={22}, minute={15}`) ist registriert, aber es gibt kein Monitoring
das erkennt wenn ein Scan ausbleibt. Der Ausfall vom 28.03. blieb unbemerkt.

### Fix

- [ ] **Neuer Endpoint** `GET /api/scan/status`:
  ```json
  {
    "last_scan_date": "2026-04-03",
    "last_scan_time": "22:17:43",
    "hours_since_last_scan": 1.4,
    "scan_missing": false
  }
  ```
  Liest `last_scan_date` + `last_scan_time` aus der DB (letzter ScanResult-Eintrag).
  `scan_missing = True` wenn `hours_since_last_scan > 26`.

- [ ] **Frontend-Banner** wenn `scan_missing == true`:
  Oranges Banner im Header: "⚠️ Letzter Scan vor X Stunden — Scan möglicherweise ausgefallen"
  Verschwindet automatisch wenn nächster Scan gelaufen ist.

- [ ] **Optional: ntfy-Alert** via zweitem Cron (23:30 UTC):
  Prüft ob `last_scan_date == today`. Wenn nicht → ntfy Push:
  "🚨 Scan ausgefallen! Letzter Scan: {last_scan_date}"
  ARQ-Job Name: `check_scan_health`

---

## Bug 2 — ETF News veraltet (NIEDRIGE PRIO)

### Problem
`yf.Ticker(sym).news` in `main.py` (~Zeile 1539) liefert für ETFs manchmal
gecachte/alte Artikel aus 2024. Es gibt keine TTL-Logik für News-Daten.

### Fix (Option A — empfohlen)

- [ ] yfinance News nur akzeptieren wenn `published_at < 48h` alt:
  ```python
  news = [n for n in ticker.news
          if time.time() - n.get("providerPublishTime", 0) < 48 * 3600]
  ```
  Wenn nach Filter leer → leeres Array zurückgeben statt veraltete Headlines.

### Fix (Option B — falls Option A unzureichend)

- [ ] `news_checker.py` (Polygon-News) als Fallback wenn yfinance-News veraltet.
  Nur wenn Polygon-Key vorhanden (`POLYGON_API_KEY` in Settings).

---

## Definition of Done

- [ ] `GET /api/scan/status` gibt korrektes JSON zurück
- [ ] Banner erscheint im Frontend wenn `hours_since_last_scan > 26`
- [ ] yfinance News werden auf max. 48h Alter gefiltert
- [ ] Kein `print()` im neuen Code
- [ ] `gh pr create --fill --label "Ready for Review"`
