import { useState, useEffect, useRef } from "react";
import axios from "axios";
import JustageModal from "./JustageModal.jsx";

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

// Zone styles for SHORT plans (inverted logic)
const SHORT_ZONE_STYLES = {
  in:      { border: "border-l-red-500",    bg: "bg-red-900/10",    badge: "text-red-400",    label: "🔴 In Short-Zone" },
  near:    { border: "border-l-yellow-500", bg: "bg-yellow-900/10", badge: "text-yellow-400", label: "🟡 Nah dran" },
  below:   { border: "border-l-red-500",    bg: "bg-red-900/10",    badge: "text-red-400",    label: "🔴 Stop gefährdet" },
  above:   { border: "border-l-green-500",  bg: "bg-green-900/10",  badge: "text-green-400",  label: "🟢 Short-Trigger" },
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
function PlanTile({ plan, brokers, livePrice, volumeRatio, onExecute, onArchive }) {
  const isShort = plan.direction === "short";
  const status = zoneStatus(livePrice, plan.entry_low, plan.entry_high);
  const styles = isShort ? SHORT_ZONE_STYLES : ZONE_STYLES;
  const { border, bg, badge, label } = styles[status];

  // CRV: for longs (target - entry) / (entry - stop); for shorts (entry - target) / (stop - entry)
  const crv = plan.target && plan.entry_high && plan.stop_loss
    ? isShort
      ? ((plan.entry_high - plan.target) / (plan.stop_loss - plan.entry_high))
      : ((plan.target - plan.entry_high) / (plan.entry_high - plan.stop_loss))
    : null;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-l-4 ${border} ${bg} border-b border-gray-800 last:border-b-0 transition`}>
      {/* Left: ticker + module + setup */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold">{plan.ticker}</span>
          {isShort && (
            <span className="text-[10px] px-1.5 py-0.5 border border-red-700/50 rounded text-red-400 font-semibold">
              SHORT ↓
            </span>
          )}
          {plan.auto_trade && (
            <span
              className="text-[10px] px-1.5 py-0.5 border border-indigo-700/50 rounded text-indigo-400 font-semibold"
              title="Automatisch um 15:35 UTC platziert"
            >
              🤖 Auto
            </span>
          )}
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

      {/* Right: execute buttons per broker + archive */}
      <div className="flex gap-1.5 shrink-0 items-center">
        <button
          onClick={() => onArchive(plan)}
          title="Plan archivieren (z.B. bereits via Auto-Trade ausgeführt)"
          className="px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-red-900/30 rounded border border-gray-700 hover:border-red-700/50 transition"
        >
          ✕
        </button>
        {brokers.map(broker => {
          // For longs: disabled when price is above zone (missed entry)
          // For shorts: disabled when price is below zone (stop threatened)
          const isDisabled = isShort ? status === "below" : status === "above";
          const isActive   = isShort ? status === "above" || status === "in" : status === "in";
          const disabledTitle = isShort
            ? "Preis unter Entry-Zone — Stop gefährdet"
            : "Preis über Entry-Zone";
          return (
            <button
              key={broker.id}
              onClick={() => onExecute(plan, broker)}
              disabled={isDisabled}
              title={isDisabled ? disabledTitle : `${broker.label} — Ausführen`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                isActive
                  ? isShort
                    ? "bg-red-700 hover:bg-red-600 border-red-600 text-white"
                    : "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                  : isDisabled
                  ? "opacity-40 cursor-not-allowed bg-gray-800 border-gray-700 text-gray-500"
                  : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
              }`}
            >
              {broker.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open orders list (Alpaca only)
// ---------------------------------------------------------------------------
function OpenOrdersSection({ visible, quotes }) {
  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [cancelling, setCancelling] = useState({});
  const [confirmId,  setConfirmId]  = useState(null); // order awaiting confirm

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible]);

  async function load() {
    setLoading(true);
    try {
      const res = await axios.get("/api/orders");
      // SELL-Orders (TP/SL bracket children) are managed in the Portfolio tab — show BUY-side only
      setOrders((res.data || []).filter(o => o.side === "buy"));
    } catch {}
    setLoading(false);
  }

  async function cancel(orderId) {
    setConfirmId(null);
    setCancelling(c => ({ ...c, [orderId]: true }));
    try {
      await axios.delete(`/api/orders/${orderId}`);
      setOrders(o => o.filter(x => x.id !== orderId));
    } catch (err) {
      alert(err.response?.data?.detail || "Stornierung fehlgeschlagen");
    }
    setCancelling(c => ({ ...c, [orderId]: false }));
  }

  // For a SELL order: if current price is already above the limit → TP about to fill → block cancel
  function cancelStatus(o) {
    if (o.side !== "sell") return "allowed";
    if (!o.limit_price) return "allowed";
    const livePrice = quotes?.[o.ticker]?.price;
    if (!livePrice) return "warn"; // unknown price → warn
    if (livePrice >= o.limit_price) return "blocked"; // price above TP → don't cancel
    return "warn"; // price below TP → warn but allow
  }

  if (!visible) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Offene Kauf-Orders ({orders.length})</h2>
        <button onClick={load} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition">↻</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-16">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-6 text-xs text-gray-600">Keine offenen Kauf-Orders</div>
      ) : (
        <div>
          {orders.map(o => {
            const cs = cancelStatus(o);
            const isSell = o.side === "sell";
            const typeLabel = (o.type || "").replace(/^OrderType\./i, "").toUpperCase();
            const statusLabel = (o.status || "").replace(/^OrderStatus\./i, "");
            const isConfirming = confirmId === o.id;
            return (
              <div key={o.id} className="px-4 py-2.5 border-b border-gray-800 last:border-b-0 text-sm space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-white w-16 shrink-0">{o.ticker}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${isSell ? "bg-red-900/20 border-red-700/40 text-red-400" : "bg-green-900/20 border-green-700/40 text-green-400"}`}>
                    {isSell ? "SELL" : "BUY"}
                  </span>
                  <span className="text-gray-400">{o.qty} Stk.</span>
                  {o.limit_price != null && <span className="text-gray-300">@ ${o.limit_price.toFixed(2)}</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">{typeLabel || o.type}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${["new","accepted"].includes(statusLabel) ? "bg-blue-900/20 border-blue-700/40 text-blue-400" : "bg-gray-800 border-gray-700 text-gray-500"}`}>
                    {statusLabel || o.status}
                  </span>
                  <div className="ml-auto">
                    {cs === "blocked" ? (
                      <span className="text-[10px] text-gray-600 italic">Kurs ≥ Limit — nicht stornierbar</span>
                    ) : isConfirming ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-orange-400">{isSell ? "⚠ Take-Profit stornieren?" : "Order stornieren?"}</span>
                        <button onClick={() => cancel(o.id)} className="text-xs px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition">Ja</button>
                        <button onClick={() => setConfirmId(null)} className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">Nein</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(o.id)}
                        disabled={cancelling[o.id]}
                        className="text-xs px-2.5 py-1 bg-red-900/30 hover:bg-red-900/60 border border-red-700/40 text-red-400 rounded transition disabled:opacity-50"
                      >
                        {cancelling[o.id] ? "…" : "Stornieren"}
                      </button>
                    )}
                  </div>
                </div>
                {cs === "blocked" && (
                  <div className="text-[10px] text-orange-400/80 pl-0.5">
                    Kurs ${quotes?.[o.ticker]?.price?.toFixed(2)} ≥ Limit ${o.limit_price?.toFixed(2)} — Take-Profit kurz vor Auslösung
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function TradingCockpit({ setActiveTab }) {
  const [plans,    setPlans]    = useState([]);
  const [brokers,  setBrokers]  = useState([]);
  const [quotes,   setQuotes]   = useState({});
  const [justageTarget, setJustageTarget] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [market,   setMarket]   = useState(getMarketInfo());
  const [lastUpdate, setLastUpdate] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadAll();
    const clockRef = setInterval(() => setMarket(getMarketInfo()), 30000);
    return () => { clearInterval(clockRef); };
  }, []);

  // Poll quotes every 15 s during market hours, every 60 s outside
  useEffect(() => {
    clearInterval(pollRef.current);
    const ms = market.isOpen ? 15_000 : 60_000;
    pollRef.current = setInterval(refreshQuotes, ms);
    return () => clearInterval(pollRef.current);
  }, [market.isOpen, plans]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial quote load when plans become available
  useEffect(() => {
    if (plans.length > 0) refreshQuotes();
  }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function getLivePrice(ticker) {
    return quotes[ticker]?.price ?? null;
  }

  async function archivePlan(plan) {
    try {
      await axios.delete(`/api/trade-plans/${plan.id}`);
      setPlans(ps => ps.filter(p => p.id !== plan.id));
    } catch (err) {
      alert(err.response?.data?.detail || "Archivieren fehlgeschlagen");
    }
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
          {/* Quote freshness indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs border-gray-700 bg-gray-800/60 text-gray-400">
            <span className={`w-1.5 h-1.5 rounded-full ${lastUpdate ? "bg-green-400" : "bg-gray-600"}`} />
            <span>{lastUpdate ? `Kurse ${lastUpdate.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Laden…"}</span>
          </div>
          <button
            onClick={() => { loadAll(); refreshQuotes(); }}
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
          <span className="text-xs text-gray-600">yfinance · {market.isOpen ? "15 s" : "60 s"}</span>
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
                onArchive={archivePlan}
              />
            ))}
          </div>
        )}
      </div>

      {/* Open orders (Alpaca only) */}
      <OpenOrdersSection visible={!!alpacaBroker} quotes={quotes} />

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
