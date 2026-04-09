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
import DealCockpit from "./components/trading/DealCockpit.jsx";
import ResearchTab from "./components/research/ResearchTab.jsx";
import ChatTab from "./components/chat/ChatTab.jsx";
import GhostPortfolioTab from "./components/ghost/GhostPortfolioTab.jsx";
import PairsTab from "./components/PairsTab.jsx";

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
  { id: "ghost", label: "👻 Ghost" },
  { id: "pairs", label: "Pairs" },
  { id: "research", label: "Research" },
  { id: "chat", label: "AI Chat" },
  { id: "deals", label: "Deals" },
  { id: "cockpit", label: "Cockpit" },
  { id: "settings", label: "Einstellungen" },
];

// ---------------------------------------------------------------------------
// US Market Clock (DST-aware)
// ---------------------------------------------------------------------------
function getMarketInfo() {
  const now = new Date();
  const yr = now.getUTCFullYear();

  // US DST: 2nd Sunday of March (2 AM ET = 7 AM UTC) → 1st Sunday of November (2 AM ET = 6 AM UTC)
  const march1Day = new Date(Date.UTC(yr, 2, 1)).getUTCDay();
  const dstStartDay = 1 + ((7 - march1Day) % 7) + 7; // 2nd Sunday of March
  const dstStartUTC = new Date(Date.UTC(yr, 2, dstStartDay, 7, 0, 0));

  const nov1Day = new Date(Date.UTC(yr, 10, 1)).getUTCDay();
  const dstEndDay = 1 + ((7 - nov1Day) % 7);          // 1st Sunday of November
  const dstEndUTC = new Date(Date.UTC(yr, 10, dstEndDay, 6, 0, 0));

  const isEDT = now >= dstStartUTC && now < dstEndUTC;
  const utcOffset = isEDT ? 4 : 5; // hours to add to ET to get UTC

  // Current time in ET
  const etNow = new Date(now.getTime() - utcOffset * 3600000);
  const etDay  = etNow.getUTCDay();
  const etMins = etNow.getUTCHours() * 60 + etNow.getUTCMinutes();

  const OPEN  = 9 * 60 + 30;  // 09:30 ET
  const CLOSE = 16 * 60;       // 16:00 ET

  // Open/close as UTC Date objects (for today's ET date)
  const [ey, em, ed] = [etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate()];
  const openUTC  = new Date(Date.UTC(ey, em, ed, 9  + utcOffset, 30, 0));
  const closeUTC = new Date(Date.UTC(ey, em, ed, 16 + utcOffset, 0,  0));

  const fmt = d => d.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit" });

  const isWeekday = etDay >= 1 && etDay <= 5;
  const isOpen    = isWeekday && etMins >= OPEN && etMins < CLOSE;

  let nextLabel = null, minsUntil = null;
  if (isWeekday) {
    if (etMins < OPEN)        { nextLabel = "Öffnet";     minsUntil = Math.round((openUTC  - now) / 60000); }
    else if (etMins < CLOSE)  { nextLabel = "Schließt";   minsUntil = Math.round((closeUTC - now) / 60000); }
  }

  return { isOpen, isWeekday, openTime: fmt(openUTC), closeTime: fmt(closeUTC), nextLabel, minsUntil };
}

function MarketClock() {
  const [info, setInfo] = useState(() => getMarketInfo());
  useEffect(() => {
    const t = setInterval(() => setInfo(getMarketInfo()), 30000);
    return () => clearInterval(t);
  }, []);

  const { isOpen, isWeekday, openTime, closeTime, nextLabel, minsUntil } = info;
  const hrs  = minsUntil != null ? Math.floor(minsUntil / 60) : null;
  const mins = minsUntil != null ? minsUntil % 60 : null;
  const countdown = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  return (
    <div className="flex items-center gap-1.5 text-[10px] shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
      <span className={isOpen ? "text-green-400 font-semibold" : "text-gray-500"}>
        {isOpen ? "Markt offen" : isWeekday ? "Markt geschlossen" : "Kein Handel"}
      </span>
      <span className="text-gray-700">·</span>
      <span className="text-gray-600">{openTime}–{closeTime}</span>
      {nextLabel && minsUntil > 0 && (
        <span className="text-gray-600">· {nextLabel} in {countdown}</span>
      )}
    </div>
  );
}

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
  const [aiHealth, setAiHealth] = useState(null);
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
    fetchAiHealth();
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
      // Poll until freshly updated (age_hours < 1) or max 30s
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await axios.get("/api/market-regime");
        setRegime(res.data);
        if (res.data.age_hours != null && res.data.age_hours < 1) break;
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

  async function fetchAiHealth() {
    try {
      const res = await axios.get("/api/health/ai");
      setAiHealth(res.data);
    } catch {}
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
        {/* Claude API Error Banner */}
        {aiHealth && !aiHealth.ok && (
          <div className="px-4 py-1.5 text-xs bg-red-950/80 border-b border-red-800/60 flex items-center gap-2">
            <span className="text-red-400 font-semibold">Claude API</span>
            <span className="text-red-300/80 truncate flex-1">{aiHealth.error}</span>
            <button
              onClick={() => setActiveTab("settings")}
              className="shrink-0 px-2 py-0.5 rounded bg-red-900/60 hover:bg-red-900 border border-red-700/50 text-red-300 transition text-[11px]"
            >
              Key einrichten →
            </button>
          </div>
        )}
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
        {/* Scan Missing Banner */}
        {scanStatus?.scan_missing && (
          <div className="px-4 py-1.5 text-xs bg-orange-950/80 border-b border-orange-800/60 flex items-center gap-2">
            <span className="text-orange-400 font-semibold">⚠️ Scan ausgefallen</span>
            <span className="text-orange-300/80">
              Letzter Scan vor {scanStatus.hours_since_last_scan}h — Scan möglicherweise ausgefallen
            </span>
          </div>
        )}
        {/* Tab Navigation */}
        <div className="flex items-center px-4 min-w-0 gap-2">
          <span className="text-white font-bold mr-2 py-3 text-sm shrink-0 hidden sm:block">Swing Scanner</span>
          <nav className="flex gap-1 overflow-x-auto scrollbar-none min-w-0 flex-1">
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
          <MarketClock />
          <button
            onClick={handleLogout}
            className="shrink-0 text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded border border-gray-700 transition"
            title={`Abmelden (${currentUser?.email})`}
          >
            ⏻
          </button>
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
        {activeTab === "ghost" && <GhostPortfolioTab />}
        {activeTab === "pairs" && <PairsTab />}
        {activeTab === "research" && <ResearchTab />}
        {activeTab === "chat" && <ChatTab />}
        {activeTab === "deals" && <DealCockpit />}
        {activeTab === "cockpit" && <TradingCockpit setActiveTab={setActiveTab} />}
        {activeTab === "settings" && <SettingsTab currentUser={currentUser} onLogout={handleLogout} />}
      </main>
    </div>
  );
}
