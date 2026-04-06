import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import JustageModal from "./JustageModal.jsx";
import { useAlpacaWebSocket } from "../../hooks/useAlpacaWebSocket.js";

// ---------------------------------------------------------------------------
// Market clock helper (DST-aware, US Eastern Time)
// ---------------------------------------------------------------------------
function getMarketInfo() {
  const now = new Date();
  const yr = now.getUTCFullYear();
  const march1Day = new Date(Date.UTC(yr, 2, 1)).getUTCDay();
  const dstStartDay = 1 + ((7 - march1Day) % 7) + 7;
  const dstStartUTC = new Date(Date.UTC(yr, 2, dstStartDay, 7, 0, 0));
  const nov1Day = new Date(Date.UTC(yr, 10, 1)).getUTCDay();
  const dstEndDay = 1 + ((7 - nov1Day) % 7);
  const dstEndUTC = new Date(Date.UTC(yr, 10, dstEndDay, 6, 0, 0));
  const isEDT = now >= dstStartUTC && now < dstEndUTC;
  const utcOffset = isEDT ? 4 : 5;
  const etNow = new Date(now.getTime() - utcOffset * 3600000);
  const etDay  = etNow.getUTCDay();
  const etMins = etNow.getUTCHours() * 60 + etNow.getUTCMinutes();
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  const [ey, em, ed] = [etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate()];
  const openUTC  = new Date(Date.UTC(ey, em, ed, 9  + utcOffset, 30, 0));
  const closeUTC = new Date(Date.UTC(ey, em, ed, 16 + utcOffset, 0,  0));
  const isWeekday = etDay >= 1 && etDay <= 5;
  const isOpen    = isWeekday && etMins >= OPEN && etMins < CLOSE;
  let nextLabel = null, minsUntil = null;
  if (isWeekday) {
    if (etMins < OPEN)       { nextLabel = "Öffnet";   minsUntil = Math.round((openUTC  - now) / 60000); }
    else if (etMins < CLOSE) { nextLabel = "Schließt"; minsUntil = Math.round((closeUTC - now) / 60000); }
  }
  return { isOpen, isWeekday, nextLabel, minsUntil };
}

// ---------------------------------------------------------------------------
// Zone status logic
// ---------------------------------------------------------------------------
function zoneStatus(livePrice, entryLow, entryHigh) {
  if (!livePrice || !entryLow || !entryHigh) return "unknown";
  const low = parseFloat(entryLow);
  const high = parseFloat(entryHigh);
  if (livePrice >= low && livePrice <= high) return "in";
  const pct = (livePrice - low) / low * 100;
  if (pct >= -2 && pct < 0) return "near";
  if (pct < -2) return "below";
  return "above";
}

const ZONE_STYLES = {
  in:      { border: "border-l-green-500",  bg: "bg-green-900/10",  badge: "text-green-400",  label: "🟢 In Kaufzone" },
  near:    { border: "border-l-yellow-500", bg: "bg-yellow-900/10", badge: "text-yellow-400", label: "🟡 Nah dran" },
  below:   { border: "border-l-orange-500", bg: "bg-orange-900/10", badge: "text-orange-400", label: "🟠 Below Zone" },
  above:   { border: "border-l-red-500",    bg: "bg-red-900/10",    badge: "text-red-400",    label: "🔴 Above Zone" },
  unknown: { border: "border-l-gray-700",   bg: "",                 badge: "text-gray-500",   label: "—" },
};

// ---------------------------------------------------------------------------
// Volume badge
// ---------------------------------------------------------------------------
function VolumeBadge({ ratio }) {
  if (!ratio) return null;
  const color = ratio >= 2 ? "text-green-400 border-green-700/40" : ratio >= 1.2 ? "text-blue-400 border-blue-700/40" : "text-gray-500 border-gray-700";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${color}`}>
      Vol {ratio}×
    </span>
  );
}

// ---------------------------------------------------------------------------
// PDT dots indicator
// ---------------------------------------------------------------------------
function PdtBadge({ count }) {
  if (count == null) return null;
  const dots = [0, 1, 2].map(i => (
    <span key={i} className={`inline-block w-2 h-2 rounded-full ${i < count ? "bg-orange-400" : "bg-gray-700"}`} />
  ));
  const warn = count >= 3;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${warn ? "border-red-700/60 bg-red-900/20 text-red-400" : "border-gray-700 bg-gray-800/60 text-gray-400"}`}>
      <span>PDT</span>
      <span className="font-semibold">{count}/3</span>
      <span className="flex gap-0.5 ml-0.5">{dots}</span>
      {warn && <span className="ml-1 font-semibold">⚠️</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan tile
// ---------------------------------------------------------------------------
function PlanTile({ plan, brokers, livePrice, volumeRatio, onExecute }) {
  const status = zoneStatus(livePrice, plan.entry_low, plan.entry_high);
  const { border, bg, badge, label } = ZONE_STYLES[status];

  const crv = plan.target && plan.entry_high && plan.stop_loss
    ? ((plan.target - plan.entry_high) / (plan.entry_high - plan.stop_loss))
    : null;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-l-4 ${border} ${bg} border-b border-gray-800 last:border-b-0 transition`}>
      {/* Left: ticker + module + setup */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold">{plan.ticker}</span>
          {plan.strategy_module && (
            <span className="text-[10px] px-1.5 py-0.5 border border-gray-700 rounded text-gray-500">
              {plan.strategy_module}
            </span>
          )}
          <VolumeBadge ratio={volumeRatio} />
        </div>
        <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
          <span>Entry ${plan.entry_low}–${plan.entry_high}</span>
          <span>SL ${plan.stop_loss}</span>
          {plan.target && <span>TP ${plan.target}</span>}
          {crv != null && (
            <span className={crv >= 2.5 ? "text-green-400" : crv >= 1.5 ? "text-yellow-400" : "text-red-400"}>
              CRV {crv.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Center: live price + zone */}
      <div className="text-right shrink-0 min-w-[80px]">
        {livePrice ? (
          <>
            <div className="text-sm font-semibold text-white">${livePrice.toFixed(2)}</div>
            <div className={`text-[10px] ${badge}`}>{label}</div>
          </>
        ) : (
          <div className="text-xs text-gray-600">—</div>
        )}
      </div>

      {/* Right: execute buttons per broker */}
      <div className="flex gap-1.5 shrink-0">
        {brokers.map(broker => (
          <button
            key={broker.id}
            onClick={() => onExecute(plan, broker)}
            disabled={status === "above"}
            title={status === "above" ? "Preis über Entry-Zone" : `${broker.label} — Ausführen`}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
              status === "in"
                ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                : status === "above"
                ? "opacity-40 cursor-not-allowed bg-gray-800 border-gray-700 text-gray-500"
                : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
            }`}
          >
            {broker.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open orders list (Alpaca only)
// ---------------------------------------------------------------------------
function OpenOrdersSection({ visible }) {
  const [orders,    setOrders]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [cancelling, setCancelling] = useState({});

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible]);

  async function load() {
    setLoading(true);
    try {
      const res = await axios.get("/api/orders");
      setOrders(res.data || []);
    } catch {}
    setLoading(false);
  }

  async function cancel(orderId) {
    setCancelling(c => ({ ...c, [orderId]: true }));
    try {
      await axios.delete(`/api/orders/${orderId}`);
      setOrders(o => o.filter(x => x.id !== orderId));
    } catch (err) {
      alert(err.response?.data?.detail || "Stornierung fehlgeschlagen");
    }
    setCancelling(c => ({ ...c, [orderId]: false }));
  }

  if (!visible) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Offene Orders ({orders.length})</h2>
        <button onClick={load} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition">↻</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-16">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-6 text-xs text-gray-600">Keine offenen Orders</div>
      ) : (
        <div>
          {orders.map(o => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 last:border-b-0 text-sm">
              <span className="font-bold text-white w-16 shrink-0">{o.ticker}</span>
              <span className="text-gray-400">{o.qty} Stk.</span>
              {o.limit_price != null && <span className="text-gray-400">@ ${o.limit_price.toFixed(2)}</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">{o.type}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${o.status === "new" || o.status === "accepted" ? "bg-blue-900/20 border-blue-700/40 text-blue-400" : "bg-gray-800 border-gray-700 text-gray-500"}`}>
                {o.status}
              </span>
              <div className="ml-auto">
                <button
                  onClick={() => cancel(o.id)}
                  disabled={cancelling[o.id]}
                  className="text-xs px-2.5 py-1 bg-red-900/30 hover:bg-red-900/60 border border-red-700/40 text-red-400 rounded transition disabled:opacity-50"
                >
                  {cancelling[o.id] ? "…" : "Stornieren"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const WS_STATUS = {
  live: { dot: "bg-green-400 animate-pulse", text: "text-green-400",  border: "border-green-700/50 bg-green-900/20",   label: "🟢 Live" },
  mock: { dot: "bg-yellow-400",              text: "text-yellow-400", border: "border-yellow-700/50 bg-yellow-900/20", label: "🟡 Mock" },
  off:  { dot: "bg-red-500",                 text: "text-red-400",    border: "border-red-700/50 bg-red-900/20",       label: "🔴 Offline" },
};

export default function TradingCockpit({ setActiveTab }) {
  const [plans,    setPlans]    = useState([]);
  const [brokers,  setBrokers]  = useState([]);
  const [quotes,   setQuotes]   = useState({});
  const [justageTarget, setJustageTarget] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [market,   setMarket]   = useState(getMarketInfo());
  const [lastUpdate, setLastUpdate] = useState(null);
  const pollRef = useRef(null);

  // WebSocket live prices
  const pendingTickers = useMemo(
    () => plans.map(p => p.ticker).slice(0, 30),
    [plans]
  );
  const { prices: wsPrices, connected: wsConnected, isMock: wsMock } = useAlpacaWebSocket(pendingTickers);

  const wsStatus = wsConnected ? "live" : wsMock ? "mock" : "off";

  useEffect(() => {
    loadAll();
    const clockRef = setInterval(() => setMarket(getMarketInfo()), 30000);
    return () => { clearInterval(clockRef); };
  }, []);

  // Fallback polling: only when WebSocket is neither connected nor in mock mode
  useEffect(() => {
    if (wsConnected || wsMock) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      // Still poll volume_ratio at low frequency
      pollRef.current = setInterval(refreshQuotes, 30000);
    } else {
      clearInterval(pollRef.current);
      pollRef.current = setInterval(refreshQuotes, 5000);
    }
    return () => clearInterval(pollRef.current);
  }, [wsConnected, wsMock, plans]);

  // Initial quote load when plans are ready
  useEffect(() => {
    if (plans.length > 0) refreshQuotes();
  }, [plans]);

  async function loadAll() {
    setLoading(true);
    await Promise.allSettled([loadPlans(), loadBrokers()]);
    setLoading(false);
  }

  async function loadPlans() {
    try {
      const res = await axios.get("/api/trade-plans?status=pending");
      setPlans(res.data || []);
    } catch {}
  }

  async function loadBrokers() {
    try {
      const res = await axios.get("/api/brokers");
      setBrokers(res.data || []);
    } catch {}
  }

  async function refreshQuotes() {
    const tickers = plans.map(p => p.ticker).join(",");
    if (!tickers) return;
    try {
      const res = await axios.get(`/api/quotes?symbols=${tickers}`);
      setQuotes(res.data);
      setLastUpdate(new Date());
    } catch {}
  }

  // Merge live prices: WS price takes priority, fallback to polling quote
  function getLivePrice(ticker) {
    if (wsPrices[ticker] != null) return wsPrices[ticker];
    return quotes[ticker]?.price ?? null;
  }

  // Alpaca broker for PDT + balance
  const alpacaBroker = brokers.find(b => b.broker_type === "alpaca");
  const daytradeCount = alpacaBroker?.balance?.daytrade_count ?? null;
  const buyingPower   = alpacaBroker?.balance?.buying_power ?? null;
  const isPaper       = alpacaBroker?.balance?.is_paper ?? false;

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Header bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-semibold text-white">Trading Cockpit</h1>

          {/* Market clock */}
          {market.nextLabel && market.minsUntil != null ? (
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${
              market.isOpen ? "border-green-700/50 bg-green-900/20 text-green-400" : "border-gray-700 bg-gray-800/60 text-gray-400"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${market.isOpen ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
              <span>
                {market.isOpen ? "Markt offen" : `${market.nextLabel} in`}
                {" "}<span className="font-semibold tabular-nums">
                  {Math.floor(market.minsUntil / 60)}h {market.minsUntil % 60}m
                </span>
              </span>
            </div>
          ) : !market.isWeekday ? (
            <span className="text-xs text-gray-600 px-2.5 py-1.5 bg-gray-800/60 rounded-lg border border-gray-700">Kein Handel heute</span>
          ) : null}

          {/* PDT counter — only for Alpaca */}
          <PdtBadge count={daytradeCount} />

          {/* Balance */}
          {buyingPower != null && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              {isPaper && <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 font-semibold">PAPER</span>}
              <span>Kaufkraft</span>
              <span className="font-semibold text-white">${parseFloat(buyingPower).toLocaleString("en", { maximumFractionDigits: 0 })}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* WebSocket connection status */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${WS_STATUS[wsStatus].border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${WS_STATUS[wsStatus].dot}`} />
            <span className={WS_STATUS[wsStatus].text}>{WS_STATUS[wsStatus].label}</span>
          </div>
          {lastUpdate && (
            <span className="text-[10px] text-gray-600">
              {lastUpdate.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={loadAll}
            className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Plan tiles */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">
            Pending Pläne ({plans.length})
          </h2>
          <span className="text-xs text-gray-600">
            {wsConnected ? "WebSocket Live" : wsMock ? "Mock-Modus" : "Polling-Fallback"}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <div className="text-gray-600 text-sm">Keine offenen Pläne.</div>
            <button
              onClick={() => setActiveTab?.("scanner")}
              className="text-xs px-3 py-1.5 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-700/40 text-indigo-400 rounded-lg transition"
            >
              Zum Scanner →
            </button>
          </div>
        ) : (
          <div>
            {plans.map(plan => (
              <PlanTile
                key={plan.id}
                plan={plan}
                brokers={brokers}
                livePrice={getLivePrice(plan.ticker)}
                volumeRatio={quotes[plan.ticker]?.volume_ratio ?? null}
                onExecute={(p, b) => setJustageTarget({ plan: p, broker: b })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Open orders (Alpaca only) */}
      <OpenOrdersSection visible={!!alpacaBroker} />

      {/* Justage Modal */}
      {justageTarget && (
        <JustageModal
          plan={justageTarget.plan}
          broker={justageTarget.broker}
          livePrice={getLivePrice(justageTarget.plan.ticker)}
          onClose={() => setJustageTarget(null)}
          onSuccess={() => { setJustageTarget(null); loadPlans(); }}
        />
      )}
    </div>
  );
}
