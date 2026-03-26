import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import PositionCard from "./PositionCard.jsx";
import AddPositionModal from "./AddPositionModal.jsx";
import BudgetSettings from "./BudgetSettings.jsx";
import PortfolioAIReport from "./PortfolioAIReport.jsx";
import MarketUpdateBanner from "./MarketUpdateBanner.jsx";
import AlpacaPositions from "./AlpacaPositions.jsx";

const BROKER_ICONS  = { alpaca: "🦙", trade_republic: "🇩🇪", ibkr: "📊" };
const BROKER_LABELS = { alpaca: "Alpaca", trade_republic: "Trade Republic", ibkr: "IBKR" };

function ConsolidatedSummary({ brokers }) {
  if (!brokers?.length) return null;

  // Sum all broker balances, convert EUR→USD at ~1.09 for display
  const EUR_TO_USD = 1.09;
  let totalUSD = 0;
  let hasData = false;
  const lines = [];

  for (const b of brokers) {
    const bal = b.balance?.buying_power ?? b.manual_balance;
    if (bal == null) continue;
    const currency = b.balance?.currency ?? b.manual_currency ?? "USD";
    const inUSD = currency === "EUR" ? bal * EUR_TO_USD : bal;
    totalUSD += inUSD;
    hasData = true;
    lines.push({ label: b.label, amount: bal, currency, icon: BROKER_ICONS[b.broker_type] ?? "💼" });
  }

  if (!hasData || lines.length < 2) return null;

  return (
    <div className="bg-gray-900 border border-indigo-800/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-200">Konsolidiert — alle Broker</span>
        <span className="text-lg font-bold text-indigo-300">${totalUSD.toLocaleString("en", { maximumFractionDigits: 0 })}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {lines.map(l => (
          <div key={l.label} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>{l.icon}</span>
            <span>{l.label}</span>
            <span className="text-gray-300 font-medium">
              {l.currency === "EUR" ? "€" : "$"}{Math.round(l.amount).toLocaleString("de")}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-700 mt-2">EUR→USD @ ~1.09 (Schätzung für Gesamtansicht)</p>
    </div>
  );
}

function PortfolioByBroker({ positions, onUpdate }) {
  // Group positions by broker_id (null = unassigned / legacy)
  const groups = {};
  for (const pos of positions) {
    const key = pos.broker_id != null ? String(pos.broker_id) : "__unassigned__";
    if (!groups[key]) groups[key] = { brokerId: pos.broker_id, positions: [] };
    groups[key].positions.push(pos);
  }

  const [brokers, setBrokers] = useState([]);
  useEffect(() => {
    axios.get("/api/brokers").then(r => setBrokers(r.data || [])).catch(() => {});
  }, []);

  const brokerById = Object.fromEntries(brokers.map(b => [String(b.id), b]));

  const keys = Object.keys(groups);
  if (keys.length === 0) {
    return (
      <div className="text-center py-10 text-gray-600 text-sm bg-gray-900/50 border border-gray-800 rounded-xl">
        Keine offenen Positionen — über "+ Position" oder "Ausgeführt ✓" in TR hinzufügen
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {keys.map(key => {
        const group = groups[key];
        const broker = key !== "__unassigned__" ? brokerById[key] : null;
        const icon   = broker ? (BROKER_ICONS[broker.broker_type] ?? "💼") : "📋";
        const label  = broker ? broker.label : "Ghost Portfolio";
        const sym    = broker?.balance?.currency === "EUR" ? "€" : "$";
        const bPow   = broker?.balance?.buying_power;
        const count  = group.positions.length;

        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{icon}</span>
              <span className="text-sm font-semibold text-gray-300">{label}</span>
              {bPow != null && (
                <span className="text-xs text-gray-600 ml-1">Konto: {sym}{Math.round(bPow).toLocaleString("de")}</span>
              )}
              <span className="text-xs text-gray-700 ml-auto">{count} Position{count !== 1 ? "en" : ""}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.positions.map(pos => (
                <PositionCard key={pos.id} position={pos} onUpdate={onUpdate} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PortfolioTab() {
  const [portfolio, setPortfolio] = useState(null);
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [aiReport, setAiReport] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [marketUpdate, setMarketUpdate] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    await fetchPortfolio();
    setLastUpdated(new Date());
    if (showSpinner) setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
    fetchMarketUpdate();
    axios.get("/api/brokers").then(r => setBrokers(r.data || [])).catch(() => {});
    // Auto-refresh every 60 seconds for live P&L
    intervalRef.current = setInterval(() => refresh(), 60_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  async function fetchMarketUpdate() {
    try {
      const res = await axios.get("/api/portfolio/market-update");
      if (res.data?.status !== "no_update") {
        setMarketUpdate(res.data);
      }
    } catch {
      // Market update is optional — don't block the portfolio view
    }
  }

  async function fetchPortfolio() {
    try {
      const res = await axios.get("/api/portfolio");
      setPortfolio(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runAiCheck() {
    setAiLoading(true);
    try {
      const res = await axios.post("/api/portfolio/ai-check");
      setAiReport(res.data);
    } catch (err) {
      setError("AI check failed: " + err.message);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return (
    <div className="max-w-7xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="bg-gray-900 h-48 rounded-xl animate-pulse" />)}
      </div>
    </div>
  );

  const totalSignals = portfolio?.positions?.reduce((sum, p) => sum + (p.signals?.length || 0), 0) || 0;

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {error && <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">{error}</div>}

      {/* Budget summary */}
      {portfolio && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-white font-semibold">Portfolio Overview</h2>
              {lastUpdated && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Updated {lastUpdated.toLocaleTimeString()} · auto-refresh every 60s
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => refresh(true)}
                disabled={refreshing}
                className="text-sm px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                title="Manuell aktualisieren"
              >
                {refreshing
                  ? <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  : "↻"
                }
              </button>
              <button
                onClick={runAiCheck}
                disabled={aiLoading}
                className="text-sm px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
              >
                {aiLoading && <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
                KI Check
              </button>
              <button
                onClick={() => setShowBudget(true)}
                className="text-sm px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg"
              >
                Budget
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="text-sm px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium"
              >
                + Position
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-gray-400 text-xs">Budget</div>
              <div className="text-white font-bold text-lg">€{portfolio.budget?.start_budget?.toLocaleString()}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-gray-400 text-xs">Invested</div>
              <div className="text-white font-bold text-lg">€{portfolio.total_invested?.toLocaleString()}</div>
              <div className="text-gray-500 text-xs">{portfolio.invested_pct}%</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-gray-400 text-xs">Available</div>
              <div className="text-green-400 font-bold text-lg">€{portfolio.available_capital?.toLocaleString()}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-gray-400 text-xs">Closed P&L</div>
              <div className={`font-bold text-lg ${(portfolio.closed_pnl || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {(portfolio.closed_pnl || 0) >= 0 ? "+" : ""}€{portfolio.closed_pnl?.toFixed(2)}
              </div>
              <div className="text-gray-500 text-xs">{portfolio.win_rate}% win rate</div>
            </div>
          </div>

          {totalSignals > 0 && (
            <div className="mt-3 flex items-center gap-2 p-2 bg-red-900/20 border border-red-800/30 rounded-lg">
              <span className="text-red-400 text-sm">⚠️ {totalSignals} active sell signal{totalSignals > 1 ? "s" : ""}</span>
            </div>
          )}
        </div>
      )}

      {/* Consolidated broker summary */}
      <ConsolidatedSummary brokers={brokers} />

      {/* AI Report */}
      {aiReport && <PortfolioAIReport report={aiReport} onClose={() => setAiReport(null)} />}

      {/* Market Update Banner */}
      <MarketUpdateBanner update={marketUpdate} />

      {/* Per-Broker Position Sections */}
      <PortfolioByBroker positions={portfolio?.positions ?? []} onUpdate={fetchPortfolio} />

      {/* Alpaca Live Positions */}
      <AlpacaPositions />

      {showAdd && <AddPositionModal onClose={() => setShowAdd(false)} onSaved={fetchPortfolio} budget={portfolio?.budget} />}
      {showBudget && <BudgetSettings budget={portfolio?.budget} onClose={() => setShowBudget(false)} onSaved={fetchPortfolio} />}
    </div>
  );
}
