import { useState, useEffect } from "react";
import axios from "axios";

const MIN_DECIDED = 50;
const ML_THRESHOLD = 500;

const MODULE_COLORS = {
  "Bull Breakout":        "bg-blue-500",
  "Bear Relative Strength": "bg-red-500",
  "Mean Reversion":       "bg-amber-500",
  "Connors RSI-2":        "bg-purple-500",
};

const REGIME_COLORS = {
  bull:    "text-green-400 bg-green-900/20 border-green-700/40",
  bear:    "text-red-400 bg-red-900/20 border-red-700/40",
  neutral: "text-blue-400 bg-blue-900/20 border-blue-700/40",
};

function WinRateBar({ wins, losses, timeouts, module: mod }) {
  const decided = wins + losses;
  const total   = decided + timeouts;
  if (decided === 0) return <span className="text-gray-600 text-xs">Keine Daten</span>;
  const winPct     = Math.round(wins    / decided * 100);
  const lossPct    = Math.round(losses  / decided * 100);
  const barColor   = MODULE_COLORS[mod] ?? "bg-indigo-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${winPct}%` }} />
        </div>
        <span className={`text-xs font-semibold w-10 text-right ${winPct >= 60 ? "text-green-400" : winPct >= 45 ? "text-yellow-400" : "text-red-400"}`}>
          {winPct}%
        </span>
      </div>
      <div className="text-[10px] text-gray-600 flex gap-2">
        <span className="text-green-500">{wins}W</span>
        <span className="text-red-500">{losses}L</span>
        {timeouts > 0 && <span className="text-gray-500">{timeouts}T</span>}
        <span>({total} gesamt)</span>
      </div>
    </div>
  );
}

function RegimeRow({ regime, data }) {
  const decided = (data.WIN ?? 0) + (data.LOSS ?? 0);
  const winRate = decided > 0 ? Math.round((data.WIN ?? 0) / decided * 100) : null;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className={`text-xs px-2 py-0.5 rounded border font-semibold capitalize w-16 text-center ${REGIME_COLORS[regime] ?? "text-gray-400 border-gray-700"}`}>
        {regime}
      </span>
      <div className="flex gap-4 text-xs text-gray-400 flex-1">
        <span className="text-green-400">{data.WIN ?? 0} Wins</span>
        <span className="text-red-400">{data.LOSS ?? 0} Losses</span>
        <span className="text-gray-500">{data.TIMEOUT ?? 0} Timeouts</span>
        <span className="text-gray-600">{data.PENDING ?? 0} Pending</span>
      </div>
      {winRate != null && (
        <span className={`text-sm font-bold ${winRate >= 60 ? "text-green-400" : winRate >= 45 ? "text-yellow-400" : "text-red-400"}`}>
          {winRate}%
        </span>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color = "text-white" }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value ?? "—"}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function GhostPortfolioTab() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [recent,  setRecent]  = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [sRes, rRes] = await Promise.all([
        axios.get("/api/predictions/stats"),
        axios.get("/api/predictions?limit=20"),
      ]);
      setStats(sRes.data);
      setRecent(rRes.data || []);
    } catch {}
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-3">
        <div className="text-4xl">👻</div>
        <div className="text-gray-300 font-semibold">Ghost Portfolio startet</div>
        <div className="text-gray-500 text-sm">Nach dem ersten Scan werden Predictions automatisch archiviert und täglich ausgewertet.</div>
      </div>
    );
  }

  const decided = (stats.wins ?? 0) + (stats.losses ?? 0);
  const mlProgress = Math.min(Math.round(decided / ML_THRESHOLD * 100), 100);
  const dataReady  = decided >= MIN_DECIDED;

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          👻 Ghost Portfolio
        </h1>
        <button onClick={load} className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition">
          ↻ Aktualisieren
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Win-Rate"
          value={stats.win_rate_pct != null ? `${stats.win_rate_pct}%` : "—"}
          sub={`${decided} entschieden`}
          color={stats.win_rate_pct >= 60 ? "text-green-400" : stats.win_rate_pct >= 45 ? "text-yellow-400" : "text-red-400"}
        />
        <StatCard label="Wins" value={stats.wins} color="text-green-400" />
        <StatCard label="Losses" value={stats.losses} color="text-red-400" />
        <StatCard
          label="Ø Tage bis Entscheid"
          value={stats.avg_days_to_resolve != null ? `${stats.avg_days_to_resolve}d` : "—"}
          sub="WIN + LOSS"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Gesamt" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} color="text-gray-400" />
        <StatCard
          label="Timeout-Rate"
          value={stats.timeouts > 0 && decided + stats.timeouts > 0
            ? `${Math.round(stats.timeouts / (decided + stats.timeouts) * 100)}%`
            : "—"}
          sub={`${stats.timeouts} Timeouts`}
          color="text-gray-500"
        />
      </div>

      {/* Not enough data overlay */}
      {!dataReady && (
        <div className="bg-gray-900 border border-yellow-700/40 rounded-xl p-5 text-center space-y-2">
          <div className="text-yellow-400 font-semibold text-sm">⏳ Sammle noch Daten...</div>
          <div className="text-gray-500 text-xs">
            Statistiken sind ab {MIN_DECIDED} entschiedenen Predictions aussagekräftig.
            Aktuell: {decided} / {MIN_DECIDED}
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2">
            <div
              className="bg-yellow-500 h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round(decided / MIN_DECIDED * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* By Module */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">Performance nach Modul</h2>
        </div>
        <div className="divide-y divide-gray-800">
          {Object.entries(stats.by_module ?? {}).map(([mod, data]) => (
            <div key={mod} className="px-4 py-3 flex items-center gap-4">
              <div className="w-36 shrink-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${MODULE_COLORS[mod] ?? "bg-gray-500"}`} />
                  <span className="text-xs text-gray-300 truncate">{mod}</span>
                </div>
              </div>
              <div className="flex-1">
                <WinRateBar
                  wins={data.WIN ?? 0}
                  losses={data.LOSS ?? 0}
                  timeouts={data.TIMEOUT ?? 0}
                  module={mod}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* By Regime */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">Performance nach Regime</h2>
        </div>
        <div className="px-4">
          {Object.entries(stats.by_regime ?? {}).map(([regime, data]) => (
            <RegimeRow key={regime} regime={regime} data={data} />
          ))}
        </div>
      </div>

      {/* ML Readiness */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">🤖 ML-Modell Bereitschaft</span>
          <span className="text-xs text-gray-500">{decided} / {ML_THRESHOLD} Predictions</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${mlProgress >= 100 ? "bg-green-500" : "bg-indigo-500"}`}
            style={{ width: `${mlProgress}%` }}
          />
        </div>
        <div className="text-[10px] text-gray-600">{stats.note}</div>
      </div>

      {/* Recent predictions */}
      {recent.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-200">Letzte Predictions</h2>
          </div>
          <div className="divide-y divide-gray-800">
            {recent.map(p => (
              <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                <span className={`w-14 text-center px-1.5 py-0.5 rounded font-semibold ${
                  p.status === "WIN"     ? "bg-green-900/40 text-green-400" :
                  p.status === "LOSS"    ? "bg-red-900/40 text-red-400" :
                  p.status === "TIMEOUT" ? "bg-gray-800 text-gray-500" :
                  "bg-gray-800 text-gray-600"
                }`}>{p.status}</span>
                <span className="text-white font-semibold w-14 shrink-0">{p.ticker}</span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] ${REGIME_COLORS[p.regime] ?? "text-gray-500 border-gray-700"}`}>
                  {p.regime}
                </span>
                <span className="text-gray-600 truncate">{p.strategy_module}</span>
                <span className="ml-auto text-gray-600 shrink-0">{p.scan_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
