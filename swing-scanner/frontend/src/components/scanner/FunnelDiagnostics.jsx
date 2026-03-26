import { useState, useEffect } from "react";
import axios from "axios";

const FILTER_LABELS = {
  insufficient_bars:  "Zu wenig Bars (<51)",
  nan_indicators:     "NaN-Indikatoren",
  price_range:        "Preisbereich (5–500$)",
  volume_min:         "Mindestvolumen",
  sma50:              "Kurs > SMA50",
  sma20:              "Kurs > SMA20",
  rsi_range:          "RSI-Bereich",
  rsi_bear:           "RSI Bear-Cap",
  volume_surge:       "Volume-Surge",
  error:              "Fehler",
};

const REGIME_COLORS = {
  bear:    "text-red-400",
  bull:    "text-green-400",
  neutral: "text-yellow-400",
};

function pct(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function WaterfallRow({ label, remaining, rejected, total, highlight }) {
  const remainPct = pct(remaining, total);
  const rejectPct = pct(rejected, total);

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className={`text-gray-400 w-44 shrink-0 truncate ${highlight ? "text-white font-semibold" : ""}`}>
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {rejected > 0 && (
            <span className="text-red-400 text-[11px]">−{rejected}</span>
          )}
          <span className={`font-semibold w-10 text-right ${highlight ? "text-indigo-300" : "text-gray-300"}`}>
            {remaining}
          </span>
        </div>
      </div>
      <div className="flex h-4 rounded overflow-hidden bg-gray-800">
        <div
          className={`transition-all duration-500 ${highlight ? "bg-indigo-500" : "bg-indigo-800"}`}
          style={{ width: `${remainPct}%` }}
        />
        {rejected > 0 && (
          <div
            className="bg-red-800/70 transition-all duration-500"
            style={{ width: `${rejectPct}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ParamBadge({ label, value }) {
  if (value == null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{String(value)}</span>
    </span>
  );
}

const MODULE_COLORS = {
  "Bull Breakout":          { active: "bg-green-700", bar: "bg-green-900/60" },
  "Bear Relative Strength": { active: "bg-orange-600", bar: "bg-orange-900/60" },
  "Mean Reversion":         { active: "bg-purple-700", bar: "bg-purple-900/60" },
};

function ModuleBreakdown() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get("/api/scan/by-module")
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-20 animate-pulse bg-gray-800/50 rounded-lg" />;
  if (!data?.modules?.length) return <p className="text-xs text-gray-600">Keine Modul-Daten verfügbar.</p>;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">Scan vom {data.scan_date}</p>
      {data.modules.map(m => {
        const total = m.total || 1;
        const colors = MODULE_COLORS[m.name] ?? { active: "bg-indigo-700", bar: "bg-indigo-900/60" };
        return (
          <div key={m.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-300 font-medium">{m.name}</span>
              <span className="text-gray-500">{m.total} verarbeitet</span>
            </div>
            <div className="flex h-5 rounded overflow-hidden bg-gray-800 text-[10px]">
              {m.active > 0 && (
                <div className={`${colors.active} flex items-center justify-center text-white`} style={{ width: `${(m.active/total)*100}%` }} title={`Aktiv: ${m.active}`}>
                  {m.active > 2 ? m.active : ""}
                </div>
              )}
              {m.watchlist_pending > 0 && (
                <div className="bg-yellow-700/70 flex items-center justify-center text-yellow-200" style={{ width: `${(m.watchlist_pending/total)*100}%` }} title={`Watchlist: ${m.watchlist_pending}`}>
                  {m.watchlist_pending > 2 ? m.watchlist_pending : ""}
                </div>
              )}
              {m.direction_mismatch > 0 && (
                <div className="bg-red-800/60 flex items-center justify-center text-red-300" style={{ width: `${(m.direction_mismatch/total)*100}%` }} title={`Short: ${m.direction_mismatch}`}>
                  {m.direction_mismatch > 2 ? m.direction_mismatch : ""}
                </div>
              )}
              {m.filtered_avoid > 0 && (
                <div className="bg-gray-700/60" style={{ width: `${(m.filtered_avoid/total)*100}%` }} title={`Avoided: ${m.filtered_avoid}`} />
              )}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-gray-600">
              <span className="text-green-400">{m.active} aktiv</span>
              {m.watchlist_pending > 0 && <span className="text-yellow-600">{m.watchlist_pending} watchlist</span>}
              {m.direction_mismatch > 0 && <span className="text-red-500">{m.direction_mismatch} short</span>}
              {m.filtered_avoid > 0 && <span>{m.filtered_avoid} avoided</span>}
            </div>
          </div>
        );
      })}
      <div className="flex gap-3 text-[10px] flex-wrap pt-1 border-t border-gray-800">
        {[
          { color: "bg-indigo-700", label: "Aktiv" },
          { color: "bg-yellow-700/70", label: "Watchlist" },
          { color: "bg-red-800/60", label: "Short" },
          { color: "bg-gray-700/60", label: "Avoided" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-gray-500">
            <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FunnelDiagnostics({ initialFunnel }) {
  const [funnel, setFunnel] = useState(initialFunnel ?? null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(!initialFunnel);
  const [view, setView] = useState("gesamt"); // "gesamt" | "module"

  useEffect(() => {
    if (!initialFunnel) loadFunnel();
  }, []);

  useEffect(() => {
    if (initialFunnel) setFunnel(initialFunnel);
  }, [initialFunnel]);

  async function loadFunnel() {
    setLoading(true);
    try {
      const res = await axios.get("/api/scan/funnel");
      if (res.data?.status !== "no_funnel") setFunnel(res.data);
    } catch {}
    setLoading(false);
  }

  async function loadHistory() {
    try {
      const res = await axios.get("/api/scan/funnel/history?days=14");
      setHistory(res.data);
    } catch {}
  }

  function toggleHistory() {
    if (!showHistory && history.length === 0) loadHistory();
    setShowHistory(s => !s);
  }

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-40" />
    );
  }

  if (!funnel || funnel.status === "no_funnel") {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-500">
        Noch kein Scan gelaufen — Funnel-Daten erscheinen nach dem ersten Scan.
      </div>
    );
  }

  const r = funnel.rejections ?? {};
  const universe    = funnel.universe ?? 0;
  const preFilter   = funnel.pre_filter ?? universe;
  const ohlcvOk     = (funnel.ohlcv_fetched ?? preFilter) - (funnel.ohlcv_failed ?? 0);
  const candidates  = funnel.candidates ?? 0;
  const regime      = funnel.regime ?? "neutral";
  const profile     = funnel.filter_profile ?? "–";
  const params      = funnel.filter_params ?? {};

  // Build waterfall steps: each step = { label, remaining, rejected }
  let remaining = preFilter;
  const steps = [];

  const orderedRejections = [
    ["insufficient_bars", r.insufficient_bars ?? 0],
    ["nan_indicators",    r.nan_indicators ?? 0],
    ["price_range",       r.price_range ?? 0],
    ["volume_min",        r.volume_min ?? 0],
    ["sma50",             r.sma50 ?? 0],
    ["sma20",             r.sma20 ?? 0],
    ["rsi_range",         r.rsi_range ?? 0],
    ["rsi_bear",          r.rsi_bear ?? 0],
    ["volume_surge",      r.volume_surge ?? 0],
    ["error",             r.error ?? 0],
  ].filter(([, count]) => count > 0 || true); // show all steps even if 0

  for (const [key, rejected] of orderedRejections) {
    remaining -= rejected;
    steps.push({ key, label: FILTER_LABELS[key] ?? key, remaining: Math.max(0, remaining), rejected });
  }

  const totalRejected = orderedRejections.reduce((s, [, n]) => s + n, 0);
  const passRate = universe > 0 ? ((candidates / universe) * 100).toFixed(1) : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Filter-Funnel</span>
          {/* Tab switcher */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-[11px]">
            {[["gesamt", "Gesamt"], ["module", "Pro Modul"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`px-2.5 py-1 transition ${view === key ? "bg-indigo-700 text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
              >{label}</button>
            ))}
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border border-current ${
            regime === "bear" ? "text-red-400 border-red-800 bg-red-900/20" :
            regime === "bull" ? "text-green-400 border-green-800 bg-green-900/20" :
            "text-yellow-400 border-yellow-800 bg-yellow-900/20"
          }`}>
            {regime.toUpperCase()}
          </span>
          <span className="text-xs text-gray-500 px-2 py-0.5 rounded border border-gray-700 bg-gray-800">
            {profile}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">
            Pass-Rate: <span className="text-white font-semibold">{passRate}%</span>
          </span>
          <button
            onClick={toggleHistory}
            className="text-gray-500 hover:text-gray-300 underline"
          >
            {showHistory ? "Verlauf ausblenden" : "Verlauf (14d)"}
          </button>
          <button onClick={loadFunnel} className="text-gray-500 hover:text-gray-300" title="Aktualisieren">↻</button>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          { label: "Universe", value: universe, color: "text-gray-300" },
          { label: "Pre-Filter", value: preFilter, color: "text-blue-300" },
          { label: "Abgelehnt", value: totalRejected, color: "text-red-400" },
          { label: "Kandidaten", value: candidates, color: "text-indigo-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-800/60 rounded-lg p-2">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Per-Modul view */}
      {view === "module" && <ModuleBreakdown />}

      {/* Waterfall — top-level steps */}
      {view === "gesamt" && <div>
        <WaterfallRow label="Universe → Pre-Filter" remaining={preFilter} rejected={universe - preFilter} total={universe} />
        {steps
          .filter(s => s.rejected > 0)
          .map(s => (
            <WaterfallRow
              key={s.key}
              label={s.label}
              remaining={s.remaining}
              rejected={s.rejected}
              total={universe}
            />
          ))}
        <WaterfallRow label="Kandidaten (final)" remaining={candidates} rejected={0} total={universe} highlight />
      </div>}

      {view === "gesamt" && <>
      {/* Biggest blockers */}
      {(() => {
        const sorted = orderedRejections.filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a);
        if (!sorted.length) return null;
        return (
          <div>
            <p className="text-[11px] text-gray-500 mb-1.5 font-semibold uppercase tracking-wide">Größte Blocker</p>
            <div className="flex flex-wrap gap-1.5">
              {sorted.slice(0, 5).map(([key, count]) => (
                <span key={key} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-900/20 border border-red-800/40 text-red-300">
                  <span className="font-semibold">{count}×</span>
                  <span className="text-red-400/80">{FILTER_LABELS[key] ?? key}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Active filter params */}
      {Object.keys(params).length > 0 && (
        <div>
          <p className="text-[11px] text-gray-500 mb-1.5 font-semibold uppercase tracking-wide">Aktive Parameter</p>
          <div className="flex flex-wrap gap-1.5">
            <ParamBadge label="RSI" value={params.rsi_min != null ? `${params.rsi_min}–${params.rsi_max}` : null} />
            <ParamBadge label="Conf ≥" value={params.confidence_min} />
            <ParamBadge label="CRV ≥" value={params.min_crv} />
            <ParamBadge label="Vol×" value={params.volume_multiplier} />
            <ParamBadge label=">SMA50" value={params.price_above_sma50 != null ? (params.price_above_sma50 ? "ja" : "nein") : null} />
            <ParamBadge label=">SMA20" value={params.price_above_sma20 != null ? (params.price_above_sma20 ? "ja" : "nein") : null} />
            <ParamBadge label="Bear-Cap" value={params.rsi_bear_cap} />
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && view === "gesamt" && (
        <div>
          <p className="text-[11px] text-gray-500 mb-2 font-semibold uppercase tracking-wide">Verlauf (letzte 14 Tage)</p>
          {history.length === 0 ? (
            <p className="text-xs text-gray-600">Keine Verlaufsdaten.</p>
          ) : (
            <div className="space-y-1">
              {history.map((h) => {
                const hCandidates = h.candidates_count ?? 0;
                const hUniverse   = h.universe_count ?? 1;
                const hPct        = ((hCandidates / hUniverse) * 100).toFixed(1);
                const topBlock    = [
                  ["sma20",   h.fail_sma20],
                  ["rsi_bear", h.fail_rsi_bear],
                  ["volume_surge", h.fail_volume_surge],
                  ["rsi_range", h.fail_rsi_range],
                ].filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)[0];

                return (
                  <div key={h.id ?? h.scan_date} className="flex items-center gap-3 text-xs py-1 border-b border-gray-800 last:border-0">
                    <span className="text-gray-500 w-20 shrink-0">{h.scan_date}</span>
                    <span className={`w-16 shrink-0 text-center text-[11px] px-1.5 py-0.5 rounded-full border ${
                      h.regime === "bear" ? "text-red-400 border-red-800/50 bg-red-900/10" :
                      h.regime === "bull" ? "text-green-400 border-green-800/50 bg-green-900/10" :
                      "text-yellow-400 border-yellow-800/50 bg-yellow-900/10"
                    }`}>{h.regime}</span>
                    <div className="flex-1 bg-gray-800 rounded h-2">
                      <div
                        className="bg-indigo-700 h-2 rounded transition-all"
                        style={{ width: `${Math.min(100, (hCandidates / Math.max(hUniverse, 1)) * 100 * 5)}%` }}
                      />
                    </div>
                    <span className="text-indigo-400 font-semibold w-8 text-right">{hCandidates}</span>
                    <span className="text-gray-600 text-[11px] w-12 text-right">{hPct}%</span>
                    {topBlock && (
                      <span className="text-red-400/70 text-[11px] w-28 truncate text-right">
                        {FILTER_LABELS[topBlock[0]]}: {topBlock[1]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
