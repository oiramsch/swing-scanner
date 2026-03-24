import { useState, useEffect } from "react";
import axios from "axios";

export default function AlpacaPositions() {
  const [positions, setPositions] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [selling, setSelling]     = useState({}); // ticker → true while pending

  useEffect(() => {
    fetchPositions();
  }, []);

  async function fetchPositions() {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/portfolio/alpaca");
      setPositions(res.data);
    } catch (err) {
      const msg = err.response?.data?.detail ?? err.message;
      setError(msg);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSell(pos) {
    if (!window.confirm(`Market-Sell ${pos.qty} × ${pos.ticker} zu aktuellem Kurs bestätigen?`)) return;
    setSelling(s => ({ ...s, [pos.ticker]: true }));
    try {
      await axios.post("/api/orders/sell", { ticker: pos.ticker, qty: pos.qty });
      await fetchPositions();
    } catch (err) {
      alert("Fehler: " + (err.response?.data?.detail ?? err.message));
    } finally {
      setSelling(s => { const n = { ...s }; delete n[pos.ticker]; return n; });
    }
  }

  if (loading) return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-24" />
  );

  // No broker credentials configured → silently hide section
  if (error && (error.includes("No broker") || error.includes("not configured"))) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-semibold text-sm">Alpaca Positionen</h2>
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 rounded font-semibold">
            PAPER
          </span>
        </div>
        <button
          onClick={fetchPositions}
          className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded"
          title="Aktualisieren"
        >
          ↻
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs">{error}</p>
      )}

      {!error && positions?.length === 0 && (
        <p className="text-gray-500 text-sm">Keine offenen Positionen bei Alpaca.</p>
      )}

      {positions?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 pr-3">Ticker</th>
                <th className="text-right pr-3">Qty</th>
                <th className="text-right pr-3">Ø Einstieg</th>
                <th className="text-right pr-3">Aktuell</th>
                <th className="text-right pr-3">Market Value</th>
                <th className="text-right pr-3">P&L</th>
                <th className="text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const plPct  = pos.unrealized_plpc != null ? (pos.unrealized_plpc * 100) : null;
                const plAbs  = pos.unrealized_pl;
                const isPos  = (plAbs ?? 0) >= 0;
                return (
                  <tr key={pos.ticker} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2 pr-3 font-semibold text-white">{pos.ticker}</td>
                    <td className="text-right pr-3 text-gray-300">{pos.qty}</td>
                    <td className="text-right pr-3 text-gray-300">${pos.avg_entry_price?.toFixed(2)}</td>
                    <td className="text-right pr-3 text-gray-300">
                      {pos.current_price != null ? `$${pos.current_price.toFixed(2)}` : "—"}
                    </td>
                    <td className="text-right pr-3 text-gray-300">
                      {pos.market_value != null ? `$${pos.market_value.toFixed(2)}` : "—"}
                    </td>
                    <td className={`text-right pr-3 font-medium ${isPos ? "text-green-400" : "text-red-400"}`}>
                      {plAbs != null ? `${isPos ? "+" : ""}$${plAbs.toFixed(2)}` : "—"}
                      {plPct != null && (
                        <span className="ml-1 text-[10px] opacity-70">
                          ({isPos ? "+" : ""}{plPct.toFixed(2)}%)
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => handleSell(pos)}
                        disabled={!!selling[pos.ticker]}
                        className="px-2 py-1 text-[10px] bg-red-700/30 hover:bg-red-700/60 text-red-300 border border-red-700/40 rounded disabled:opacity-50 transition"
                      >
                        {selling[pos.ticker] ? (
                          <span className="inline-block w-2.5 h-2.5 border border-red-300 border-t-transparent rounded-full animate-spin" />
                        ) : "Sell"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
