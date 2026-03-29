# Bugfix – Freitag-Scan ausgefallen + News-Cache für ETFs

## Bug 1: Automatischer Nacht-Scan am Freitag nicht gelaufen

### Symptom
Der automatische Scan vom Freitag 28. März 2026 hat keine Ergebnisse produziert.
Manueller Scan am Samstag 29. März hat korrekt funktioniert (519 Symbole).

### Untersuchung
- [ ] Worker-Logs prüfen: `docker logs swing-scanner-worker-1 --since 72h | grep -E "daily_scan|ERROR|scheduler"`
- [ ] Prüfen ob der ARQ-Job korrekt registriert ist nach letztem Deploy
- [ ] Prüfen ob NAS im Sleep-Mode war um 22:15 UTC
- [ ] Sicherstellen dass der Cron-Job nach jedem `./update.sh` weiterläuft

### Betroffene Dateien
- `backend/scheduler.py` — ARQ Job-Registrierung

---

## Bug 2: News-Headlines für ETFs veraltet (aus 2024)

### Symptom
ETF-Ticker (GLD, SLV, TLT, XLF etc.) zeigen News-Headlines aus 2024.
Ursache: Diese Ticker wurden vorher nie gescannt, daher kein frischer Cache.

### Fix
- [ ] Beim ersten Scan eines neuen Tickers: News-Fetch erzwingen (kein Cache-Hit akzeptieren)
- [ ] Cache-TTL für News auf max. 24 Stunden setzen
- [ ] ETF-Ticker explizit auf "kein Cache" setzen wenn `avg_volume = null` (erster Scan)

### Betroffene Dateien
- `backend/scanner/news.py` (oder wo News-Caching implementiert ist)
- Prüfe wo `news_headlines` auf ScanResult gespeichert wird
