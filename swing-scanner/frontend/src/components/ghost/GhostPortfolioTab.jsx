import { useState, useEffect, useCallback } from "react";
import axios from "axios";

const MIN_DECIDED = 50;
const ML_THRESHOLD = 500;

const MODULE_COLORS = {
  "Bull Breakout":            "bg-blue-500",
  "Bear Relative Strength":   "bg-red-500",
  "Mean Reversion":           "bg-amber-500",
  "Connors RSI-2":            "bg-purple-500",
};

const REGIME_COLORS = {
  bull:    "text-green-400 bg-green-900/20 border-green-700/40",
  bear:    "text-red-400 bg-red-900/20 border-red-700/40",
  neutral: "text-blue-400 bg-blue-900/20 border-blue-700/40",
};

const STATUS_STYLES = {
  WIN:     "bg-green-900/40 text-green-400",
  LOSS:    "bg-red-900/40 text-red-400",
  TIMEOUT: "bg-gray-800 text-gray-500",
  PENDING: "bg-gray-800 text-gray-400",
};

const ROW_COLORS = {
  green:   "border-l-2 border-l-green-600/60",
  red:     "border-l-2 border-l-red-600/60",
  yellow:  "border-l-2 border-l-yellow-600/60",
  neutral: "",
};

function WinRateBar({ wins, losses, timeouts, module: mod }) {
  const decided = wins + losses;
  const total   = decided + timeouts;
  if (decided === 0) return <span className="text-gray-600 text-xs">Keine Daten</span>;
  const winPct   = Math.round(wins   / decided * 100);
  const barColor = MODULE_COLORS[mod] ?? "bg-indigo-500";

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

function fmt(val, decimals = 2) {
  if (val == null) return "—";
  return Number(val).toFixed(decimals);
}

const DATA_GAP_TOOLTIP = "Datenlücke — Entry-Zone wurde nicht berechnet (Bear RS Bug 26.03.)";
const SILENT_TOOLTIP   = "Dieser Kandidat wurde vom Scanner erkannt aber nicht im Dashboard angezeigt (kein vollständiges Setup zum Scan-Zeitpunkt)";

function NullCell() {
  return (
    <span title={DATA_GAP_TOOLTIP} className="text-gray-600 cursor-help">—</span>
  );
}

function EntryZoneCell({ low, high }) {
  if (low == null && high == null) return <NullCell />;
  if (low != null && high != null && Math.abs(low - high) > 0.001) {
    return <span className="text-gray-300 whitespace-nowrap">${fmt(low)}–${fmt(high)}</span>;
  }
  return <span className="text-gray-300 whitespace-nowrap">${fmt(low ?? high)}</span>;
}

function PriceCell({ value }) {
  if (value == null) return <NullCell />;
  return <span className="text-gray-300 whitespace-nowrap">${fmt(value)}</span>;
}

function CrvCell({ crv, entryLow, stopLoss, targetPrice }) {
  // Use stored CRV if available, otherwise compute from entry_low
  let val = crv;
  if (val == null && entryLow != null && stopLoss != null && targetPrice != null) {
    const risk = entryLow - stopLoss;
    if (risk > 0) {
      val = (targetPrice - entryLow) / risk;
    }
  }
  if (val == null) return <NullCell />;
  const color = val >= 2 ? "text-green-400" : val >= 1.5 ? "text-yellow-400" : "text-red-400/80";
  return <span className={`font-semibold whitespace-nowrap ${color}`}>{fmt(val, 1)}x</span>;
}

function SilentBadge() {
  return (
    <span
      title={SILENT_TOOLTIP}
      className="ml-1 px-1 py-0.5 rounded text-[10px] font-semibold bg-gray-700 text-gray-400 border border-gray-600 cursor-help"
    >
      Nicht angezeigt
    </span>
  );
}

function PositionsTable({ stats }) {
  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [pages,      setPages]      = useState(1);
  const [loading,    setLoading]    = useState(true);

  // Filters
  const [filterStatus,          setFilterStatus]          = useState("");
  const [filterModule,          setFilterModule]          = useState("");
  const [filterRegime,          setFilterRegime]          = useState("");
  const [filterDateFrom,        setFilterDateFrom]        = useState("");
  const [filterDateTo,          setFilterDateTo]          = useState("");
  const [filterCandidateStatus, setFilterCandidateStatus] = useState("");

  // Sorting / Pagination
  const [sortBy,  setSortBy]  = useState("scan_date");
  const [sortDir, setSortDir] = useState("desc");
  const [page,    setPage]    = useState(1);

  const modules = Object.keys(MODULE_COLORS);
  const regimes = ["bull", "bear", "neutral"];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, sort_by: sortBy, sort_dir: sortDir });
      if (filterStatus)          params.set("status",           filterStatus);
      if (filterModule)          params.set("module",           filterModule);
      if (filterRegime)          params.set("regime",           filterRegime);
      if (filterCandidateStatus) params.set("candidate_status", filterCandidateStatus);
      if (filterDateFrom)        params.set("date_from",        filterDateFrom);
      if (filterDateTo)          params.set("date_to",          filterDateTo);

      const res = await axios.get(`/api/ghost-portfolio/positions?${params}`);
      setItems(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
      setPages(res.data.pages ?? 1);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [page, sortBy, sortDir, filterStatus, filterModule, filterRegime, filterCandidateStatus, filterDateFrom, filterDateTo]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(col) {
    if (sortBy === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  }

  function resetFilters() {
    setFilterStatus("");
    setFilterModule("");
    setFilterRegime("");
    setFilterCandidateStatus("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  }

  const hasActiveFilter = filterStatus || filterModule || filterRegime || filterCandidateStatus || filterDateFrom || filterDateTo;

  function SortIcon({ col }) {
    if (sortBy !== col) return <span className="text-gray-700 ml-0.5">↕</span>;
    return <span className="text-indigo-400 ml-0.5">{sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  const Th = ({ children, col, className = "" }) => (
    <th
      className={`px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-gray-200 select-none whitespace-nowrap ${className}`}
      onClick={() => col && toggleSort(col)}
    >
      {children}{col && <SortIcon col={col} />}
    </th>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-200 shrink-0">
          Positions-Tabelle
          {total > 0 && <span className="ml-2 text-gray-500 font-normal text-xs">({total} Einträge)</span>}
        </h2>
        <button
          onClick={load}
          className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition shrink-0"
        >
          ↻
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Status</label>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          >
            <option value="">Alle</option>
            <option value="PENDING">Pending</option>
            <option value="WIN">Win</option>
            <option value="LOSS">Loss</option>
            <option value="TIMEOUT">Timeout</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Anzeige</label>
          <select
            value={filterCandidateStatus}
            onChange={e => { setFilterCandidateStatus(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          >
            <option value="">Alle inkl. stille</option>
            <option value="active">Nur angezeigte Kandidaten</option>
            <option value="watchlist_pending">Nur stille Kandidaten</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Modul</label>
          <select
            value={filterModule}
            onChange={e => { setFilterModule(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          >
            <option value="">Alle</option>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Regime</label>
          <select
            value={filterRegime}
            onChange={e => { setFilterRegime(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          >
            <option value="">Alle</option>
            {regimes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Von</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Bis</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5"
          />
        </div>

        {hasActiveFilter && (
          <button
            onClick={resetFilters}
            className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition self-end"
          >
            ✕ Reset
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-600 text-sm">Keine Einträge gefunden</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/60 border-b border-gray-700">
              <tr>
                <Th>Status</Th>
                <Th>Symbol</Th>
                <Th>Modul</Th>
                <Th>Regime</Th>
                <Th col="scan_date">Datum</Th>
                <Th>Entry-Zone</Th>
                <Th>Stop</Th>
                <Th>Target</Th>
                <Th>CRV</Th>
                <Th>Aktuell $</Th>
                <Th col="performance">Δ%</Th>
                <Th>Δ$</Th>
                <Th col="duration">Laufzeit</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {items.map(item => (
                <tr
                  key={item.id}
                  className={`hover:bg-gray-800/40 transition-colors ${ROW_COLORS[item.color] ?? ""}`}
                >
                  {/* Status */}
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_STYLES[item.status] ?? "bg-gray-800 text-gray-400"}`}>
                      {item.status}
                    </span>
                    {item.candidate_status === "watchlist_pending" && <SilentBadge />}
                  </td>

                  {/* Symbol */}
                  <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                    {item.ticker}
                  </td>

                  {/* Module */}
                  <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap max-w-[120px] truncate">
                    <span title={item.module}>
                      {item.module}
                    </span>
                  </td>

                  {/* Regime */}
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${REGIME_COLORS[item.regime] ?? "text-gray-500 border-gray-700"}`}>
                      {item.regime}
                    </span>
                  </td>

                  {/* Entry date */}
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                    {item.scan_date}
                  </td>

                  {/* Entry Zone */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <EntryZoneCell low={item.entry_low} high={item.entry_high} />
                  </td>

                  {/* Stop-Loss */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <PriceCell value={item.stop_loss} />
                  </td>

                  {/* Target */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <PriceCell value={item.target_price} />
                  </td>

                  {/* CRV */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <CrvCell
                      crv={item.crv}
                      entryLow={item.entry_low}
                      stopLoss={item.stop_loss}
                      targetPrice={item.target_price}
                    />
                  </td>

                  {/* Current price */}
                  <td className="px-3 py-2.5 text-gray-300 whitespace-nowrap">
                    {item.current_price != null
                      ? `$${fmt(item.current_price)}`
                      : item.status === "PENDING" ? <span className="text-gray-600">…</span> : "—"}
                  </td>

                  {/* Change % */}
                  <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${
                    item.change_pct == null ? "text-gray-600" :
                    item.change_pct >= 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {item.change_pct != null ? `${item.change_pct > 0 ? "+" : ""}${fmt(item.change_pct)}%` : "—"}
                  </td>

                  {/* Change $ */}
                  <td className={`px-3 py-2.5 whitespace-nowrap ${
                    item.change_abs == null ? "text-gray-600" :
                    item.change_abs >= 0 ? "text-green-400/80" : "text-red-400/80"
                  }`}>
                    {item.change_abs != null ? `${item.change_abs > 0 ? "+" : ""}$${fmt(item.change_abs)}` : "—"}
                  </td>

                  {/* Duration */}
                  <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">
                    {item.duration_days != null ? `${item.duration_days}d` : "—"}
                  </td>

                  {/* Details */}
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                    {item.status === "PENDING" && (item.sl_distance_pct != null || item.tp_distance_pct != null) && (
                      <div className="flex flex-col gap-0.5 text-[10px]">
                        {item.sl_distance_pct != null && (
                          <span className="text-red-400/70">SL {fmt(item.sl_distance_pct)}%</span>
                        )}
                        {item.tp_distance_pct != null && (
                          <span className="text-green-400/70">TP +{fmt(item.tp_distance_pct)}%</span>
                        )}
                      </div>
                    )}
                    {item.status in { WIN: 1, LOSS: 1 } && (
                      <div className="flex flex-col gap-0.5 text-[10px]">
                        {item.exit_price != null && (
                          <span className="text-gray-400">Exit ${fmt(item.exit_price)}</span>
                        )}
                        {item.exit_date && (
                          <span className="text-gray-600">{item.exit_date}</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            Seite {page} von {pages} · {total} Einträge
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              «
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, pages - 4));
              const p = start + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    p === page
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-gray-800 hover:bg-gray-700 text-gray-400 border-gray-700"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              ›
            </button>
            <button
              onClick={() => setPage(pages)}
              disabled={page === pages}
              className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GhostPortfolioTab() {
  const [stats,      setStats]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [recent,     setRecent]     = useState([]);
  const [tradeStats, setTradeStats] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [sRes, rRes, tRes] = await Promise.all([
        axios.get("/api/predictions/stats"),
        axios.get("/api/predictions?limit=20"),
        axios.get("/api/trade-plans/performance-stats"),
      ]);
      setStats(sRes.data);
      setRecent(rRes.data || []);
      setTradeStats(tRes.data || null);
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
    <div className="max-w-5xl mx-auto space-y-6">

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

      {/* Dashboard shown vs silent KPI */}
      {(stats.shown_in_dashboard != null || stats.silent_candidates != null) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-gray-300">Im Dashboard angezeigt</div>
              <div className="text-[11px] text-gray-500">
                Aktive Kandidaten (vollständiges Setup) vs. stille Kandidaten
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-xl font-bold text-green-400">{stats.shown_in_dashboard ?? "—"}</div>
                <div className="text-[10px] text-gray-500">Angezeigt</div>
              </div>
              <div className="text-gray-700 text-lg">/</div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-400">{stats.total ?? "—"}</div>
                <div className="text-[10px] text-gray-500">Gesamt</div>
              </div>
              {stats.silent_candidates > 0 && (
                <>
                  <div className="text-gray-700 text-lg">·</div>
                  <div className="text-center">
                    <div
                      className="text-xl font-bold text-gray-500"
                      title={SILENT_TOOLTIP}
                    >
                      {stats.silent_candidates}
                    </div>
                    <div className="text-[10px] text-gray-600">Stille</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Auto vs Manual Trade Comparison */}
      {tradeStats && (tradeStats.auto.total > 0 || tradeStats.manual.total > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-200">🤖 Auto vs. Manuell — Trade-Pläne</h2>
          </div>
          <div className="grid grid-cols-2 divide-x divide-gray-800">
            {[
              { label: "🤖 Auto", data: tradeStats.auto, color: "text-indigo-400" },
              { label: "👤 Manuell", data: tradeStats.manual, color: "text-gray-300" },
            ].map(({ label, data, color }) => (
              <div key={label} className="px-4 py-4 space-y-2">
                <div className={`text-xs font-semibold ${color}`}>{label}</div>
                <div className="text-2xl font-bold text-white">{data.total}</div>
                <div className="text-[10px] text-gray-500 space-y-0.5">
                  <div className="flex justify-between"><span>Offen</span><span className="text-blue-400">{data.active}</span></div>
                  <div className="flex justify-between"><span>Abgeschlossen</span><span className="text-green-400">{data.done}</span></div>
                  <div className="flex justify-between"><span>Storniert</span><span className="text-gray-600">{data.cancelled}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions Table */}
      <PositionsTable stats={stats} />

      {/* Recent predictions (compact, kept for quick reference) */}
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
