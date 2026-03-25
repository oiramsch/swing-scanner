import { useState, useEffect, useRef } from "react";
import axios from "axios";
import JustageModal from "./JustageModal.jsx";

function parseEntryZone(low, high) {
  if (!low || !high) return null;
  return { low: parseFloat(low), trigger: parseFloat(high) };
}

function ZoneBar({ livePrice, entryLow, entryHigh }) {
  if (!livePrice || !entryLow || !entryHigh) return null;
  const low = parseFloat(entryLow);
  const high = parseFloat(entryHigh);
  const pctAbove = ((livePrice - high) / high) * 100;
  let color, label;
  if (livePrice < low)        { color = "text-orange-400"; label = "Below Zone ⚠️"; }
  else if (livePrice <= high) { color = "text-green-400";  label = "In Kaufzone ✓"; }
  else if (pctAbove <= 2)     { color = "text-yellow-400"; label = `+${pctAbove.toFixed(1)}% über Zone`; }
  else                        { color = "text-red-400";    label = `+${pctAbove.toFixed(1)}% über Zone`; }
  return (
    <div className="text-right shrink-0">
      <div className={`text-sm font-bold ${color}`}>${livePrice.toFixed(2)}</div>
      <div className={`text-[10px] ${color}`}>{label}</div>
    </div>
  );
}

function BrokerBadge({ broker }) {
  const icons = { alpaca: "🦙", trade_republic: "🇩🇪", ibkr: "📊" };
  const isPaper = broker.is_paper;
  const balance = broker.balance;
  const sym = balance?.currency === "EUR" ? "€" : "$";
  const val = balance?.buying_power;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded border border-gray-700 text-xs">
      <span>{icons[broker.broker_type] ?? "💼"}</span>
      <span className="text-gray-300 font-medium">{broker.label}</span>
      {isPaper && <span className="text-yellow-500 text-[9px]">PAPER</span>}
      {val != null ? (
        <span className="text-gray-500">{sym}{Math.round(val).toLocaleString("de")}</span>
      ) : (
        <span className="text-red-500 text-[10px]">n/v</span>
      )}
      {balance?.manual && <span className="text-gray-600 text-[9px]">manuell</span>}
    </div>
  );
}

function PlanRow({ plan, brokers, quotes, onAlpacaBuy, onTRPlan, onCancel }) {
  const livePrice = quotes[plan.ticker];
  const zone = parseEntryZone(plan.entry_low, plan.entry_high);
  const inZone    = livePrice && zone && livePrice >= zone.low && livePrice <= zone.trigger;
  const belowZone = livePrice && zone && livePrice < zone.low;
  const execState = JSON.parse(plan.execution_state_json || "{}");
  const assignedIds = JSON.parse(plan.broker_ids_json || "[]");
  const assignedBrokers = brokers.filter(b => b.id == null || assignedIds.includes(b.id));

  return (
    <div className={`p-4 border-b border-gray-800 last:border-0 transition ${inZone ? "bg-green-900/10" : belowZone ? "bg-orange-900/10" : ""}`}>
      {/* Row header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-base">{plan.ticker}</span>
            {plan.strategy_module && (
              <span className="text-[10px] px-1.5 py-0.5 border border-gray-700 rounded text-gray-500">
                {plan.strategy_module}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
              plan.status === "pending" ? "bg-gray-800 text-gray-400" :
              plan.status === "active"  ? "bg-green-900/40 text-green-400 border border-green-700/40" :
              plan.status === "partial" ? "bg-yellow-900/40 text-yellow-400" :
              "bg-gray-800 text-gray-600"
            }`}>
              {plan.status.toUpperCase()}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-gray-500 mt-1 flex-wrap">
            <span>Entry: ${plan.entry_low}–${plan.entry_high}</span>
            <span>SL: ${plan.stop_loss}</span>
            {plan.target && <span>TP: ${plan.target}</span>}
            {plan.target && plan.entry_high && plan.stop_loss && (
              <span className={
                ((plan.target - plan.entry_high) / (plan.entry_high - plan.stop_loss)) >= 2
                  ? "text-green-400" : "text-yellow-400"
              }>
                CRV {((plan.target - plan.entry_high) / (plan.entry_high - plan.stop_loss)).toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <ZoneBar livePrice={livePrice} entryLow={plan.entry_low} entryHigh={plan.entry_high} />
      </div>

      {/* Broker execution row */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {brokers.length === 0 && (
          <span className="text-xs text-gray-600">Keine Broker konfiguriert</span>
        )}
        {brokers.map(broker => {
          const brokerId = broker.id;
          const executed = execState[String(brokerId)] === "executed";
          const isAlpaca = broker.broker_type === "alpaca";
          const isTR = broker.broker_type === "trade_republic";

          return (
            <div key={brokerId ?? "env"} className="flex items-center gap-1.5">
              {executed ? (
                <span className="text-[11px] px-2.5 py-1.5 rounded-lg bg-green-900/20 border border-green-700/30 text-green-500">
                  ✓ {broker.label}
                </span>
              ) : isAlpaca ? (
                <button
                  onClick={() => !belowZone && onAlpacaBuy(plan, broker)}
                  title={belowZone ? "Preis unter Support — Setup ungültig" : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${
                    inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 cursor-not-allowed"
                      : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
                  }`}
                >
                  {belowZone ? "⚠️ Below Zone" : `${broker.label} kaufen`}
                </button>
              ) : isTR ? (
                <button
                  onClick={() => !belowZone && onTRPlan(plan, broker)}
                  title={belowZone ? "Preis unter Support — Setup ungültig" : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${
                    belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 cursor-not-allowed"
                      : inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : "border-indigo-700/50 bg-indigo-900/20 hover:bg-indigo-900/40 text-indigo-300"
                  }`}
                >
                  {belowZone ? "⚠️ Below Zone" : `${broker.label} Plan ↗`}
                </button>
              ) : (
                <button
                  onClick={() => !belowZone && onTRPlan(plan, broker)}
                  title={belowZone ? "Preis unter Support — Setup ungültig" : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                    belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 cursor-not-allowed"
                      : inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : "border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400"
                  }`}
                >
                  {belowZone ? "⚠️ Below Zone" : `${broker.label} ↗`}
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => onCancel(plan.id)}
          className="ml-auto text-[11px] text-gray-600 hover:text-red-400 transition"
        >
          Abbrechen
        </button>
      </div>

      {plan.notes && (
        <div className="mt-2 text-xs text-gray-600 italic">{plan.notes}</div>
      )}
    </div>
  );
}

export default function DealCockpit() {
  const [plans,     setPlans]     = useState([]);
  const [brokers,   setBrokers]   = useState([]);
  const [quotes,    setQuotes]    = useState({});
  const [loading,   setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [justageTarget, setJustageTarget] = useState(null); // { plan, broker }
  const pollRef = useRef(null);

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(refreshQuotes, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.allSettled([loadPlans(), loadBrokers()]);
    setLoading(false);
  }

  async function loadPlans() {
    try {
      const res = await axios.get("/api/trade-plans?active_only=true");
      setPlans(res.data || []);
      const tickers = (res.data || []).map(p => p.ticker).join(",");
      if (tickers) {
        const qRes = await axios.get(`/api/quotes?symbols=${tickers}`);
        setQuotes(qRes.data);
        setLastUpdate(new Date());
      }
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

  async function cancelPlan(planId) {
    try {
      await axios.delete(`/api/trade-plans/${planId}`);
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch {}
  }

  function openJustage(plan, broker) {
    setJustageTarget({ plan, broker });
  }

  const activePlans = plans.filter(p => ["pending", "active", "partial"].includes(p.status));

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-white">Deal Cockpit</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Broker balances */}
          {brokers.map(b => <BrokerBadge key={b.id ?? "env"} broker={b} />)}
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-xs text-gray-600">
                {lastUpdate.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={loadAll}
              className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      {/* Active Plans */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">
            Aktive Deal Pläne ({activePlans.length})
          </h2>
          <span className="text-xs text-gray-600">Live-Preise alle 5s</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activePlans.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <div className="text-gray-600 text-sm">Keine aktiven Deal Pläne.</div>
            <div className="text-gray-700 text-xs">
              Erstelle einen Plan aus dem Scanner-Tab über den "Plan erstellen"-Button.
            </div>
          </div>
        ) : (
          activePlans.map(plan => (
            <PlanRow
              key={plan.id}
              plan={plan}
              brokers={brokers}
              quotes={quotes}
              onAlpacaBuy={openJustage}
              onTRPlan={openJustage}
              onCancel={cancelPlan}
            />
          ))
        )}
      </div>

      {/* Finale Justage Modal — einheitlich für Alpaca + TR */}
      {justageTarget && (
        <JustageModal
          plan={justageTarget.plan}
          broker={justageTarget.broker}
          livePrice={quotes[justageTarget.plan.ticker]}
          onClose={() => setJustageTarget(null)}
          onSuccess={() => { setJustageTarget(null); loadPlans(); }}
        />
      )}
    </div>
  );
}
