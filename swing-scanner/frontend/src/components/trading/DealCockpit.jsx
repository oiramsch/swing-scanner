import { useState, useEffect, useRef, lazy, Suspense } from "react";
import axios from "axios";
import JustageModal from "./JustageModal.jsx";

const DealCockpitCharts = lazy(() => import("../chart/DealCockpitCharts.jsx"));

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

function SlippageInput({ plan, onSaved }) {
  const defaultVal = plan.actual_entry_price != null
    ? String(plan.actual_entry_price)
    : (plan.entry_high ? String(plan.entry_high) : "");
  const [val, setVal] = useState(defaultVal);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function save() {
    const price = parseFloat(val);
    if (isNaN(price) || price <= 0) return;
    setSaving(true);
    try {
      const res = await axios.patch(`/api/trade-plans/${plan.id}/actual-entry`, { actual_entry_price: price });
      setResult(res.data);
      onSaved?.();
    } catch {}
    setSaving(false);
  }

  const slippage = result?.slippage_pct ?? (
    plan.actual_entry_price != null && plan.entry_high
      ? ((plan.actual_entry_price - parseFloat(plan.entry_high)) / parseFloat(plan.entry_high) * 100)
      : null
  );

  const actualPrice = parseFloat(val);
  const aboveZone = !isNaN(actualPrice) && plan.entry_high && actualPrice > parseFloat(plan.entry_high);
  const crv = !isNaN(actualPrice) && actualPrice > 0 && plan.target && plan.stop_loss
    ? ((parseFloat(plan.target) - actualPrice) / (actualPrice - parseFloat(plan.stop_loss)))
    : null;

  return (
    <div className="mt-2 space-y-1 text-xs">
      {aboveZone && (
        <div className="px-2 py-1 bg-orange-900/30 border border-orange-700/50 text-orange-400 rounded text-[11px]">
          ⚠ Kauf oberhalb der Entry-Zone
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-600">Tatsächlicher Kaufkurs:</span>
        <input
          type="number"
          step="0.01"
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="0.00"
          className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:border-indigo-600"
        />
        <button
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded transition disabled:opacity-50"
        >
          {saving ? "..." : "Speichern"}
        </button>
        {slippage != null && (
          <span className={slippage > 0 ? "text-red-400" : slippage < 0 ? "text-green-400" : "text-gray-500"}>
            Slippage: {slippage > 0 ? "+" : ""}{slippage.toFixed(2)}%
          </span>
        )}
        {crv != null && crv > 0 && (
          <span className={crv >= 2.5 ? "text-green-400" : crv >= 1.5 ? "text-yellow-400" : "text-red-400"}>
            CRV {crv.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function ClosePositionForm({ plan, onClose, onSuccess }) {
  const [exitPrice, setExitPrice] = useState(plan.actual_exit_price != null ? String(plan.actual_exit_price) : "");
  const [shares, setShares] = useState(plan.shares_executed != null ? String(plan.shares_executed) : "");
  const [exitReason, setExitReason] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    const price = parseFloat(exitPrice);
    if (isNaN(price) || price <= 0) { setError("Gültiger Exit-Preis erforderlich"); return; }
    setSaving(true);
    setError(null);
    try {
      await axios.post(`/api/trade-plans/${plan.id}/close`, {
        exit_price: price,
        shares: parseFloat(shares) || undefined,
        exit_reason: exitReason,
      });
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Fehler beim Schließen");
    }
    setSaving(false);
  }

  const entryPrice = plan.actual_entry_price || plan.entry_high;
  const previewPnl = !isNaN(parseFloat(exitPrice)) && entryPrice && parseFloat(shares) > 0
    ? ((parseFloat(exitPrice) - entryPrice) * parseFloat(shares) / 1.09).toFixed(2)
    : null;

  return (
    <div className="mt-3 p-3 bg-gray-800/60 border border-red-800/40 rounded-lg space-y-2">
      <div className="text-xs font-medium text-red-300">Position schließen</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Exit-Preis</label>
          <input
            type="number" step="0.01" value={exitPrice}
            onChange={e => setExitPrice(e.target.value)}
            placeholder="0.00"
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:border-red-600"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Stück (optional)</label>
          <input
            type="number" step="1" value={shares}
            onChange={e => setShares(e.target.value)}
            placeholder={plan.shares_executed ?? "—"}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:border-red-600"
          />
        </div>
      </div>
      <select
        value={exitReason} onChange={e => setExitReason(e.target.value)}
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 text-xs"
      >
        <option value="manual">Manuell</option>
        <option value="stop_loss">Stop Loss</option>
        <option value="target">Target erreicht</option>
        <option value="signal">Signal</option>
      </select>
      {previewPnl !== null && (
        <div className={`text-xs px-2 py-1 rounded ${parseFloat(previewPnl) >= 0 ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20"}`}>
          P&L ca. {parseFloat(previewPnl) >= 0 ? "+" : ""}€{previewPnl}
        </div>
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit} disabled={saving}
          className="flex-1 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs rounded font-semibold transition disabled:opacity-50"
        >
          {saving ? "Wird geschlossen…" : "Position schließen ✓"}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 bg-gray-700 text-gray-400 text-xs rounded transition">
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function PlanRow({ plan, brokers, quotes, onAlpacaBuy, onTRPlan, onCancel, onRefresh }) {
  const livePrice = quotes[plan.ticker]?.price ?? null;
  const zone = parseEntryZone(plan.entry_low, plan.entry_high);
  const inZone    = livePrice && zone && livePrice >= zone.low && livePrice <= zone.trigger;
  const belowZone = livePrice && zone && livePrice < zone.low;
  const execState = JSON.parse(plan.execution_state_json || "{}");
  const assignedIds = JSON.parse(plan.broker_ids_json || "[]");
  const assignedBrokers = brokers.filter(b => b.id == null || assignedIds.includes(b.id));
  const [belowZoneConfirm, setBelowZoneConfirm] = useState(null); // broker waiting for below-zone confirm
  const [showClose, setShowClose] = useState(false);

  function handleBrokerClick(broker) {
    if (belowZone) { setBelowZoneConfirm(broker); return; }
    if (broker.broker_type === "alpaca") onAlpacaBuy(plan, broker);
    else onTRPlan(plan, broker);
  }

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
                  onClick={() => handleBrokerClick(broker)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${
                    inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 hover:bg-orange-900/50"
                      : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
                  }`}
                >
                  {belowZone ? "⚠ Below Zone" : `${broker.label} kaufen`}
                </button>
              ) : isTR ? (
                <button
                  onClick={() => handleBrokerClick(broker)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${
                    belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 hover:bg-orange-900/50"
                      : inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : "border-indigo-700/50 bg-indigo-900/20 hover:bg-indigo-900/40 text-indigo-300"
                  }`}
                >
                  {belowZone ? "⚠ Below Zone" : `${broker.label} Plan ↗`}
                </button>
              ) : (
                <button
                  onClick={() => handleBrokerClick(broker)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                    belowZone
                      ? "bg-orange-900/30 border-orange-700/50 text-orange-400 hover:bg-orange-900/50"
                      : inZone
                      ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                      : "border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400"
                  }`}
                >
                  {belowZone ? "⚠ Below Zone" : `${broker.label} ↗`}
                </button>
              )}
            </div>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {(plan.status === "active" || plan.status === "partial") && (
            <button
              onClick={() => setShowClose(c => !c)}
              className={`text-[11px] px-2.5 py-1 rounded border transition ${
                showClose
                  ? "bg-red-900/30 border-red-700/60 text-red-300"
                  : "bg-gray-800 border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-700/50"
              }`}
            >
              Close Position
            </button>
          )}
          <button
            onClick={() => onCancel(plan.id)}
            className="text-[11px] text-gray-600 hover:text-red-400 transition"
          >
            Abbrechen
          </button>
        </div>
      </div>

      {belowZoneConfirm && (
        <div className="mt-2 px-3 py-2 bg-orange-900/20 border border-orange-700/50 rounded-lg text-xs space-y-2">
          <div className="text-orange-400 font-medium">
            ⚠ Der aktuelle Kurs liegt unter der Entry-Zone. Trotzdem kaufen?
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setBelowZoneConfirm(null)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
            >
              Abbrechen
            </button>
            <button
              onClick={() => {
                const broker = belowZoneConfirm;
                setBelowZoneConfirm(null);
                if (broker.broker_type === "alpaca") onAlpacaBuy(plan, broker);
                else onTRPlan(plan, broker);
              }}
              className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded font-semibold transition"
            >
              Trotzdem kaufen
            </button>
          </div>
        </div>
      )}

      {plan.notes && (
        <div className="mt-2 text-xs text-gray-600 italic">{plan.notes}</div>
      )}

      {/* Slippage tracker (show for active/partial plans or if fill already recorded) */}
      {(plan.status === "active" || plan.status === "partial" || plan.actual_entry_price != null) && (
        <SlippageInput plan={plan} onSaved={onRefresh} />
      )}

      {/* Close Position form */}
      {showClose && (
        <ClosePositionForm
          plan={plan}
          onClose={() => setShowClose(false)}
          onSuccess={() => { setShowClose(false); onRefresh(); }}
        />
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
  const [chartsVisible, setChartsVisible] = useState(false);
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
              onRefresh={loadPlans}
            />
          ))
        )}
      </div>

      {/* Mini-Charts Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setChartsVisible(v => !v)}
          className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded transition"
        >
          {chartsVisible ? "Charts ausblenden ▲" : "Charts einblenden ▼"}
        </button>
        {chartsVisible && (
          <span className="text-xs text-gray-600">Intraday 15min · Live-Update alle 60s</span>
        )}
      </div>

      {/* Multi-Chart Grid */}
      {chartsVisible && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <Suspense fallback={
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <DealCockpitCharts plans={activePlans} />
          </Suspense>
        </div>
      )}

      {/* Finale Justage Modal — einheitlich für Alpaca + TR */}
      {justageTarget && (
        <JustageModal
          plan={justageTarget.plan}
          broker={justageTarget.broker}
          livePrice={quotes[justageTarget.plan.ticker]?.price ?? null}
          onClose={() => setJustageTarget(null)}
          onSuccess={() => { setJustageTarget(null); loadPlans(); }}
        />
      )}
    </div>
  );
}
