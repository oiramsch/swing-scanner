import { useState } from "react";
import axios from "axios";
import MarketUpdateDetail from "./MarketUpdateDetail";

function formatTime(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch { return null; }
}

export default function MarketUpdateBanner({ update: initialUpdate }) {
  const [update, setUpdate] = useState(initialUpdate);
  const [loading, setLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState(null);

  async function handleLiveUpdate() {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/portfolio/market-update/refresh");
      setUpdate(res.data);
      setShowDetail(true);
    } catch (err) {
      setError(err.response?.data?.detail || "Live Update fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  // Determine banner state
  const level = update?.notification_level || "info";
  const isCritical = level === "critical";
  const isWarning = level === "warning";

  const spyChange = update?.spy_change_pct;
  const qqq = update?.qqq_change_pct;
  const vix = update?.vix_level;
  const summary = update?.portfolio_summary;
  const action = update?.overall_action;
  const updatedAt = formatTime(update?.generated_at);

  const criticalAlerts = (() => {
    if (!update?.critical_alerts_json && !update?.critical_alerts) return [];
    try {
      const raw = update.critical_alerts || JSON.parse(update.critical_alerts_json || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  })();

  const bannerStyle = isCritical
    ? "bg-red-950/80 border-red-700"
    : isWarning
    ? "bg-orange-950/60 border-orange-700"
    : "bg-gray-900 border-gray-700";

  const iconColor = isCritical ? "text-red-400" : isWarning ? "text-orange-400" : "text-blue-400";

  if (!update) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span>📊</span>
          <span>Kein Market Update vorhanden</span>
        </div>
        <button
          onClick={handleLiveUpdate}
          disabled={loading}
          className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-50 flex items-center gap-1.5 transition"
        >
          {loading ? (
            <><span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" /> Analysiere…</>
          ) : "🔄 Live Update"}
        </button>
      </div>
    );
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${bannerStyle}`}>
      {/* Main banner row */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${iconColor}`}>
              {isCritical ? "🔴 KRITISCH" : isWarning ? "🟠 Market Update" : "📊 Market Update"}
            </span>
            {updatedAt && (
              <span className="text-gray-500 text-xs">— heute {updatedAt} Uhr</span>
            )}
            {/* Market indices */}
            <div className="flex items-center gap-2 text-xs ml-1">
              {spyChange !== null && spyChange !== undefined && (
                <span className={spyChange >= 0 ? "text-green-400" : "text-red-400"}>
                  S&P {spyChange >= 0 ? "+" : ""}{spyChange.toFixed(1)}%
                </span>
              )}
              {qqq !== null && qqq !== undefined && (
                <span className={`${qqq >= 0 ? "text-green-400" : "text-red-400"}`}>
                  | NASDAQ {qqq >= 0 ? "+" : ""}{qqq.toFixed(1)}%
                </span>
              )}
              {vix && <span className="text-gray-400">| VIX {vix.toFixed(1)}</span>}
            </div>
          </div>

          {/* Critical alerts */}
          {isCritical && criticalAlerts.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {criticalAlerts.slice(0, 2).map((a, i) => (
                <p key={i} className="text-red-300 text-xs font-medium">
                  {a.ticker}: {a.alert}
                </p>
              ))}
            </div>
          )}

          {/* Warning / Info summary */}
          {!isCritical && summary && (
            <p className="text-gray-400 text-xs mt-0.5 truncate">{summary}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isCritical ? (
            <button
              onClick={() => setShowDetail(d => !d)}
              className="text-xs px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded font-medium transition"
            >
              Sofort ansehen
            </button>
          ) : isWarning ? (
            <button
              onClick={() => setShowDetail(d => !d)}
              className="text-xs px-3 py-1.5 bg-orange-800/60 hover:bg-orange-700/60 text-orange-200 rounded border border-orange-700 transition"
            >
              {showDetail ? "Schließen ▲" : "Details anzeigen ▼"}
            </button>
          ) : (
            <button
              onClick={() => setShowDetail(d => !d)}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300 transition"
            >
              {showDetail ? "▲" : "▼"}
            </button>
          )}
          <button
            onClick={handleLiveUpdate}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-50 flex items-center gap-1.5 transition"
          >
            {loading ? (
              <><span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" /> Analysiere…</>
            ) : "🔄 Live Update"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 pb-2 text-red-400 text-xs">{error}</div>
      )}

      {/* Detail panel */}
      {showDetail && update && (
        <div className="border-t border-gray-700">
          <MarketUpdateDetail update={update} />
        </div>
      )}
    </div>
  );
}
