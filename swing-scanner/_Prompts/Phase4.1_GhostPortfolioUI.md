# Phase 4.1 – Ghost Portfolio Auswertung (UI)

## Voraussetzung
Erst starten wenn >= 50 abgeschlossene Predictions (WIN/LOSS/TIMEOUT) in `prediction_archive`.
Aktuell: ~153 PENDING — voraussichtlich bereit in 2-3 Monaten.

## Betroffene Dateien
- `frontend/src/components/GhostPortfolioTab.jsx` — neu erstellen
- `backend/main.py` — neue API-Endpoints
- `backend/models.py` — ggf. Abfrage-Hilfsfunktionen

## Aufgaben

### Backend: Neue API-Endpoints
- [ ] `GET /api/ghost-portfolio/stats` — Gesamt-Statistiken:
  - Total Predictions, Win-Rate, Loss-Rate, Timeout-Rate
  - Ø Haltedauer (Tage bis Auflösung)
  - Profit-Faktor (Ø Gewinn / Ø Verlust)
- [ ] `GET /api/ghost-portfolio/by-module` — Aufschlüsselung nach Strategie-Modul:
  - Win-Rate pro Modul
  - Ø CRV pro Modul
  - Anzahl Predictions pro Modul
- [ ] `GET /api/ghost-portfolio/by-regime` — Aufschlüsselung nach Market Regime:
  - Performance bull vs. bear vs. neutral
- [ ] `GET /api/ghost-portfolio/predictions` — Gefilterte Tabelle mit Pagination

### Frontend: Ghost Portfolio Tab
- [ ] Nur anzeigen wenn >= 50 abgeschlossene Predictions — sonst: "Sammle noch Daten... X/50"
- [ ] KPI-Karten: Win-Rate, Profit-Faktor, Ø Haltedauer, Total Predictions
- [ ] Heatmap: Welches Modul performt in welchem Regime am besten?
- [ ] Balkendiagramm: Win/Loss/Timeout Verteilung pro Modul
- [ ] Filterable Predictions-Tabelle: Status, Modul, Regime, Datum
- [ ] ML Progress Bar: X/500 abgeschlossene Predictions (Ziel für ML-Training)

## Wichtige Hinweise
- TIMEOUT nie als LOSS werten — ist ein eigener Label
- TIMEOUT = Setup weder Stop noch Target getroffen nach 14 Tagen
- Datenbasis: `prediction_archive` Tabelle
