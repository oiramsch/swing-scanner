import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

const STATUS_COLORS = {
  WIN:     "#22c55e",
  LOSS:    "#ef4444",
  TIMEOUT: "#f59e0b",
  PENDING: "#6b7280",
};

const STATUS_BG = {
  WIN:     "bg-green-900/30 text-green-300 border-green-700/40",
  LOSS:    "bg-red-900/30 text-red-300 border-red-700/40",
  TIMEOUT: "bg-yellow-900/30 text-yellow-300 border-yellow-700/40",
  PENDING: "bg-gray-800 text-gray-400 border-gray-700",
};

const REGIME_ICONS = { bull: "📈", bear: "📉", neutral: "➡️" };

function StatCard({ label, value, sub, color = "text-white" }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-400 text-xs mb-1">{label}</div>
      <div className={`font-bold text-2xl ${color}`}>{value ?? "—"}</div>
      {sub && <div className="text-gray-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ data, title }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-gray-300 text-sm font-medium mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2 pr-3">Name</th>
              <th className="text-right pr-2 text-green-400">WIN</th>
              <th className="text-right pr-2 text-red-400">LOSS</th>
              <th className="text-right pr-2 text-yellow-400">TIMEOUT</th>
              <th className="text-right pr-2 text-gray-400">PENDING</th>
              <th className="text-right">Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data).map(([name, counts]) => {
              const decided = (counts.WIN || 0) + (counts.LOSS || 0);
              const hitRate = decided > 0 ? Math.round((counts.WIN / decided) * 100) : null;
              return (
                <tr key={name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 pr-3 text-gray-300 flex items-center gap-1">
                    {REGIME_ICONS[name] && <span>{REGIME_ICONS[name]}</span>}
                    <span className="capitalize">{name}</span>
                  </td>
                  <td className="text-right pr-2 text-green-400 font-medium">{counts.WIN || 0}</td>
                  <td className="text-right pr-2 text-red-400 font-medium">{counts.LOSS || 0}</td>
                  <td className="text-right pr-2 text-yellow-400">{counts.TIMEOUT || 0}</td>
                  <td className="text-right pr-2 text-gray-500">{counts.PENDING || 0}</td>
                  <td className="text-right font-medium">
                    {hitRate !== null ? (
                      <span className={hitRate >= 50 ? "text-green-400" : "text-red-400"}>
                        {hitRate}%
                      </span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentPredictions({ predictions }) {
  if (!predictions?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-gray-300 text-sm font-medium mb-3">Letzte Predictions</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2 pr-3">Ticker</th>
              <th className="text-left pr-3">Datum</th>
              <th className="text-left pr-3">Modul</th>
              <th className="text-right pr-3">Entry</th>
              <th className="text-right pr-3">Target</th>
              <th className="text-right pr-3">Stop</th>
              <th className="text-right pr-3">CRV</th>
              <th className="text-right pr-3">Tage</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {predictions.map((p) => (
              <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-2 pr-3 font-semibold text-white">{p.ticker}</td>
                <td className="pr-3 text-gray-400">{p.scan_date}</td>
                <td className="pr-3 text-gray-400 max-w-[100px] truncate" title={p.strategy_module}>
                  {p.strategy_module?.replace(/_/g, " ")}
                </td>
                <td className="text-right pr-3 text-gray-300">
                  {p.entry_price != null ? `$${p.entry_price.toFixed(2)}` : "—"}
                </td>
                <td className="text-right pr-3 text-green-400">
                  {p.target_price != null ? `$${p.target_price.toFixed(2)}` : "—"}
                </td>
                <td className="text-right pr-3 text-red-400">
                  {p.stop_loss != null ? `$${p.stop_loss.toFixed(2)}` : "—"}
                </td>
                <td className="text-right pr-3 text-gray-300">
                  {p.crv != null ? p.crv.toFixed(1) : "—"}
                </td>
                <td className="text-right pr-3 text-gray-400">
                  {p.days_to_resolve ?? "—"}
                </td>
                <td className="text-right">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATUS_BG[p.status] ?? STATUS_BG.PENDING}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GhostPortfolioSection() {
  const [stats, setStats]       = useState(null);
  const [recent, setRecent]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("ALL");
  const [showAll, setShowAll]   = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        axios.get("/api/predictions/stats"),
        axios.get("/api/predictions?limit=50"),
      ]);
      setStats(statsRes.data);
      setRecent(recentRes.data);
    } catch {
      // silently fail — no predictions yet is valid
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-32 animate-pulse" />
    </div>
  );

  const noData = !stats || stats.total === 0;
  // TIMEOUT != LOSS — TIMEOUT ist eigene ML-Klasse.
  // Für ML-Readiness: WIN + LOSS + TIMEOUT alle als entschieden zählen.
  const decided = stats?.decided_ml ?? ((stats?.wins ?? 0) + (stats?.losses ?? 0) + (stats?.timeouts ?? 0));

  // Bar chart: overall distribution
  const distData = noData ? [] : [
    { name: "WIN",     value: stats.wins,     color: STATUS_COLORS.WIN },
    { name: "LOSS",    value: stats.losses,   color: STATUS_COLORS.LOSS },
    { name: "TIMEOUT", value: stats.timeouts, color: STATUS_COLORS.TIMEOUT },
    { name: "PENDING", value: stats.pending,  color: STATUS_COLORS.PENDING },
  ].filter(d => d.value > 0);

  // ML progress bar (goal: 500 decided)
  const mlProgress = Math.min(Math.round((decided / 500) * 100), 100);

  // Filtered recent list
  const filteredRecent = filter === "ALL"
    ? recent
    : recent.filter(p => p.status === filter);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold">Ghost Portfolio</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Stille Aufzeichnung aller Scanner-Kandidaten — kein echtes Kapital
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded"
        >
          ↻
        </button>
      </div>

      {noData ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          <p className="text-2xl mb-2">👻</p>
          <p className="text-sm">Noch keine Predictions archiviert.</p>
          <p className="text-xs mt-1">Nach dem nächsten Scan-Lauf erscheinen hier die ersten Einträge.</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Gesamt" value={stats.total} />
            <StatCard label="Offen" value={stats.pending} color="text-gray-400" />
            <StatCard
              label="Win Rate"
              value={stats.win_rate_pct != null ? `${stats.win_rate_pct}%` : "—"}
              sub={`${decided} entschieden`}
              color={stats.win_rate_pct >= 50 ? "text-green-400" : stats.win_rate_pct != null ? "text-red-400" : "text-gray-400"}
            />
            <StatCard label="WIN" value={stats.wins} color="text-green-400" />
            <StatCard label="LOSS" value={stats.losses} color="text-red-400" />
            <StatCard label="TIMEOUT" value={stats.timeouts} color="text-yellow-400" />
            <StatCard
              label="Ø Tage"
              value={stats.avg_days_to_resolve != null ? `${stats.avg_days_to_resolve}d` : "—"}
              sub="bis Auflösung"
            />
          </div>

          {/* ML Progress bar */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-xs">ML Training Progress</span>
              <span className="text-gray-400 text-xs">{decided} / 500 entschieden</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${mlProgress}%`,
                  background: mlProgress >= 100
                    ? "#22c55e"
                    : mlProgress >= 50
                    ? "#f59e0b"
                    : "#6366f1",
                }}
              />
            </div>
            <p className="text-gray-600 text-xs mt-1">{stats.note}</p>
            <p className="text-gray-700 text-[10px] mt-0.5">WIN + LOSS + TIMEOUT zählen als entschiedene Labels</p>
          </div>

          {/* Chart + Regime/Module breakdown side by side on wider screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Distribution bar chart */}
            {distData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-gray-300 text-sm font-medium mb-3">Outcome-Verteilung</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={distData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 6 }}
                      labelStyle={{ color: "#f9fafb" }}
                      itemStyle={{ color: "#d1d5db" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {distData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Regime breakdown */}
            <BreakdownTable data={stats.by_regime} title="Nach Markt-Regime" />
          </div>

          {/* Module breakdown */}
          <BreakdownTable data={stats.by_module} title="Nach Strategie-Modul" />

          {/* Recent predictions */}
          <div className="space-y-2">
            {/* Filter tabs */}
            <div className="flex gap-1">
              {["ALL", "PENDING", "WIN", "LOSS", "TIMEOUT"].map(s => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    filter === s
                      ? "bg-indigo-600/30 border-indigo-500/50 text-indigo-300"
                      : "bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {s}
                  <span className="ml-1 opacity-60">
                    ({s === "ALL" ? recent.length : recent.filter(p => p.status === s).length})
                  </span>
                </button>
              ))}
            </div>

            <RecentPredictions predictions={showAll ? filteredRecent : filteredRecent.slice(0, 15)} />

            {filteredRecent.length > 15 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 bg-gray-900 border border-gray-800 rounded-lg transition"
              >
                {showAll ? "Weniger anzeigen ▲" : `Alle ${filteredRecent.length} anzeigen ▼`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
