# Claude Code Prompt — Stock Screener & Trading App: Debugging, Fixes & Roadmap

## Kontext

Wir haben eine Stock-Screening-App (Next.js/React + Python Backend), die Aktien nach technischen Filtern scannt und Kandidaten für Swing-/Daytrades identifiziert. Die App nutzt Alpaca als Broker-API und yfinance als Datenquelle (S&P 500 Universe, ~503 Symbole).

**Aktueller Stand:**
- yfinance + S&P 500 Universe liefert 503 Symbole → 449 nach Pre-Filter
- Market Regime ist korrekt auf BEAR (SPY $655, SMA50 $681, SMA200 $657)
- Regime-Badge im Header zeigt Regime + SPY-Daten + Timestamp + Refresh-Button ✓
- Filter-Funnel-Logging ist implementiert inkl. API-Endpoint `/api/scan/funnel` ✓
- ABER: Scanner liefert nur 10→8 Kandidaten, davon nur 1 mit CRV ≥ 2.0 (SLB)
- BEKANNTER FILTER-KILLER: `price_above_sma20=true` eliminiert 373 von 449 Aktien (83%) im Bear-Markt
- Hardcoded `rsi_bear ≤ 60` eliminiert weitere 24
- Deep-Analysis sagt bei ALLEN Kandidaten "watch", nie "buy" → Scanner produziert keine actionable Signals

**Kernprinzip: ZERO FIXKOSTEN in Phase 1-2.** Wir starten mit einem 1.000€-Konto. Alle Datenquellen müssen kostenlos sein, bis die App nachweislich profitabel ist.

---

## ARCHITEKTUR: Data Provider Abstraction Layer

### Data Provider Interface

Der Scanner darf NIEMALS direkt `yfinance` oder `alpaca` aufrufen. Abstrakte Provider-Schicht:

```python
class DataProvider(ABC):
    def get_daily_bars(self, symbol, start, end) -> pd.DataFrame: ...
    def get_symbols(self, universe="sp500") -> list[str]: ...
    def get_quote(self, symbol) -> dict: ...

class YFinanceProvider(DataProvider):    # Phase 1-2: kostenlos
class AlpacaProvider(DataProvider):      # Portfolio-Tracking & Live-Daten
# Zukünftig: TiingoProvider ($30/mo), EODHDProvider (€19.99/mo)
```

### Rollenverteilung

| Funktion | Phase 1-2 (kostenlos) | Phase 3+ (wenn profitabel) |
|---|---|---|
| **Scanner-Daten (Daily OHLCV)** | yfinance | Tiingo ($30/mo) oder EODHD (€20/mo) |
| **Portfolio-Tracking** | Alpaca Free | Alpaca Free |
| **Paper-Trading / Orders** | Alpaca Free | Alpaca Free / Live |
| **Live-Kurse (WebSocket)** | Alpaca Free (30 Symbole) | Alpaca SIP ($99/mo) |
| **News** | Polygon Free (falls vorhanden) | Polygon oder Benzinga |

---

## PHASE 1 — Scanner-Kalibrierung & Regime-Module (Priorität: HOCH)

### 🚨 1.0 KRITISCH: Regime-basierte Strategie-Module

**Problem (mit Daten belegt):**
Der aktuelle "Standard"-Filter ist ein Bull-Markt-Filter. Im Bear-Regime eliminiert `price_above_sma20=true` allein 83% aller Aktien. Das ist kein Bug — im Bull-Markt ist das korrekt. Aber im Bear-Markt braucht man **andere Strategien**, nicht lockerere Versionen derselben Strategie.

**Lösung: Regime-Switching Strategy Modules**

Statt starrer Preset-Stufen (Strikt/Normal/Breit) bauen wir Strategie-Module, die der Scanner je nach Market Regime automatisch auswählt. Jedes Modul ist ein eigenständiges JSON-Preset mit eigener Filter-Logik.

**Modul 1: "Bull Breakout" (Regime: BULL)**
- Der aktuelle Standard-Filter — funktioniert gut im Aufwärtstrend
- `price_above_sma20=true`, `price_above_sma50=true`
- Setup-Typen: breakout, momentum
- RSI: 45-75 (Stärke kauft Stärke)
- Volume Surge auf Breakout-Level

**Modul 2: "Bear Relative Strength" (Regime: BEAR)** ← JETZT BAUEN
- Sucht die "Spartaner" — Aktien die relativ stärker sind als der Gesamtmarkt
- `price_above_sma20=false` ODER `price_between_sma20_sma50=true` (Bounce-Setup)
- ODER: `sma20`-Filter komplett abschalten, nur RSI + Volumen filtern
- Setup-Typen: pullback (an Support), reversal (nach Erschöpfung)
- RSI: 35-65 (abgekühlt, nicht überverkauft) — rsi_bear-Cutoff von 60 auf 65 erhöhen
- Relative Stärke: Aktie outperformt SPY über 20 Tage
- Zusätzliche Bedingung: Close > SMA200 (langfristiger Aufwärtstrend intakt)

**Modul 3: "Mean Reversion / Deep Pullback" (Regime: BEAR oder NEUTRAL)**
- Fängt extrem überverkaufte Aktien mit Umkehr-Signal
- Preis > 10% unter SMA20 (massiv überverkauft)
- RSI < 30 (extremer Keller)
- Bullische Umkehrkerze (Hammer, Engulfing) an starker Support-Zone (SMA200)
- Höheres Risiko, daher: kleinere Position-Size-Empfehlung im Deep-Analysis

**Modul 4: "Short Reversal" (Feature-Flag, Default: AUS)**
- Nur aktivierbar wenn Broker Short-Selling unterstützt (Alpaca: ja, Trade Republic: nein)
- Sucht nach Distribution-Setups wie CF heute (bearish engulfing nach 70%+ Run)
- RSI > 70 (überkauft), dann Umkehrsignal
- Konfigurierbares Feature-Flag pro Mandant/Broker-Verbindung
- Im Bear-Regime automatisch vorgeschlagen wenn aktiviert

**Implementierung:**
```python
# Jedes Modul = JSON-Preset in der DB
{
  "name": "Bear Relative Strength",
  "regime": "bear",
  "is_active": true,
  "direction": "long",            # long | short | both
  "filters": {
    "price_above_sma20": null,     # null = don't filter on this
    "price_above_sma50": false,
    "close_above_sma200": true,    # langfristiger Trend intakt
    "rsi_min": 35, "rsi_max": 65,
    "relative_strength_vs_spy": true,
    "volume_multiplier": 1.0,
    ...
  },
  "setup_types": ["pullback", "reversal"],
  "feature_flags": {
    "allow_short": false,          # pro Mandant/Broker überschreibbar
    "auto_activate_on_regime": true
  }
}
```

**Scanner-Logik:**
1. Regime bestimmen (SPY vs. SMA50/SMA200)
2. Aktive Module für das aktuelle Regime laden
3. Jeden Modul-Filter parallel anwenden
4. Ergebnisse zusammenführen, deduplizieren, ranken
5. UI zeigt an welches Modul den Kandidaten gefunden hat

**UI-Anforderungen:**
- Modul-Tabs oder Tags: Kandidaten sind nach Modul gruppiert/gefiltert sichtbar
- User kann Module an/ausschalten (aber Regime-Default ist empfohlen)
- Settings: Pro Mandant können Module aktiviert/deaktiviert werden
- Short-Modul ist nur sichtbar wenn Broker es unterstützt

### 1.1 Filter-Diagnostics-Dashboard (UI)

**Bereits vorhanden:** Funnel-Logging im Backend + `/api/scan/funnel` Endpoint

**Jetzt bauen:**
1. Funnel als visuelles Wasserfall-Chart in der UI (eigener Tab "Diagnostics"):
   - Jeder Filter-Schritt als Balken mit Anzahl verbleibender Symbole
   - Farbkodierung: Grün = wenig gefiltert, Rot = starker Filter
   - Klickbar: Bei Klick → zeige welche Symbole rausgefallen sind
2. Pro Modul einen eigenen Funnel anzeigen (so sieht man: Bull-Filter killt 83% im Bear, aber Bear-Filter lässt 62 durch)
3. Filter Impact Score: Welcher Filter eliminiert prozentual die meisten Kandidaten?
4. Funnel-Daten pro Scan-Lauf in DB speichern (für Analyse über Zeit)

### 1.2 CRV-Handling verbessern

**Aktuelles Problem:** 6 von 8 Kandidaten haben CRV < 2.0. Systemproblem: Claude setzt Targets zu konservativ oder Stops zu weit.

**Lösung:**
1. CRV als **gewichteter Ranking-Faktor**, NICHT als hartes Ausschlusskriterium im Normal-Modus
   - Ranking-Formel: `Score = Confidence × 0.4 + CRV_normalized × 0.3 + Setup_Quality × 0.3`
   - CRV wird farblich angezeigt (Grün ≥ 2.5, Gelb ≥ 1.5, Rot < 1.5)
   - Optional: Harter CRV-Cutoff als Einstellung pro User (Default: aus)
2. "Near Misses" anzeigen: Aktien die knapp an einem Filter gescheitert sind
   - z.B. "ABC hatte CRV 1.8 (dein Minimum: 2.0)" — der User entscheidet
3. Für Mandanten mit kleinem Konto (< 5.000€): CRV ≥ 2.0 als empfohlene Einstellung mit Warnung

### 1.3 UI-Qualitätsfilter (sofort umsetzbar)

**1.3a: Invalide Kandidaten ausblenden**
- Kandidaten mit Flag `technicals_invalid` werden NICHT in der UI angezeigt
- Sie werden im Backend geloggt aber verschmutzen nicht das Dashboard
- Optional: "Ausgeblendete anzeigen"-Toggle für Power-User

**1.3b: Corporate Actions visuell markieren**
- Kandidaten mit `corporate_action`-Flag werden NICHT ausgegraut, aber:
  - Deutliche visuelle Warnung (oranges Banner / ⚠️ Icon)
  - Tooltip erklärt warum (Dividende, Split, etc.)
  - Wenn CRV gut ist → trotzdem sichtbar, aber mit Warnung

**1.3c: Trigger-Preis-Feature**
- Wenn Deep-Analysis `entry_timing: "wait_for_confirmation"` sagt:
  - Zeige NICHT nur den Entry-Bereich (z.B. "49.00-49.50")
  - Zeige zusätzlich einen konkreten **Trigger-Preis** (z.B. "Kaufsignal erst bei Close > $49.75")
  - Kandidat wird als "Watchlist — wartet auf Trigger" markiert
  - Optional (Phase 3): Alert wenn Trigger-Preis erreicht wird

### 1.4 Adaptiver Filter-Modus

1. Wenn ein Scan null Kandidaten ergibt:
   - Nicht einfach "keine Ergebnisse" anzeigen
   - Automatisch einen Hinweis: "Mit Bear-Relative-Strength-Modul: X Kandidaten verfügbar"
   - User entscheidet ob er Modul-Wechsel will
2. Zeige "Near Misses" — Aktien die nur knapp an einem Filter gescheitert sind

### 1.5 Mobile Ansicht: Aktiencharts fixen

**Problem:** Im Mobilmodus sind die Aktiengrafiken/Charts nicht richtig sichtbar.

**Vorgehen:**
1. Prüfe im Chrome DevTools Mobile-Modus (iPhone SE, iPhone 14, Galaxy S)
2. Charts müssen 100% der Container-Breite nutzen
3. Aspect-Ratio beibehalten (16:9 Desktop, 4:3 Mobile)
4. Touch-Interaktion sicherstellen (Pinch-to-Zoom, Swipe)
5. Legende und Achsenbeschriftungen auf Mobile vereinfachen

### 1.6 Portfolio Live-Update verifizieren

1. Prüfe Update-Mechanismus (WebSocket vs. Polling, Intervall)
2. Visueller Indikator: "Letztes Update: vor X Sekunden" + Verbindungsstatus-Icon
3. Manueller "Refresh"-Button als Fallback

---

## PHASE 2 — Authentifizierung & Multi-Tenancy (Priorität: HOCH)

### 2.1 Authentifizierung

1. E-Mail + Passwort (bcrypt/argon2), vorbereitet für 2FA (TOTP)
2. JWT oder Session-basiert mit Refresh-Tokens
3. Password-Reset-Flow, Brute-Force-Schutz
4. 2FA als Feature-Flag (Schema mit `totp_secret`, `two_factor_enabled`)
5. Session-Management: Auto-Logout, "Angemeldet bleiben", aktive Sessions verwalten

### 2.2 Mandantenfähigkeit (Multi-Tenancy)

```
Tenant (Mandant)
├── id, name, created_at, plan_type
├── Users[] (1:n)
│   ├── id, email, password_hash, role (admin/user), totp_secret
│   └── Settings (Preferences, Notifications)
├── Portfolios[] (1:n)
│   ├── id, name, description, broker_connection_id
│   ├── Positions[], Trades[], Watchlist[]
│   └── ScannerConfig (aktive Module, Filter-Overrides)
├── BrokerConnections[] (1:n)
│   ├── id, broker_type (alpaca/ibkr/trade_republic)
│   ├── api_key_encrypted, api_secret_encrypted
│   ├── is_paper_trading (boolean)
│   ├── supports_short_selling (boolean)  ← bestimmt ob Short-Modul verfügbar
│   └── account_info (cached)
└── StrategyModules[] (aktive/inaktive Module pro Mandant)
```

- Strikte Datentrennung: Jede DB-Query muss tenant_id filtern
- API-Key-Verschlüsselung: AES-256 at-rest

### 2.3 Broker-Anbindung & Settings UI

1. Settings-Seite für Broker-Verbindungen:
   - Broker wählen (Alpaca, später IBKR, Trade Republic)
   - API-Key/Secret eingeben (verschlüsselt), Paper vs. Live Toggle
   - Verbindungstest-Button, Kontoinformationen
   - `supports_short_selling` wird automatisch gesetzt je nach Broker-Typ
2. Settings-Seite für Datenprovider:
   - Dropdown: yfinance (kostenlos) | Tiingo | EODHD
   - Universe: S&P 500 | Russell 1000 | Custom (CSV-Upload)
3. Settings-Seite für Strategie-Module:
   - Aktive Module an/ausschalten
   - Filter-Parameter pro Modul anpassbar
   - Short-Modul nur sichtbar wenn Broker es unterstützt

---

## PHASE 3 — Trading-Funktionalität (Priorität: MITTEL)

**WICHTIG:** Erst starten wenn Phase 1-2 abgeschlossen und Scanner nachweislich gute Signals produziert. Paper-Trading zuerst, echtes Geld erst nach 1 Monat nachgewiesener Profitabilität.

**Alpaca-spezifische Hinweise:**
- PDT-Regel beachten: Bei Konten < $25.000 maximal 3 Daytrades pro 5-Tage-Fenster
- SWIFT-Gebühren: Wise/Revolut für günstigere Überweisungen prüfen
- Paper-Trading-Konto für alle Tests nutzen bevor echtes Geld fließt

### 3.1 Direktes Trading über die API

1. Order-Typen: Market, Limit, Stop-Limit, Bracket (Entry + SL + TP)
2. Order-Formular mit Vorschau, Positionsgröße, Bestätigung
3. Order-Management: Offene Orders, Historie, Fill-Benachrichtigungen
4. Doppelte Bestätigung bei Live-Orders, Single bei Paper-Trading

### 3.2 Pre-Market Kauf-Modus ("Trading Cockpit")

- Live-Kurse via Alpaca Free WebSocket (max 30 Symbole, reicht für 5-15 Kandidaten)
- Farbkodierung: Grün = Kaufbereich, Gelb = nah dran, Rot = außerhalb
- **Trigger-Preis-Integration:** Kandidaten mit "wait_for_confirmation" zeigen Live-Kurs vs. Trigger-Preis, Button wird erst grün wenn Trigger erreicht
- Spread-Anzeige, Volumen-Indikator, Countdown-Timer bis Marktöffnung

### 3.3 Auto-Trading-Modus (Feature-Flag, Default: AUS)

1. Automatische Orderausführung wenn Kurs Kaufbereich erreicht + Volumen OK + CRV intakt
2. Sicherheits-Limits: Max Positionsgröße, Max gleichzeitige Trades, Max Tagesverlust → Auto-Stop
3. Nur im Paper-Trading-Modus initial verfügbar
4. PDT-Schutz: Warnung/Block wenn 3 Daytrades in 5 Tagen erreicht (Konten < $25k)

---

## PHASE 4 — ML & Prediction Tracking (Priorität: NIEDRIG / LANGFRISTIG)

### 4.1 Vorhersagen-Archiv

- Jede Scanner-Empfehlung archivieren mit: Timestamp, Aktie, Entry/Stop/Target, CRV, Indikatoren-Snapshot, Markt-Kontext, **Regime**, **verwendetes Modul**
- Ergebnis-Tracking: Ziel erreicht? Stop ausgelöst? Win-Rate, Profit-Faktor
- Performance aufschlüsseln nach: Filter-Kombination, Regime, Modul

### 4.2 ML-Modell-Integration

1. Datensammlung: 3-6 Monate Minimum, 50-100 Features inkl. Regime + Modul
2. Modell: XGBoost/LightGBM, Walk-Forward-Validierung
3. Integration: ML-Score als Ranking-Faktor, "AI-Confidence" pro Kandidat
4. Infrastruktur: Python-Microservice, wöchentliches Retraining, Model-Versioning

---

## PHASE 5 — Weitere Verbesserungen

### 5.1 Benachrichtigungen/Alerting
- E-Mail/Telegram wenn Kandidat Kaufbereich oder Trigger-Preis erreicht
- Alert wenn Regime wechselt (Bull→Bear, etc.)

### 5.2 Backtesting-Engine
- Strategien gegen historische Daten testen (yfinance History reicht)
- Backtests aufschlüsseln nach Regime UND nach Modul
- Vergleich: Welches Modul performt in welchem Regime am besten?

### 5.3 Caching & Performance
- Lokaler Cache für yfinance-Daten (SQLite/JSON)
- Batch-Downloads (`yf.download(["AAPL", "MSFT", ...])`)

### 5.4 Strukturiertes Logging
- structlog/Winston statt console.log, Log-Level, Korrelations-IDs

### 5.5 Position Sizing & Risk Management
- Kelly-Criterion oder Fixed-Fractional, automatisch basierend auf Kontogröße
- PDT-Warnung einbauen (Alpaca-Konten < $25k)
- Portfolio-Risiko-Übersicht (Exposure, Sektor-Konzentration)

### 5.6 Stop-Loss/Take-Profit-Management
- Trailing-Stop, ATR-basierte Anpassung, Partial-Take-Profit

### 5.7 Export & Dokumentation
- Trade-Journal PDF, CSV für Steuererklärung

### 5.8 CI/CD & Testing
- Unit-Tests für Filter-Logik, CRV, Regime, Module
- Integration-Tests für Data Provider (Mock-Provider)
- E2E-Tests, GitHub Actions Pipeline

### 5.9 Watchlists
- Eigene Watchlists, Drag & Drop zu Portfolio, Alerts

### 5.10 Data Provider Upgrade-Pfad (erst wenn profitabel!)
- **EODHD EOD All World: €19.99/mo** — 100k req/Tag, Bulk-Download
- **Tiingo Power: $30/mo** — 101k Symbole, sauber adjustiert
- **Alpaca SIP: $99/mo** — alle Börsen, unbegrenzte WebSockets
- **Polygon.io Starter: $29/mo** — unbegrenzte API, 5 Jahre History

---

## Arbeitsreihenfolge

Phase 1 — strikte Reihenfolge:

1. Projektstruktur & Tech-Stack verstehen
2. `.env.example` aktualisieren — ich trage Keys ein
3. Lokal kompilieren und starten
4. **🚨 1.0: Regime-Module implementieren** — "Bear Relative Strength" als erstes neues Modul, damit Scanner im Bear-Markt brauchbare Ergebnisse liefert
5. **1.1: Filter-Diagnostics-Dashboard** in UI (Funnel pro Modul)
6. **1.2: CRV als Ranking-Faktor** statt hartem Cutoff
7. **1.3: UI-Qualitätsfilter** (technicals_invalid ausblenden, Corporate Action markieren, Trigger-Preis)
8. **1.4: Adaptiver Modus** (Modul-Wechsel-Vorschlag bei 0 Kandidaten)
9. **1.5: Mobile Charts** fixen
10. **1.6: Portfolio Live-Update** verifizieren

**Kosten-Checkpoints:**
- Phase 1: $0/mo (yfinance + Alpaca Free)
- Phase 2: $0/mo
- Phase 3: Paper-Trading zuerst. Paid APIs erst nach nachgewiesener Profitabilität.

Für jede Phase: Feature-Branch, aussagekräftige Commits, GitHub Issues referenzieren.

Fragen? Frag mich bevor Du Annahmen triffst — besonders bei Architektur-Entscheidungen, Filter-Kalibrierung und Modul-Design.
