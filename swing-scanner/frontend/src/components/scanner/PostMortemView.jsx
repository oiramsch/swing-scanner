/**
 * PostMortemView — tägliche Analyse der Top-Gewinner vs. Scanner-Kandidaten.
 * Zeigt ob das System die Gewinner gefunden hat, und wenn nicht, warum (oder warum nicht).
 *
 * Kategorien:
 *   was_candidate — System hat es gefunden ✓
 *   good_reject   — technischer Ablehnungsgrund (korrekt aussortiert)
 *   missed        — echter Blinder Fleck (kein klarer Grund → Optimierungspotenzial)
 */
import { useState, useEffect } from "react";
import axios from "axios";

const REJECTION_LABELS = {
  sma200:           "Kurs unter SMA200",
  sma50:            "Kurs unter SMA50",
  sma20:            "Kurs unter SMA20",
  volume_min:       "Volumen zu gering",
  rsi_range:        "RSI außerhalb Bereich",
  rsi_bear:         "RSI zu hoch (Bear-Regime)",
  price_range:      "Kurs außerhalb Filter",
  relative_strength:"Underperformance vs. SPY",
  volume_surge:     "Kein Volumen-Ausbruch",
  nan_indicators:   "Zu wenig Daten",
  insufficient_bars:"Zu wenig Bars",
  fetch_error:      "Datenfehler",
};

function CategoryBadge({ category }) {
  if (category === "was_candidate")
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 border border-green-700/40 text-green-400 font-semibold">✓ Gefunden</span>;
  if (category === "good_reject")
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500 font-semibold">Gut abgelehnt</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/30 border border-orange-700/40 text-orange-400 font-semibold">Blinder Fleck</span>;
}

export default function PostMortemView() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [triggering, setTriggering] = useState(false);

  function load() {
    setLoading(true);
    axios.get("/api/scanner/post-mortem")
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (open && !data) load(); }, [open]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await axios.post("/api/scanner/post-mortem/trigger");
      setTimeout(() => { load(); setTriggering(false); }, 15000);
    } catch {
      setTriggering(false);
    }
  }

  const results  = data?.results ?? [];
  const summary  = data?.summary ?? {};
  const missed   = results.filter(r => r.category === "missed");
  const rejected = results.filter(r => r.category === "good_reject");
  const found    = results.filter(r => r.category === "was_candidate");

  return (
    <div className="mt-6">
      {/* Header / Toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-gray-400 hover:text-gray-200 transition"
      >
        <span className="flex items-center gap-2">
          <span>🔍 Post-Mortem — Tagesgewinner vs. Scanner</span>
          {summary.missed > 0 && (
            <span className="text-xs bg-orange-900/40 text-orange-400 border border-orange-700/40 px-2 py-0.5 rounded-full">
              {summary.missed} Blinde Flecken
            </span>
          )}
          {summary.was_candidate > 0 && (
            <span className="text-xs bg-green-900/30 text-green-400 border border-green-700/30 px-2 py-0.5 rounded-full">
              {summary.was_candidate} gefunden
            </span>
          )}
        </span>
        <span className="text-gray-600">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Top 30 Tagesgewinner aus dem Scanner-Universum · {data?.date ?? "—"}
            </p>
            <div className="flex gap-2">
              <button onClick={load} disabled={loading}
                className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition disabled:opacity-50">
                {loading ? "…" : "↻"}
              </button>
              <button onClick={handleTrigger} disabled={triggering}
                className="text-xs px-2.5 py-1 bg-indigo-900/30 hover:bg-indigo-800/40 border border-indigo-700/40 text-indigo-400 rounded transition disabled:opacity-50">
                {triggering ? "läuft…" : "Jetzt analysieren"}
              </button>
            </div>
          </div>

          {loading && <div className="animate-pulse h-20 bg-gray-800/50 rounded-lg" />}

          {!loading && results.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-6">
              Noch keine Daten für heute. "Jetzt analysieren" starten.
            </p>
          )}

          {/* Blinde Flecken — höchste Priorität */}
          {missed.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-orange-400 uppercase mb-2">
                Blinde Flecken ({missed.length}) — kein klarer Ablehnungsgrund
              </h4>
              <div className="space-y-1">
                {missed.map(r => (
                  <div key={r.ticker} className="flex items-center gap-3 px-3 py-1.5 bg-orange-900/10 border border-orange-800/20 rounded-lg">
                    <span className="text-white text-xs font-semibold w-12">{r.ticker}</span>
                    <span className="text-green-400 text-xs font-mono">+{r.pct_change.toFixed(1)}%</span>
                    {r.close_price && <span className="text-gray-500 text-xs font-mono">${r.close_price.toFixed(2)}</span>}
                    <CategoryBadge category={r.category} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gut abgelehnt */}
          {rejected.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Korrekt abgelehnt ({rejected.length})
              </h4>
              <div className="space-y-1">
                {rejected.map(r => (
                  <div key={r.ticker} className="flex items-center gap-3 px-3 py-1.5 bg-gray-800/30 rounded-lg">
                    <span className="text-gray-300 text-xs font-semibold w-12">{r.ticker}</span>
                    <span className="text-green-400 text-xs font-mono">+{r.pct_change.toFixed(1)}%</span>
                    <CategoryBadge category={r.category} />
                    {r.rejection_reason && (
                      <span className="text-gray-600 text-[10px]">
                        {REJECTION_LABELS[r.rejection_reason] ?? r.rejection_reason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System hat es gefunden */}
          {found.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-green-600 uppercase mb-2">
                System hat es gefunden ({found.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {found.map(r => (
                  <div key={r.ticker} className="flex items-center gap-1.5 px-2.5 py-1 bg-green-900/10 border border-green-800/20 rounded-lg">
                    <span className="text-white text-xs font-semibold">{r.ticker}</span>
                    <span className="text-green-400 text-xs font-mono">+{r.pct_change.toFixed(1)}%</span>
                    {r.was_active && <span className="text-[9px] text-green-500">aktiv</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
