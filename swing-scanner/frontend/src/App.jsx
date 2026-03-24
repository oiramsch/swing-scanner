import { useState, useEffect, useRef } from "react";
import axios from "axios";
import ScannerTab from "./components/scanner/Dashboard.jsx";
import PortfolioTab from "./components/portfolio/PortfolioTab.jsx";
import JournalTab from "./components/journal/JournalTab.jsx";
import WatchlistTab from "./components/watchlist/WatchlistTab.jsx";
import HistoryTab from "./components/history/HistoryTab.jsx";
import PerformanceTab from "./components/performance/PerformanceTab.jsx";
import LoginPage from "./components/auth/LoginPage.jsx";
import SettingsTab from "./components/settings/SettingsTab.jsx";
import TradingCockpit from "./components/trading/TradingCockpit.jsx";

// Restore token from localStorage on startup
const storedToken = localStorage.getItem("auth_token");
if (storedToken) {
  axios.defaults.headers.common["Authorization"] = `Bearer ${storedToken}`;
}

const TABS = [
  { id: "scanner", label: "Scanner" },
  { id: "portfolio", label: "Portfolio" },
  { id: "journal", label: "Journal" },
  { id: "watchlist", label: "Watchlist" },
  { id: "history", label: "History" },
  { id: "performance", label: "Performance" },
  { id: "cockpit", label: "Cockpit" },
  { id: "settings", label: "Einstellungen" },
];

const REGIME_COLORS = {
  bull:    "bg-green-900/60 text-green-300 border-green-700",
  bear:    "bg-red-900/60 text-red-300 border-red-700",
  neutral: "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  unknown: "bg-gray-800/60 text-gray-400 border-gray-700",
};
const REGIME_ICONS = { bull: "📈", bear: "📉", neutral: "➡️", unknown: "❓" };

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState("scanner");
  const [regime, setRegime] = useState(null);
  const [regimeRefreshing, setRegimeRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    // Validate stored token on startup
    if (localStorage.getItem("auth_token")) {
      axios.get("/api/auth/me")
        .then(res => setCurrentUser(res.data))
        .catch(() => {
          localStorage.removeItem("auth_token");
          delete axios.defaults.headers.common["Authorization"];
        })
        .finally(() => setCheckingAuth(false));
    } else {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchRegime();
    fetchScanStatus();
  }, [currentUser]);

  function handleLogin(data) {
    setCurrentUser(data);
  }

  function handleLogout() {
    localStorage.removeItem("auth_token");
    delete axios.defaults.headers.common["Authorization"];
    setCurrentUser(null);
    setRegime(null);
    setScanStatus(null);
  }

  async function fetchRegime() {
    try {
      const res = await axios.get("/api/market-regime");
      setRegime(res.data);
    } catch {}
  }

  async function refreshRegime() {
    setRegimeRefreshing(true);
    try {
      await axios.post("/api/market-regime/update");
      // Poll until updated (max ~30s)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await axios.get("/api/market-regime");
        setRegime(res.data);
        if (!res.data.stale) break;
      }
    } catch {}
    setRegimeRefreshing(false);
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

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Global Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        {/* Market Regime Banner */}
        {regime && (
          <div className={`px-4 py-1 text-xs font-medium border-b flex items-center gap-2 flex-wrap ${REGIME_COLORS[regime.regime] ?? REGIME_COLORS.unknown}`}>
            <span>{REGIME_ICONS[regime.regime] ?? "❓"}</span>
            <span>Market Regime: <strong>{(regime.regime ?? "unknown").toUpperCase()}</strong></span>
            {regime.stale && (
              <span className="bg-orange-900/40 text-orange-300 border border-orange-700/40 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                ⚠️ VERALTET
              </span>
            )}
            {regime.spy_close && (
              <span className="opacity-70">
                SPY ${regime.spy_close?.toFixed(2)} · SMA50 ${regime.spy_sma50?.toFixed(2)} · SMA200 ${regime.spy_sma200?.toFixed(2)}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2 opacity-70">
              {regime.age_hours != null && (
                <span>
                  {regime.age_hours < 1
                    ? "gerade aktualisiert"
                    : `vor ${Math.round(regime.age_hours)}h`}
                </span>
              )}
              <button
                onClick={refreshRegime}
                disabled={regimeRefreshing}
                className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 transition disabled:opacity-50 text-[10px]"
                title="Regime jetzt aktualisieren"
              >
                {regimeRefreshing ? (
                  <span className="inline-block w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                ) : "↻"}
              </button>
            </span>
          </div>
        )}
        {/* Tab Navigation */}
        <div className="flex items-center px-4 min-w-0">
          <span className="text-white font-bold mr-4 py-3 text-sm shrink-0 hidden sm:block">Swing Scanner</span>
          <nav className="flex gap-1 overflow-x-auto scrollbar-none min-w-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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
        {activeTab === "cockpit" && <TradingCockpit />}
        {activeTab === "settings" && <SettingsTab currentUser={currentUser} onLogout={handleLogout} />}
      </main>
    </div>
  );
}
