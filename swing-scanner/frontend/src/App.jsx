import { useState, useEffect, useRef } from "react";
import axios from "axios";
import ScannerTab from "./components/scanner/Dashboard.jsx";
import PortfolioTab from "./components/portfolio/PortfolioTab.jsx";
import JournalTab from "./components/journal/JournalTab.jsx";
import WatchlistTab from "./components/watchlist/WatchlistTab.jsx";
import HistoryTab from "./components/history/HistoryTab.jsx";
import PerformanceTab from "./components/performance/PerformanceTab.jsx";

const TABS = [
  { id: "scanner", label: "Scanner" },
  { id: "portfolio", label: "Portfolio" },
  { id: "journal", label: "Journal" },
  { id: "watchlist", label: "Watchlist" },
  { id: "history", label: "History" },
  { id: "performance", label: "Performance" },
];

const REGIME_COLORS = {
  bull: "bg-green-900/60 text-green-300 border-green-700",
  bear: "bg-red-900/60 text-red-300 border-red-700",
  neutral: "bg-yellow-900/60 text-yellow-300 border-yellow-700",
};
const REGIME_ICONS = { bull: "📈", bear: "📉", neutral: "➡️" };

export default function App() {
  const [activeTab, setActiveTab] = useState("scanner");
  const [regime, setRegime] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    fetchRegime();
    fetchScanStatus();
  }, []);

  async function fetchRegime() {
    try {
      const res = await axios.get("/api/market-regime");
      setRegime(res.data);
    } catch {}
  }

  async function fetchScanStatus() {
    try {
      const res = await axios.get("/api/scan/status");
      setScanStatus(res.data);
      return res.data;
    } catch {
      return null;
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const status = await fetchScanStatus();
      if (status && !status.running) stopPolling();
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Global Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        {/* Market Regime Banner */}
        {regime?.regime && (
          <div className={`px-4 py-1 text-xs font-medium border-b flex items-center gap-2 ${REGIME_COLORS[regime.regime] || REGIME_COLORS.neutral}`}>
            <span>{REGIME_ICONS[regime.regime]}</span>
            <span>Market Regime: <strong>{regime.regime?.toUpperCase()}</strong></span>
            {regime.spy_close && (
              <span className="opacity-70 ml-2">
                SPY ${regime.spy_close?.toFixed(2)} · SMA50 ${regime.spy_sma50?.toFixed(2)} · SMA200 ${regime.spy_sma200?.toFixed(2)}
              </span>
            )}
            {regime.date && (
              <span className="ml-auto opacity-60">Updated: {regime.date}</span>
            )}
          </div>
        )}
        {/* Tab Navigation */}
        <div className="flex items-center px-4">
          <span className="text-white font-bold mr-6 py-3 text-sm">Swing Scanner</span>
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-indigo-500 text-indigo-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Tab Content */}
      <main className="p-4">
        {activeTab === "scanner" && (
          <ScannerTab
            scanStatus={scanStatus}
            onScanStatusChange={setScanStatus}
            onScanStart={startPolling}
          />
        )}
        {activeTab === "portfolio" && <PortfolioTab />}
        {activeTab === "journal" && <JournalTab />}
        {activeTab === "watchlist" && <WatchlistTab />}
        {activeTab === "history" && <HistoryTab />}
        {activeTab === "performance" && <PerformanceTab />}
      </main>
    </div>
  );
}
