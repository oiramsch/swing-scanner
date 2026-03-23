import { useState, useEffect } from "react";
import axios from "axios";

export default function TradeReplayModal({ entry, onClose }) {
  const [chartUrl, setChartUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchChart();
  }, [entry.id]);

  async function fetchChart() {
    setLoading(true);
    try {
      const res = await axios.get(`/api/journal/${entry.id}/replay-chart`, { responseType: "blob" });
      setChartUrl(URL.createObjectURL(res.data));
    } catch (err) {
      setError("Chart not available");
    } finally {
      setLoading(false);
    }
  }

  const pnlPos = (entry.pnl_eur || 0) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full shadow-2xl">
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">{entry.ticker} — Trade Replay</h2>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                <span>Entry: ${entry.entry_price?.toFixed(2)}</span>
                <span>Stop: ${entry.stop_loss?.toFixed(2)}</span>
                {entry.exit_price && <span>Exit: ${entry.exit_price?.toFixed(2)}</span>}
                {entry.pnl_eur !== null && (
                  <span className={`font-bold ${pnlPos ? "text-green-400" : "text-red-400"}`}>
                    {pnlPos ? "+" : ""}€{entry.pnl_eur?.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
          </div>

          {loading && <div className="h-64 bg-gray-800 rounded-xl animate-pulse" />}
          {error && <div className="h-64 flex items-center justify-center text-gray-500">{error}</div>}
          {chartUrl && <img src={chartUrl} alt="Trade replay" className="w-full rounded-xl" />}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="p-3 bg-gray-800 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Setup</div>
              <p className="text-sm text-gray-300">{entry.setup_reason || "—"}</p>
            </div>
            <div className="p-3 bg-indigo-900/20 border border-indigo-800/30 rounded-lg">
              <div className="text-xs text-indigo-400 mb-1">Lesson</div>
              <p className="text-sm text-gray-300">{entry.lesson || "No lesson recorded"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
