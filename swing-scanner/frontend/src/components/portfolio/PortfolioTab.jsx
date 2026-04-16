import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import PositionCard from "./PositionCard.jsx";
import AddPositionModal from "./AddPositionModal.jsx";
import BudgetSettings from "./BudgetSettings.jsx";
import PortfolioAIReport from "./PortfolioAIReport.jsx";
import MarketUpdateBanner from "./MarketUpdateBanner.jsx";
import AlpacaPositions from "./AlpacaPositions.jsx";

const BROKER_ICONS = { alpaca: "🦙", trade_republic: "🇩🇪", ibkr: "📊" };

// Groups manual/TR positions by broker_id (null = "Manuelle Positionen")
function PortfolioByBroker({ positions, onUpdate }) {
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
        const group  = groups[key];
        const broker = key !== "__unassigned__" ? brokerById[key] : null;
        const icon   = broker ? (BROKER_ICONS[broker.broker_type] ?? "💼") : "📋";
        const label  = broker ? broker.label : "Manuelle Positionen";
        const sym    = broker?.balance?.currency === "EUR" ? "€" : "$";
        const bPow   = broker?.balance?.buying_power;
        const count  = group.positions.length;

        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{icon}</span>
              <span className="text-sm font-semibold text-gray-300">{label}</span>
              {bPow != null && (
                <span className="text-xs text-gray-600 ml-1">
                  Konto: {sym}{Math.round(bPow).toLocaleString("de")}
                </span>
              )}
              <span className="text-xs text-gray-700 ml-auto">
                {count} Position{count !== 1 ? "en" : ""}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.positions.map(pos => (
                <PositionCard key={pos.id} position={pos} broker={broker} onUpdate={onUpdate} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, colorClass = "text-white" }) {
  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`font-bold text-lg ${colorClass}`}>{value}</div>
      {sub && <div className="text-gray-500 text-xs">{sub}</div>}
    </div>
  );
}

function BrokerSectionHeader({ icon, label, isPaper, kpis, error }) {
  return (
    <div className="flex items-center gap-2 flex-wrap px-1 mb-2">
      <span className="text-base">{icon}</span>
      <span className="text-sm font-semibold text-gray-300">{label}</span>
      {isPaper && (
        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 rounded font-semibold">
          PAPER
        </span>
      )}
      {error ? (
        <span className="text-xs text-red-400 ml-1">{error}</span>
      ) : kpis ? (
        <div className="flex gap-4 ml-1">
          {kpis.map(k => (
            <span key={k.label} className="text-xs text-gray-500">
              {k.label}: <span className={k.colorClass ?? "text-gray-300"}>{k.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PortfolioTab() {
  const [portfolio, setPortfolio]   = useState(null);
  const [brokers, setBrokers]       = useState([]);
  const [eur2usd, setEur2usd]       = useState(1.09);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [aiReport, setAiReport]     = useState(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [marketUpdate, setMarketUpdate] = useState(null);
  const [lastUpdated, setLastUpdated]   = useState(null);
  const [refreshing, setRefreshing]     = useState(false);
  const intervalRef = useRef(null);

  const fetchBrokers = useCallback(async () => {
    try {
      const res = await axios.get("/api/brokers");
      setBrokers(res.data || []);
    } catch { /* non-critical */ }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await axios.get("/api/portfolio");
      setPortfolio(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    await Promise.all([fetchPortfolio(), fetchBrokers()]);
    setLastUpdated(new Date());
    if (showSpinner) setRefreshing(false);
  }, [fetchPortfolio, fetchBrokers]);

  useEffect(() => {
    refresh();
    // Market update (non-blocking)
    axios.get("/api/portfolio/market-update")
      .then(r => { if (r.data?.status !== "no_update") setMarketUpdate(r.data); })
      .catch(() => {});
    // EUR/USD rate
    axios.get("/api/fx/eurusd")
      .then(r => setEur2usd(r.data?.rate ?? 1.09))
      .catch(() => {});

    intervalRef.current = setInterval(() => refresh(), 60_000);
    return () => clearInterval(intervalRef.current);
  }, []);

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
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-gray-900 h-48 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );

  // ── Alpaca broker from registry ──────────────────────────────────────────
  const alpacaBroker     = brokers.find(b => b.broker_type === "alpaca");
  const alpacaBal        = alpacaBroker?.balance;
  const alpacaPortfolioV = alpacaBal?.portfolio_value ?? 0;
  const alpacaCash       = alpacaBal?.buying_power    ?? 0;  // buying_power is normalized to cash by AlpacaConnector.get_balance()
  const alpacaInvested   = Math.max(0, alpacaPortfolioV - alpacaCash);
  const hasAlpacaBal     = !!alpacaBal;

  // ── Trade Republic / manual portfolio ───────────────────────────────────
  // Exclude Alpaca-managed positions — they are shown via AlpacaPositions below
  const trPositions = (portfolio?.positions ?? []).filter(
    p => !alpacaBroker || p.broker_id !== alpacaBroker.id
  );
  const trBudget    = portfolio?.budget?.start_budget ?? 0;
  const trInvested  = trPositions.reduce((sum, p) => sum + (p.position_value || 0), 0);
  const trAvailable = trBudget - trInvested;
  const trPnl       = portfolio?.closed_pnl ?? 0;

  // ── Consolidated totals (all in EUR) ────────────────────────────────────
  // trInvested is now calculated from filtered trPositions (no Alpaca overlap)
  const totalBudget    = trBudget    + alpacaPortfolioV / eur2usd;
  const totalInvested  = trInvested  + alpacaInvested   / eur2usd;
  const totalAvailable = trAvailable + alpacaCash        / eur2usd;

  const totalSignals = portfolio?.positions?.reduce(
    (sum, p) => sum + (p.signals?.length || 0), 0
  ) || 0;

  const fmt = (n, locale = "de") => Math.round(n).toLocaleString(locale);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Market Update Banner */}
      <MarketUpdateBanner update={marketUpdate} />

      {/* ── CONSOLIDATED OVERVIEW — alle Broker ──────────────────────────── */}
      {portfolio && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-white font-semibold">Portfolio Übersicht — alle Broker</h2>
              {lastUpdated && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Aktualisiert {lastUpdated.toLocaleTimeString()} · auto-refresh alle 60s
                  {hasAlpacaBal && (
                    <span className="ml-2 text-gray-600">
                      · EUR/USD @ {eur2usd.toFixed(2)}
                    </span>
                  )}
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
                {aiLoading && (
                  <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                )}
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
            <KpiCard
              label="Gesamt-Budget"
              value={`€${fmt(totalBudget)}`}
              sub={hasAlpacaBal ? `TR €${fmt(trBudget)} + Alpaca ~€${fmt(alpacaPortfolioV / eur2usd)}` : undefined}
            />
            <KpiCard
              label="Investiert"
              value={`€${fmt(totalInvested)}`}
              sub={hasAlpacaBal && alpacaInvested > 0 ? `TR €${fmt(trInvested)} + Alpaca ~€${fmt(alpacaInvested / eur2usd)}` : undefined}
            />
            <KpiCard
              label="Verfügbar"
              value={`€${fmt(totalAvailable)}`}
              colorClass="text-green-400"
              sub={hasAlpacaBal ? `TR €${fmt(trAvailable)} + Alpaca ~€${fmt(alpacaCash / eur2usd)}` : undefined}
            />
            <KpiCard
              label="Closed P&L"
              value={`${trPnl >= 0 ? "+" : ""}€${trPnl.toFixed(2)}`}
              sub={`${portfolio.win_rate}% win rate`}
              colorClass={trPnl >= 0 ? "text-green-400" : "text-red-400"}
            />
          </div>

          {totalSignals > 0 && (
            <div className="mt-3 flex items-center gap-2 p-2 bg-red-900/20 border border-red-800/30 rounded-lg">
              <span className="text-red-400 text-sm">
                ⚠️ {totalSignals} aktive{totalSignals > 1 ? " Verkaufssignale" : "s Verkaufssignal"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* AI Report */}
      {aiReport && <PortfolioAIReport report={aiReport} onClose={() => setAiReport(null)} />}

      {/* ── TRADE REPUBLIC ABSCHNITT ─────────────────────────────────────── */}
      <div className="space-y-2">
        <BrokerSectionHeader
          icon="🇩🇪"
          label="Trade Republic"
          kpis={[
            { label: "Budget",    value: `€${fmt(trBudget)}` },
            { label: "Investiert", value: `€${fmt(trInvested)}` },
            { label: "Verfügbar", value: `€${fmt(trAvailable)}`, colorClass: "text-green-400" },
          ]}
        />
        <PortfolioByBroker
          positions={trPositions}
          onUpdate={fetchPortfolio}
        />
      </div>

      {/* ── ALPACA ABSCHNITT ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <BrokerSectionHeader
          icon="🦙"
          label="Alpaca"
          isPaper={alpacaBroker?.is_paper ?? true}
          error={!hasAlpacaBal && alpacaBroker?.error ? alpacaBroker.error : null}
          kpis={hasAlpacaBal ? [
            { label: "Budget",    value: `$${fmt(alpacaPortfolioV, "en")}` },
            { label: "Investiert", value: `$${fmt(alpacaInvested, "en")}` },
            { label: "Verfügbar", value: `$${fmt(alpacaCash, "en")}`, colorClass: "text-green-400" },
          ] : null}
        />
        <AlpacaPositions />
      </div>

      {showAdd && (
        <AddPositionModal
          onClose={() => setShowAdd(false)}
          onSaved={fetchPortfolio}
          budget={portfolio?.budget}
        />
      )}
      {showBudget && (
        <BudgetSettings
          budget={portfolio?.budget}
          onClose={() => setShowBudget(false)}
          onSaved={fetchPortfolio}
        />
      )}
    </div>
  );
}
