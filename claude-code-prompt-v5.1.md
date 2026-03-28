# Claude Code Prompt — Stock Screener & Trading App: Debugging, Fixes & Roadmap

## Kontext

Wir haben eine Stock-Screening-App (Next.js/React + Python Backend), die Aktien nach technischen Filtern scannt und Kandidaten für Swing-/Daytrades identifiziert. Die App nutzt Alpaca als Broker-API und yfinance als Datenquelle (S&P 500 Universe, ~503 Symbole).

**Aktueller Stand (v5.1):**
- yfinance + S&P 500 Universe liefert 503 Symbole → 449 nach Pre-Filter
- Market Regime korrekt auf BEAR ✓
- Regime-Switching Strategy Modules implementiert ✓ — Scanner liefert jetzt 29 Kandidaten (statt vorher 1)
- Jeder Kandidat trägt ein `strategy_module`-Badge ✓
- Filter-Funnel-Logging + `/api/scan/funnel` Endpoint ✓
- **NEU BEKANNT: Drei systematische Qualitätsprobleme im Output der Module** → siehe 1.0b (höchste Priorität)
- **NEUE STRATEGIE: Ghost Portfolio** — lautloser ML-Datensammler ab Tag 1 → siehe 1.7

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

### 🚨 1.0b KRITISCH: Output-Qualität der Module korrigieren

**Kontext:** Der erste echte Datenlauf mit 29 Kandidaten (nach Implementierung von 1.0) hat drei systematische Qualitätsprobleme aufgedeckt. Diese müssen vor allem anderen gefixt werden — sie korrumpieren das UI mit unbrauchbaren oder irreführenden Einträgen.

---

**Fix A — `recommendation: "avoid"` = hartes Ausschlusskriterium**

*Beobachtetes Problem:* FCX (Score 3) und FITB (Score 3) erscheinen in der UI, obwohl die Deep-Analysis explizit `recommendation: "avoid"` zurückgibt.

*Regel:* Kandidaten mit `recommendation: "avoid"` werden wie `technicals_invalid` behandelt.

```python
# Backend: nach Deep-Analysis, vor UI-Ausgabe
if candidate.deep_analysis.get("recommendation") == "avoid":
    candidate.status = "filtered_avoid"
    log_filtered(candidate, reason="deep_analysis_avoid")
    continue  # NICHT in UI-Response
```

- Nicht in der Kandidaten-Liste anzeigen
- Ins Backend-Log schreiben (für Audit/Debugging)
- Optional: Power-User-Toggle "Ausgeschlossene anzeigen" zeigt diese Gruppe mit rotem Badge

---

**Fix B — Mean Reversion ohne Setup = Watchlist, nicht Kandidat**

*Beobachtetes Problem:* ~15 Mean-Reversion-Kandidaten (BAC, CAG, CMCSA, FCX, FITB, GIS, KHC, KO, MSFT, NEM, NKE, RF, USB, MO, MOS u.a.) haben `setup_type: "none"`, `entry_zone: null`, `stop_loss: null`, `target: null`, `crv_calculated: null`. Claude Vision erkennt korrekt die überverkaufte Situation — kann aber kein handelbares Setup ableiten. Das ist eine Beobachtung, kein Trade-Signal.

*Regel:* Kandidat ohne vollständiges Setup-Tripel (entry + stop + target) = kein Kandidat, sondern Watchlist-Eintrag.

```python
# Backend: Klassifizierung nach Deep-Analysis
def classify_candidate(candidate):
    da = candidate.deep_analysis
    has_full_setup = all([
        da.get("entry_zone") is not None,
        da.get("stop_loss") is not None,
        da.get("target") is not None,
    ])
    if not has_full_setup:
        candidate.status = "watchlist_pending_signal"
        return "watchlist"
    return "candidate"
```

*UI — neue Kategorie "⏳ Watchlist — wartet auf Umkehrsignal":*
- Separater Bereich unterhalb der Kandidaten-Liste (eingeklappt by default, ausklappbar)
- Zeigt Symbol, Modul-Badge, RSI, kurze Begründung ("Überverkauft, kein Entry-Signal")
- Kein Buy-Button, keine CRV-Anzeige
- Klarer Hinweis: "Beobachten — Entry-Signal abwarten"

---

**Fix C — Stop > Entry = verstecktes Short-Setup, nicht als Long darstellen**

*Beobachtetes Problem:* Bei BAC, CMCSA, KO liefert die Deep-Analysis Werte wo `stop_loss > entry_zone` — das ist mathematisch ein Short-Setup. Diese wurden fälschlicherweise als Long-Kandidaten angezeigt.

*Regel:* Richtung des Setups aus Entry/Stop-Verhältnis validieren. Widerspruch zum Modul = ausblenden oder korrekt labeln.

```python
# Backend: Richtungs-Validierung
def validate_direction(candidate):
    da = candidate.deep_analysis
    entry = da.get("entry_zone")      # z.B. 45.00
    stop  = da.get("stop_loss")       # z.B. 47.50 ← stop > entry = Short-Logik

    if entry is None or stop is None:
        return  # Fix B greift bereits

    if stop > entry:
        module_direction = candidate.strategy_module.get("direction", "long")
        if module_direction == "long":
            # Widerspruch: Long-Modul liefert Short-Setup → ausblenden
            candidate.status = "direction_mismatch"
            log_filtered(candidate, reason="stop_above_entry_in_long_module")
        elif module_direction in ("short", "both"):
            # Korrekt als Short labeln wenn Broker es unterstützt
            if broker_supports_short(candidate.tenant):
                candidate.direction = "short"
                candidate.setup_type = "short_reversal"
            else:
                candidate.status = "filtered_short_not_supported"
```

*UI-Auswirkung:*
- `direction_mismatch`-Kandidaten werden nicht angezeigt
- Wenn Short-Flag aktiv: korrekt als 🔴 Short-Setup labeln
- Backend-Log für alle gefilterten Einträge

---

**Implementierungs-Reihenfolge für 1.0b (strikte Sequenz):**

1. Fix A → testen (FCX, FITB müssen verschwinden)
2. Fix B → Watchlist-Kategorie in UI bauen + testen
3. Fix C → Richtungs-Validierung + testen
4. Neuen Scan laufen lassen → Ziel: weniger Kandidaten, aber 100% actionable
5. Verify: Anzahl verbleibender Kandidaten nach allen drei Fixes im Backend loggen

---

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

### 1.6 Portfolio Live-Update & Market Update Bug fixen

**🐛 Bestätigter Bug (getestet 15:44 MEZ / 09:44 ET — Markt seit 14 Minuten offen):**
Market Update Panel zeigt `"Market data unavailable today"` während aktiver Marktzeiten. Der US-Markt öffnet 15:30 MEZ — zu dem Zeitpunkt sollten SPY-Daten via yfinance problemlos verfügbar sein. Stattdessen greift ein stiller Fallback-Pfad, der den Fehler verschleiert.

**Root-Cause-Analyse (in dieser Reihenfolge debuggen):**

1. **yfinance-Fetch im Market-Update-Kontext loggen** — wird SPY überhaupt abgerufen wenn das Panel öffnet? Fehler explizit loggen statt still auf Fallback-Text fallen.
2. **Cache-TTL prüfen** — möglicherweise werden Daten von vor Marktöffnung gecacht und der Cache-Invalidierungszeitpunkt ist falsch. Während Marktzeiten (15:30–22:00 MEZ): max. 5 Minuten TTL. Außerhalb: längere TTL okay.
3. **Fehler surfacen statt verschlucken** — der Fallback-Text "Market data unavailable" darf nur erscheinen wenn der Fehler explizit geloggt und dem User erklärbar ist (z.B. "yfinance timeout — retry in 60s").

```python
# Marktzeiten-bewusstes Caching
import pytz
from datetime import time as dtime

def get_market_data_ttl() -> int:
    """TTL in Sekunden je nach Marktzeit."""
    ny = pytz.timezone("America/New_York")
    now = datetime.now(ny).time()
    market_open  = dtime(9, 30)
    market_close = dtime(16, 0)
    if market_open <= now <= market_close:
        return 300   # 5 Minuten während Handelszeit
    return 3600      # 1 Stunde außerhalb

# Fetch mit explizitem Error-Logging
def fetch_spy_data():
    try:
        data = yf.download("SPY", period="5d", interval="1d", progress=False)
        if data.empty:
            logger.error("yfinance returned empty DataFrame for SPY")
            return None
        return data
    except Exception as e:
        logger.error(f"yfinance SPY fetch failed: {e}")
        return None  # Fehler bekannt, nicht verschluckt
```

**UI-Anforderungen:**
1. Visueller Indikator: "Letztes Update: vor X Sekunden" + Verbindungsstatus-Icon (grün/gelb/rot)
2. Wenn Fetch fehlschlägt: konkreter Fehlertext statt generischem Fallback — z.B. "SPY-Daten nicht verfügbar (yfinance Timeout) — Retry in 60s"
3. Manueller "Refresh"-Button triggert sofortigen Fetch (Cache bypass)
4. Während Marktzeiten: automatisches Polling alle 5 Minuten
5. Außerhalb Marktzeiten: kein Polling, einmaliger Fetch beim Öffnen

### 🌟 1.7 Ghost Portfolio — ML-Datensammler (ab Tag 1)

**Konzept:** Um den Survivorship-Bias zu vermeiden und frühzeitig saubere Trainingsdaten für Phase 4 (ML) aufzubauen, trackt das System alle vom Scanner identifizierten Kandidaten und Watchlist-Einträge automatisch im Hintergrund — ohne UI, ohne manuellen Aufwand.

**Warum ab Tag 1:** Wenn die Datensammlung erst in Phase 4 beginnt, fehlen 3-6 Monate realer Marktdaten. Das Ghost Portfolio löst das Henne-Ei-Problem.

**Datenbank-Tabelle `prediction_archive`:**

```sql
CREATE TABLE prediction_archive (
    id              INTEGER PRIMARY KEY,
    created_at      DATETIME NOT NULL,
    ticker          TEXT NOT NULL,
    regime          TEXT NOT NULL,          -- bull | bear | neutral
    strategy_module TEXT NOT NULL,          -- z.B. "Bear Relative Strength"
    setup_type      TEXT,                   -- breakout | pullback | reversal | none
    entry_price     REAL,
    stop_loss       REAL,
    target_price    REAL,
    crv             REAL,
    confidence      INTEGER,
    status          TEXT DEFAULT 'PENDING', -- PENDING | WIN | LOSS | TIMEOUT
    resolved_at     DATETIME,
    resolved_price  REAL,
    notes           TEXT                    -- z.B. "stop hit day 3"
);
```

**Der Schiedsrichter (täglicher Cronjob, läuft nach Börsenschluss ~22:15 MEZ):**

```python
def resolve_pending_predictions():
    pending = db.query("SELECT * FROM prediction_archive WHERE status = 'PENDING'")
    for pred in pending:
        bars = yf.download(pred.ticker, period="1d")
        daily_high  = bars["High"].iloc[-1]
        daily_low   = bars["Low"].iloc[-1]
        days_open   = (datetime.now() - pred.created_at).days

        if pred.stop_loss and daily_low <= pred.stop_loss:
            update_status(pred.id, "LOSS", resolved_price=daily_low)
        elif pred.target_price and daily_high >= pred.target_price:
            update_status(pred.id, "WIN", resolved_price=daily_high)
        elif days_open >= 14:
            # TIMEOUT ist ein eigener Label — NICHT als LOSS werten.
            # Ein Setup das weder Stop noch Target trifft ist ein
            # anderes Muster als ein klarer Verlust. Sauber halten.
            update_status(pred.id, "TIMEOUT", notes=f"expired after {days_open} days")
```

**Was geloggt wird:**
- Alle Kandidaten aus der Haupt-Liste (nach Fix A/B/C aus 1.0b)
- Alle Watchlist-Einträge (`watchlist_pending_signal`) — auch ohne Entry/Stop/Target
- Bei Watchlist: status bleibt PENDING bis Entry-Signal kommt oder Timeout

**Implementierungsregeln:**
- Reines Backend — keine UI-Integration in Phase 1
- Kein zusätzlicher yfinance-Call tagsüber — Cronjob nutzt EOD-Daten
- Doppeltes Logging vermeiden: bei Deduplizierung im Scanner → auch in prediction_archive deduplizieren (gleicher Ticker + gleicher Tag = kein zweiter Eintrag)
- TIMEOUT nach 14 Tagen als eigener Status — nie zu LOSS umklassifizieren

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

### 4.1 Auswertung des Ghost Portfolio

Das in Phase 1.7 aufgebaute `prediction_archive` wird jetzt ausgewertet:

- Win-Rate, Profit-Faktor, Durchschnitts-CRV aufgeschlüsselt nach Regime und Modul
- TIMEOUT-Rate als Qualitätsindikator (zu viele Timeouts = Setup-Logik zu vage)
- Vergleich: Welches Modul liefert in welchem Regime die besten Ergebnisse?
- Mindestdatenmenge vor ML-Training: **500 abgeschlossene Predictions** (WIN/LOSS/TIMEOUT)

### 4.2 ML-Modell-Integration

1. **Datenbasis:** `prediction_archive` aus Phase 1.7 — Minimum 3-6 Monate Laufzeit, 50-100 Features inkl. Regime, Modul, Setup-Type, CRV, Confidence, Indikator-Snapshot
2. **Modell:** XGBoost/LightGBM, Walk-Forward-Validierung (kein Look-Ahead-Bias)
3. **Labels:** WIN=1, LOSS=0, TIMEOUT=gesondert behandeln (nicht ins Trainingsset mischen bis Entscheidung getroffen)
4. **Integration:** ML-Score als zusätzlicher Ranking-Faktor im Scanner ("AI-Confidence")
5. **Infrastruktur:** Python-Microservice, wöchentliches Retraining, Model-Versioning

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

### 5.11 Filter-Profile vervollständigen (technische Schuld)

**Bekannte Lücke (Hinweis von Claude Code):** Das NAS hat nur 1 Filter-Profil ("Standard", ID=3). Die Profile "Strikt" und "Breit" wurden nie angelegt, weil der DB-Seed vorhandene Einträge überspringt.

**Kontext:** Kein akuter Bug — die Strategie-Module aus 1.0 haben Strikt/Breit architektonisch ersetzt. Wird relevant sobald die Settings-UI (2.3) Filter-Profile per Dropdown anbietet.

**Fix wenn nötig:** Seed-Logik prüfen (`INSERT OR IGNORE` vs. explizites Seeding aller Profile), fehlende Profile nachträglich anlegen.

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
4. ~~**1.0: Regime-Module implementieren**~~ ✅ DONE — 3 Module aktiv, 29 Kandidaten
5. **🚨 1.0b: Output-Qualität korrigieren** (Fix A + B + C) — Kandidaten-Liste von Noise befreien
6. **1.1: Filter-Diagnostics-Dashboard** in UI (Funnel pro Modul)
7. **1.2: CRV als Ranking-Faktor** statt hartem Cutoff
8. **1.3: UI-Qualitätsfilter** (technicals_invalid ausblenden, Corporate Action markieren, Trigger-Preis)
9. **1.4: Adaptiver Modus** (Modul-Wechsel-Vorschlag bei 0 Kandidaten)
10. **1.5: Mobile Charts** fixen
11. **1.6: Portfolio Live-Update & Market Update Bug fixen**
12. **🌟 1.7: Ghost Portfolio** — `prediction_archive` Tabelle anlegen + täglichen Cronjob einbauen

**Kosten-Checkpoints:**
- Phase 1: $0/mo (yfinance + Alpaca Free)
- Phase 2: $0/mo
- Phase 3: Paper-Trading zuerst. Paid APIs erst nach nachgewiesener Profitabilität.

Für jede Phase: Feature-Branch, aussagekräftige Commits, GitHub Issues referenzieren.

Fragen? Frag mich bevor Du Annahmen triffst — besonders bei Architektur-Entscheidungen, Filter-Kalibrierung und Modul-Design.
