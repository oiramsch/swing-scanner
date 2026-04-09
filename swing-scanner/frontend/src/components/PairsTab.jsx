import { useState, useEffect } from "react";
import axios from "axios";

const PAIRS_META = [
  { name: "XLU/XLK", long: "XLU", short: "XLK", label: "Defensiv vs. Wachstum" },
  { name: "XLV/XLY", long: "XLV", short: "XLY", label: "Healthcare vs. Consumer" },
  { name: "GLD/SPY", long: "GLD", short: "SPY", label: "Safe Haven vs. Markt" },
  { name: "TLT/QQQ", long: "TLT", short: "QQQ", label: "Anleihen vs. Nasdaq" },
];

function ZScoreBadge({ zscore }) {
  if (zscore === null || zscore === undefined) {
    return <span className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400">–</span>;
  }
  const abs = Math.abs(zscore);
  if (abs >= 2.0) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-900/60 text-red-300 border border-red-700">
        🔴 {zscore.toFixed(2)}
      </span>
    );
  }
  if (abs >= 1.5) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-900/60 text-yellow-300 border border-yellow-700">
        🟡 {zscore.toFixed(2)}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-900/60 text-green-300 border border-green-700">
      🟢 {zscore.toFixed(2)}
    </span>
  );
}

function DirectionBadge({ direction }) {
  if (!direction) return null;
  const isLong = direction === "long_spread";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
      isLong
        ? "bg-emerald-900/50 text-emerald-300 border border-emerald-700"
        : "bg-rose-900/50 text-rose-300 border border-rose-700"
    }`}>
      {isLong ? "▲ Long Spread" : "▼ Short Spread"}
    </span>
  );
}

function StatusBadge({ status }) {
  const colors = {
    active:  "bg-indigo-900/50 text-indigo-300 border-indigo-700",
    closed:  "bg-gray-800 text-gray-400 border-gray-700",
    expired: "bg-orange-900/50 text-orange-300 border-orange-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs border ${colors[status] ?? colors.active}`}>
      {status}
    </span>
  );
}

export default function PairsTab() {
  const [activeSignals, setActiveSignals]   = useState([]);
  const [history, setHistory]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [scanning, setScanning]             = useState(false);
  const [error, setError]                   = useState(null);
  const [tab, setTab]                       = useState("active");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [activeRes, histRes] = await Promise.all([
        axios.get("/api/pairs"),
        axios.get("/api/pairs/history"),
      ]);
      setActiveSignals(activeRes.data);
      setHistory(histRes.data);
    } catch (e) {
      setError("Fehler beim Laden der Pair-Signale.");
    } finally {
      setLoading(false);
    }
  }

  async function triggerScan() {
    setScanning(true);
    try {
      await axios.post("/api/pairs/scan");
      setTimeout(loadData, 3000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setScanning(false), 3500);
    }
  }

  // Build a Z-Score map from active signals for the pair overview table
  const zscoreByPair = {};
  for (const sig of activeSignals) {
    zscoreByPair[sig.pair_name] = sig.zscore;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-100">Pair Trading — Markt-neutral Z-Score</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Signal wenn |Z-Score| &gt; 2.0 (Spread kehrt statistisch zur Mitte zurück)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded transition"
          >
            {scanning ? "Scanning…" : "Jetzt scannen"}
          </button>
          <button
            onClick={loadData}
            className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm bg-red-950/60 border border-red-800 rounded text-red-300">
          {error}
        </div>
      )}

      {/* Pair Overview Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">Die 4 Pairs — Aktueller Status</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="text-left px-4 py-2">Pair</th>
                <th className="text-left px-4 py-2">Long / Short</th>
                <th className="text-left px-4 py-2">Logik</th>
                <th className="text-left px-4 py-2">Z-Score (heute)</th>
                <th className="text-left px-4 py-2">Signal</th>
              </tr>
            </thead>
            <tbody>
              {PAIRS_META.map((pair) => {
                const zscore = zscoreByPair[pair.name];
                const signal = activeSignals.find((s) => s.pair_name === pair.name);
                return (
                  <tr key={pair.name} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-mono font-bold text-gray-200">{pair.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-emerald-400">{pair.long}</span>
                      <span className="text-gray-600 mx-1">/</span>
                      <span className="text-rose-400">{pair.short}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{pair.label}</td>
                    <td className="px-4 py-3">
                      {loading ? (
                        <span className="text-gray-600">…</span>
                      ) : (
                        <ZScoreBadge zscore={zscore !== undefined ? zscore : null} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {signal ? (
                        <DirectionBadge direction={signal.direction} />
                      ) : (
                        <span className="text-gray-600 text-xs">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
        <span>🟢 Neutral (|Z| &lt; 1.5)</span>
        <span>🟡 Erhöht (1.5 ≤ |Z| &lt; 2.0)</span>
        <span>🔴 Signal (|Z| ≥ 2.0)</span>
      </div>

      {/* Tab Switcher: Aktive Signale / Historie */}
      <div className="flex gap-1 border-b border-gray-800 mb-0">
        {["active", "history"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "active" ? `Aktive Signale (${activeSignals.length})` : `Alle Signale (${history.length})`}
          </button>
        ))}
      </div>

      {/* Signal List */}
      {tab === "active" && (
        <SignalTable signals={activeSignals} loading={loading} emptyText="Keine aktiven Pair-Signale" />
      )}
      {tab === "history" && (
        <SignalTable signals={history} loading={loading} emptyText="Keine historischen Signale" />
      )}
    </div>
  );
}

function SignalTable({ signals, loading, emptyText }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-600 text-sm">
        Lade…
      </div>
    );
  }
  if (!signals.length) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-600 text-sm">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left px-4 py-2">Datum</th>
              <th className="text-left px-4 py-2">Pair</th>
              <th className="text-left px-4 py-2">Z-Score</th>
              <th className="text-left px-4 py-2">Richtung</th>
              <th className="text-left px-4 py-2">Long</th>
              <th className="text-left px-4 py-2">Short</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((sig) => (
              <tr key={sig.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                <td className="px-4 py-2.5 text-gray-400 font-mono">{sig.scan_date}</td>
                <td className="px-4 py-2.5 font-mono font-bold text-gray-200">{sig.pair_name}</td>
                <td className="px-4 py-2.5"><ZScoreBadge zscore={sig.zscore} /></td>
                <td className="px-4 py-2.5"><DirectionBadge direction={sig.direction} /></td>
                <td className="px-4 py-2.5 text-emerald-400 font-mono">{sig.long_ticker}</td>
                <td className="px-4 py-2.5 text-rose-400 font-mono">{sig.short_ticker}</td>
                <td className="px-4 py-2.5"><StatusBadge status={sig.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
