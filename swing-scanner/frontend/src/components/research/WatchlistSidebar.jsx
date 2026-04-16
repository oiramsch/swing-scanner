/**
 * WatchlistSidebar — Watchlist-Einträge als kompakte Liste.
 * Ticker-Klick lädt den Chart in ResearchTab.
 * "+ Hinzufügen" fügt den aktuell gesuchten Ticker hinzu.
 */
import { useState, useEffect } from "react";
import axios from "axios";

function RsiBadge({ rsi }) {
  if (rsi == null) return <span className="text-gray-700">—</span>;
  const color = rsi >= 70 ? "text-red-400" : rsi <= 30 ? "text-green-400" : "text-gray-400";
  return <span className={`font-mono text-[10px] ${color}`}>{rsi.toFixed(0)}</span>;
}

export default function WatchlistSidebar({ activeTicker, onSelect }) {
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadErr,    setLoadErr]    = useState(false);
  const [adding,     setAdding]     = useState(false);
  const [candidates, setCandidates] = useState([]);

  async function load() {
    setLoadErr(false);
    try {
      const res = await axios.get("/api/watchlist");
      setItems(res.data);
    } catch (err) {
      console.error("Watchlist laden fehlgeschlagen", err);
      setLoadErr(true);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    axios.get("/api/candidates")
      .then(res => {
        const active = (res.data || [])
          .filter(c => c.candidate_status === "active")
          .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
          .slice(0, 8);
        setCandidates(active);
      })
      .catch(() => {});
  }, []);

  async function handleAdd() {
    if (!activeTicker) return;
    setAdding(true);
    try {
      await axios.post("/api/watchlist", {
        ticker: activeTicker,
        reason: "Research",
        alert_condition: "none",
      });
      await load();
    } catch (err) {
      console.error("Watchlist hinzufügen fehlgeschlagen", err);
    }
    setAdding(false);
  }

  async function handleRemove(e, id) {
    e.stopPropagation();
    try {
      await axios.delete(`/api/watchlist/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      console.error("Watchlist entfernen fehlgeschlagen", err);
    }
  }

  const alreadyInList = activeTicker && items.some(i => i.ticker === activeTicker);

  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden self-start sticky top-4">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Watchlist</span>
        {activeTicker && !alreadyInList && (
          <button
            onClick={handleAdd}
            disabled={adding}
            title={`${activeTicker} zur Watchlist hinzufügen`}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-700/50 hover:bg-indigo-600/60 border border-indigo-600/50 text-indigo-300 disabled:opacity-50 transition"
          >
            {adding ? "…" : `+ ${activeTicker}`}
          </button>
        )}
        {activeTicker && alreadyInList && (
          <span className="text-[10px] text-indigo-400/60">bereits drin</span>
        )}
      </div>

      {/* Items */}
      <div className="overflow-y-auto flex-1 max-h-[calc(100vh-180px)]">
        {loading && (
          <div className="px-3 py-4 text-xs text-gray-600 text-center">Lädt…</div>
        )}
        {!loading && loadErr && (
          <div className="px-3 py-4 text-xs text-red-400/70 text-center">Watchlist konnte nicht geladen werden.</div>
        )}
        {!loading && !loadErr && items.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-700 text-center">
            Watchlist ist leer.<br />
            {activeTicker
              ? <span className="text-gray-600">Klicke "+ {activeTicker}" um hinzuzufügen.</span>
              : <span className="text-gray-600">Ticker suchen und hinzufügen.</span>
            }
          </div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => onSelect(item.ticker)}
            className={`group flex items-start justify-between gap-2 px-3 py-2 border-b border-gray-800/60 last:border-0 cursor-pointer transition ${
              item.ticker === activeTicker
                ? "bg-indigo-900/20"
                : "hover:bg-gray-800/40"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-white text-xs font-semibold">{item.ticker}</span>
                {item.condition_met && (
                  <span className="text-[9px] px-1 py-0 rounded bg-green-900/40 border border-green-700/40 text-green-400">Alert</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {item.current_price != null && (
                  <span className="text-[11px] text-gray-300">${item.current_price.toFixed(2)}</span>
                )}
                <RsiBadge rsi={item.current_rsi} />
              </div>
              {item.reason && (
                <div className="text-[10px] text-gray-600 mt-0.5 truncate">{item.reason}</div>
              )}
            </div>
            {/* Remove button */}
            <button
              onClick={e => handleRemove(e, item.id)}
              className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs p-0.5 transition flex-shrink-0 mt-0.5"
              title="Aus Watchlist entfernen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Scanner-Kandidaten */}
      {candidates.length > 0 && (
        <div className="border-t border-gray-800 flex-shrink-0">
          <div className="px-3 py-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
            Scanner heute
          </div>
          <div className="overflow-y-auto max-h-[280px]">
            {candidates.map(c => (
              <div
                key={c.id}
                onClick={() => onSelect(c.ticker)}
                className={`flex items-center justify-between px-3 py-1.5 border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition ${
                  c.ticker === activeTicker ? "bg-indigo-900/20" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-white">{c.ticker}</span>
                  <span className="text-[10px] text-gray-600 ml-1.5 truncate">{c.setup_type}</span>
                </div>
                {c.crv_calculated != null && (
                  <span className={`text-[10px] font-semibold flex-shrink-0 ${
                    c.crv_calculated >= 2 ? "text-green-400" : "text-yellow-400"
                  }`}>
                    {c.crv_calculated.toFixed(1)}x
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
