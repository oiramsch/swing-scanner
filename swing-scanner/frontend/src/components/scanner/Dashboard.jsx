import { useState, useEffect, useRef } from "react";
import axios from "axios";
import CandidateCard from "./CandidateCard.jsx";
import FilterPanel from "./FilterPanel.jsx";
import FunnelDiagnostics from "./FunnelDiagnostics.jsx";

// 1.4 — Regime → best module mapping
const REGIME_MODULE = {
  bear:    "Bear Relative Strength",
  bull:    "Bull Breakout",
  neutral: "Mean Reversion",
};

function AdaptiveHint({ hint, onModuleActivated }) {
  const [modules, setModules] = useState(null);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const suggestedModuleName = REGIME_MODULE[hint.regime] ?? null;

  async function loadAndActivate() {
    if (activating || activated) return;
    setActivating(true);
    try {
      const res = await axios.get("/api/strategy-modules");
      const all = res.data.modules ?? [];
      const target = all.find(m => m.name === suggestedModuleName);
      if (target && !target.is_active) {
        await axios.post(`/api/strategy-modules/${target.id}/toggle`);
        setActivated(true);
        if (onModuleActivated) onModuleActivated();
      } else if (target?.is_active) {
        setActivated(true); // already active
      }
      setModules(all);
    } catch {}
    setActivating(false);
  }

  return (
    <div className="mt-6 max-w-2xl w-full bg-orange-900/20 border border-orange-700/40 rounded-xl p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-300 mb-1">Adaptiver Modus</p>
          <p className="text-xs text-orange-200/80 leading-relaxed mb-3">
            {hint.suggestion}
          </p>
          {suggestedModuleName && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">Empfohlenes Modul:</span>
              <span className="text-xs font-semibold text-orange-300 px-2 py-0.5 rounded border border-orange-700/50 bg-orange-900/30">
                {suggestedModuleName}
              </span>
              {!activated ? (
                <button
                  onClick={loadAndActivate}
                  disabled={activating}
                  className="text-xs px-3 py-1 bg-orange-600/30 hover:bg-orange-600/50 text-orange-200 rounded border border-orange-600/50 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {activating ? (
                    <><span className="inline-block w-3 h-3 border border-orange-400 border-t-transparent rounded-full animate-spin" /> Aktiviere…</>
                  ) : "Modul aktivieren"}
                </button>
              ) : (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  ✓ aktiviert
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SETUP_COLORS = {
  breakout: "bg-green-500",
  pullback: "bg-blue-500",
  pattern: "bg-purple-500",
  momentum: "bg-yellow-500",
  none: "bg-gray-500",
};

const PHASE_LABELS = {
  idle: null, starting: "Starting", snapshot: "Snapshot",
  screening: "Screening", charting: "Charting", analyzing: "Analyzing",
  deep_analysis: "Deep Analysis", done: "Done", error: "Error",
};

const PHASE_COLORS = {
  snapshot: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  screening: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  charting: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  analyzing: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  deep_analysis: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  done: "bg-green-500/20 text-green-400 border-green-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
  starting: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function ScanProgress({ progress }) {
  if (!progress || progress.phase === "idle") return null;
  const phase = progress.phase;
  const pct = Math.min(progress.percent ?? 0, 100);
  const colorClass = PHASE_COLORS[phase] ?? PHASE_COLORS.starting;
  return (
    <div className="mb-4 p-4 bg-gray-900 border border-gray-800 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {phase !== "done" && phase !== "error" && (
            <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
            {PHASE_LABELS[phase] ?? phase}
          </span>
          {progress.candidates_found > 0 && (
            <span className="text-xs text-green-400">{progress.candidates_found} found</span>
          )}
        </div>
        <span className="text-sm font-bold text-white">{pct}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
        <div className="h-2 rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {progress.message && <p className="text-xs text-gray-400 truncate">{progress.message}</p>}
    </div>
  );
}

export default function ScannerTab({ scanStatus, onScanStatusChange, onScanStart }) {
  const [candidates, setCandidates] = useState([]);
  const [watchlistPending, setWatchlistPending] = useState([]);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [staleInfo, setStaleInfo] = useState(null); // { stale_date: "YYYY-MM-DD" } | null
  const [filters, setFilters] = useState({ setup_type: "", min_confidence: "" });
  const [minCrv, setMinCrv] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [budget, setBudget] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [showFunnel, setShowFunnel] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    fetchCandidates(true);
    fetchWatchlistPending();
    fetchActiveFilter();
    fetchBudget();
    fetchFunnel();
    if (scanStatus?.running) startPolling();
    return () => stopPolling();
  }, []);

  async function fetchActiveFilter() {
    try {
      const res = await axios.get("/api/filters");
      const active = res.data.find(p => p.is_active) ?? null;
      setActiveFilter(active);
    } catch {}
  }

  async function fetchFunnel() {
    try {
      const res = await axios.get("/api/scan/funnel");
      setFunnel(res.data);
    } catch {}
  }

  async function fetchBudget() {
    try {
      const res = await axios.get("/api/portfolio/budget");
      setBudget(res.data);
    } catch {}
  }

  async function fetchWatchlistPending() {
    try {
      const res = await axios.get("/api/candidates/watchlist-pending");
      setWatchlistPending(res.data || []);
    } catch {}
  }

  async function fetchCandidates(isInitial = false) {
    if (isInitial) setInitialLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = {};
      if (filters.setup_type) params.setup_type = filters.setup_type;
      if (filters.min_confidence) params.min_confidence = filters.min_confidence;
      const res = await axios.get("/api/candidates", { params });
      const data = res.data;
      setCandidates(data.candidates ?? data);
      setStaleInfo(data.stale ? { stale_date: data.stale_date } : null);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      if (isInitial) setInitialLoading(false);
      else setRefreshing(false);
    }
  }

  async function fetchStatus() {
    try {
      const res = await axios.get("/api/scan/status");
      onScanStatusChange(res.data);
      return res.data;
    } catch { return null; }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const status = await fetchStatus();
      if (status && !status.running) {
        stopPolling();
        fetchCandidates();
        fetchWatchlistPending();
        fetchFunnel();
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function triggerScan() {
    setError(null);
    if (candidates.length > 0) {
      if (!confirm(`Heute existieren bereits ${candidates.length} Kandidaten. Ergebnisse ersetzen und neu scannen?`)) return;
    }
    try {
      await axios.post("/api/scan/trigger");
      onScanStatusChange((prev) => ({
        ...prev, running: true,
        progress: { phase: "starting", message: "Initializing scan…", percent: 0, processed: 0, total: 0, candidates_found: 0 },
      }));
      onScanStart();
      startPolling();
    } catch (err) {
      setError("Scan failed: " + err.message);
    }
  }

  const isScanning = scanStatus?.running;
  const progress = scanStatus?.progress;

  // Sort + CRV filter (client-side — data already fetched)
  const sorted = [...candidates]
    .filter(c => !minCrv || (c.crv_calculated != null && c.crv_calculated >= parseFloat(minCrv)))
    .sort((a, b) => {
      if (sortBy === "score")      return (b.composite_score ?? b.confidence) - (a.composite_score ?? a.confidence);
      if (sortBy === "confidence") return b.confidence - a.confidence;
      if (sortBy === "setup")      return (a.setup_type || "").localeCompare(b.setup_type || "");
      if (sortBy === "crv")        return (b.crv_calculated || 0) - (a.crv_calculated || 0);
      return 0;
    });

  return (
    <div className="max-w-7xl mx-auto">
      {/* Filter Profile Panel */}
      {showFilterPanel && (
        <FilterPanel onClose={() => { setShowFilterPanel(false); fetchActiveFilter(); }} />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.setup_type}
            onChange={e => setFilters(f => ({ ...f, setup_type: e.target.value }))}
            className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2"
          >
            <option value="">All setups</option>
            <option value="breakout">Breakout</option>
            <option value="pullback">Pullback</option>
            <option value="pattern">Pattern</option>
            <option value="momentum">Momentum</option>
          </select>
          <select
            value={filters.min_confidence}
            onChange={e => setFilters(f => ({ ...f, min_confidence: e.target.value }))}
            className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2"
          >
            <option value="">Min confidence</option>
            <option value="6">≥ 6</option>
            <option value="7">≥ 7</option>
            <option value="8">≥ 8</option>
            <option value="9">≥ 9</option>
          </select>
          {/* CRV Filter — client-side, no refetch needed */}
          <select
            value={minCrv}
            onChange={e => setMinCrv(e.target.value)}
            className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2"
            title="Min. Chance-Risiko-Verhältnis"
          >
            <option value="">CRV: alle</option>
            <option value="1.5">CRV ≥ 1.5</option>
            <option value="2.0">CRV ≥ 2.0 ✅</option>
            <option value="3.0">CRV ≥ 3.0 🔥</option>
          </select>
          <button
            onClick={() => fetchCandidates(false)}
            className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg"
          >
            Apply
          </button>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2"
          >
            <option value="score">Sort: Score ★</option>
            <option value="confidence">Sort: Confidence</option>
            <option value="crv">Sort: CRV</option>
            <option value="setup">Sort: Setup</option>
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Active filter badge */}
          {activeFilter ? (
            <button
              onClick={() => setShowFilterPanel(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-indigo-500/40 bg-indigo-900/20 text-indigo-300 hover:bg-indigo-900/40 transition"
              title="Aktives Filter-Profile"
            >
              <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
              <span className="font-medium">{activeFilter.name}</span>
              <span className="text-indigo-400/70 text-xs hidden sm:inline">
                RSI {activeFilter.rsi_min}–{activeFilter.rsi_max} · Conf ≥{activeFilter.confidence_min}
              </span>
            </button>
          ) : (
            <button
              onClick={() => setShowFilterPanel(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-500 hover:text-gray-300 transition"
              title="Kein Filter aktiv — Standard wird verwendet"
            >
              <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
              <span className="hidden sm:inline">Kein Filter aktiv</span>
              <span className="sm:hidden">Filter</span>
            </button>
          )}
          <button
            onClick={() => setShowFilterPanel(s => !s)}
            className={`px-3 py-2 text-sm rounded-lg border transition flex items-center gap-1.5 ${
              showFilterPanel
                ? "bg-indigo-900/50 border-indigo-500/50 text-indigo-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
          >
            ⚙ <span className="hidden sm:inline">Filter-Profile</span>
          </button>
          <button
            onClick={() => setShowFunnel(s => !s)}
            className={`px-3 py-2 text-sm rounded-lg border transition flex items-center gap-1.5 ${
              showFunnel
                ? "bg-orange-900/40 border-orange-600/50 text-orange-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
            title="Filter-Funnel-Diagnostics"
          >
            ▽ <span className="hidden sm:inline">Funnel</span>
          </button>
          {lastFetched && (
            <span className="text-xs text-gray-500 hidden sm:inline">Updated {lastFetched.toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => fetchCandidates(false)}
            disabled={refreshing}
            className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {refreshing ? (
              <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : "↻"} <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={triggerScan}
            disabled={isScanning}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            {isScanning ? (
              <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Scanning…</>
            ) : "Scan starten"}
          </button>
        </div>
      </div>

      {/* Funnel Diagnostics */}
      {showFunnel && (
        <div className="mb-4">
          <FunnelDiagnostics initialFunnel={funnel} />
        </div>
      )}

      {/* Progress */}
      {isScanning && <ScanProgress progress={progress} />}

      {/* Stats */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {["breakout", "pullback", "pattern", "momentum"].map((type) => (
          <div key={type} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
            <span className={`w-2 h-2 rounded-full ${SETUP_COLORS[type]}`} />
            <span className="text-gray-400 text-xs capitalize">{type}</span>
            <span className="text-white font-semibold text-xs">{candidates.filter(c => c.setup_type === type).length}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 ml-auto">
          <span className="text-gray-400 text-xs">Total</span>
          <span className="text-white font-semibold text-xs">{candidates.length}</span>
        </div>
      </div>

      {/* Last scan info */}
      {scanStatus?.last_scan && !isScanning && (
        <div className="mb-4 p-3 bg-gray-900 rounded-lg text-xs text-gray-400">
          Last scan: <span className="text-gray-200">{scanStatus.last_scan.scan_date}</span>
          {" "}— {scanStatus.last_scan.saved ?? 0} results, {scanStatus.last_scan.candidates_screened ?? 0} screened
          {scanStatus.last_scan.regime && <span className="ml-2">· regime: {scanStatus.last_scan.regime}</span>}
        </div>
      )}

      {/* Stale data warning */}
      {staleInfo && (
        <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg flex items-center gap-2">
          <span className="text-yellow-400 text-sm">⚠</span>
          <span className="text-yellow-300 text-sm">
            Kein Scan für heute — zeige Kandidaten vom <strong>{staleInfo.stale_date}</strong>
          </span>
          <button
            onClick={triggerScan}
            disabled={isScanning}
            className="ml-auto text-xs px-3 py-1 bg-yellow-700/40 hover:bg-yellow-700/60 text-yellow-200 rounded-lg disabled:opacity-50"
          >
            Jetzt scannen
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {initialLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="bg-gray-900 rounded-xl h-80 animate-pulse" />)}
        </div>
      )}

      {!initialLoading && !error && candidates.length === 0 && (
        <div className="flex flex-col items-center py-16 text-gray-500">
          <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-lg font-medium">Keine Kandidaten für heute</p>
          <p className="text-sm mt-1">Klick auf "Scan starten" um den Tages-Scan zu starten.</p>

          {/* 1.4 — Adaptive hint with module activation */}
          {funnel?.adaptive_hint && (
            <AdaptiveHint hint={funnel.adaptive_hint} onModuleActivated={fetchFunnel} />
          )}

          {/* Funnel summary — helps diagnose which filter is blocking results */}
          {funnel && funnel.status !== "no_funnel" && (
            <div className="mt-4 w-full max-w-2xl">
              <FunnelDiagnostics initialFunnel={funnel} />
            </div>
          )}
        </div>
      )}

      {!initialLoading && sorted.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map((c) => <CandidateCard key={c.id} candidate={c} budget={budget} />)}
        </div>
      )}

      {/* Watchlist Pending — no complete setup, observe only */}
      {watchlistPending.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowWatchlist(w => !w)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-gray-400 hover:text-gray-200 transition"
          >
            <span>
              ⏳ Beobachtungsliste — wartet auf Setup-Signal
              <span className="ml-2 text-xs bg-gray-800 px-2 py-0.5 rounded-full">{watchlistPending.length}</span>
            </span>
            <span className="text-gray-600">{showWatchlist ? "▲" : "▼"}</span>
          </button>

          {showWatchlist && (
            <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
                Diese Kandidaten wurden vom Scanner erkannt, haben aber kein vollständiges Entry/Stop/Target-Setup. Beobachten — kein Trade-Signal.
              </div>
              <div className="divide-y divide-gray-800">
                {watchlistPending.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-white font-semibold text-sm w-16">{c.ticker}</span>
                    {c.strategy_module && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-500">{c.strategy_module}</span>
                    )}
                    <span className="text-xs text-gray-500 flex-1 truncate">
                      {c.strategy_module === "Mean Reversion" && !c.entry_zone
                        ? "Überverkauft, aber kein Setup erkannt — wartet auf Erholungssignal"
                        : c.reasoning || "Kein Setup ableitbar"}
                    </span>
                    <span className="text-[10px] text-yellow-600 shrink-0">Beobachten</span>
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
