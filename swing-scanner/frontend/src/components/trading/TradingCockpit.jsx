import { useState, useEffect, useRef } from "react";
import axios from "axios";
import OrderForm from "./OrderForm.jsx";

async function createPlanFromCandidate(candidate, brokerIds = []) {
  const nums = String(candidate.entry_zone || "").match(/[\d.]+/g)?.map(Number) ?? [];
  const entryHigh = nums.length > 0 ? Math.max(...nums) : null;
  const entryLow  = nums.length > 1 ? Math.min(...nums) : entryHigh;
  if (!entryHigh) throw new Error("Keine Entry-Zone");
  await axios.post("/api/trade-plans", {
    ticker:          candidate.ticker,
    entry_low:       entryLow,
    entry_high:      entryHigh,
    stop_loss:       parseFloat(candidate.stop_loss),
    target:          candidate.target ? parseFloat(candidate.target) : null,
    strategy_module: candidate.strategy_module,
    setup_type:      candidate.setup_type,
    scan_result_id:  candidate.id,
    broker_ids:      brokerIds,
    risk_pct:        1.0,
  });
}

function parseEntryZone(entryZone) {
  if (!entryZone) return null;
  const nums = String(entryZone).match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length === 0) return null;
  const trigger = Math.max(...nums);
  const low     = Math.min(...nums);
  return { low, trigger };
}

function PriceIndicator({ livePrice, entryZone }) {
  const zone = parseEntryZone(entryZone);
  if (!livePrice || !zone) return <span className="text-gray-600 text-xs">—</span>;

  const pct = ((livePrice - zone.trigger) / zone.trigger) * 100;

  let color, label;
  if (livePrice <= zone.trigger)  { color = "text-green-400"; label = "In Zone ✓"; }
  else if (pct <= 2)              { color = "text-yellow-400"; label = `+${pct.toFixed(1)}%`; }
  else                            { color = "text-red-400";   label = `+${pct.toFixed(1)}%`; }

  return (
    <div className="text-right">
      <div className={`text-sm font-semibold ${color}`}>${livePrice.toFixed(2)}</div>
      <div className={`text-[10px] ${color}`}>{label}</div>
    </div>
  );
}

function OrderRow({ order, onCancel }) {
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    setCancelling(true);
    try {
      await axios.delete(`/api/orders/${order.id}`);
      onCancel();
    } catch (err) {
      alert(err.response?.data?.detail || "Stornierung fehlgeschlagen");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-800/60 rounded-lg text-xs">
      <div className="flex-1 min-w-0">
        <span className="text-white font-semibold">{order.ticker}</span>
        <span className="text-gray-400 ml-2">{order.qty} × ${order.limit_price?.toFixed(2) ?? "—"}</span>
        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
          order.status === "new"             ? "text-blue-400 bg-blue-900/20"
          : order.status === "partially_filled" ? "text-yellow-400 bg-yellow-900/20"
          : "text-gray-400 bg-gray-800"
        }`}>{order.status}</span>
      </div>
      <button
        onClick={cancel}
        disabled={cancelling}
        className="text-red-400 hover:text-red-300 border border-red-800/40 px-2 py-1 rounded transition disabled:opacity-50"
      >
        {cancelling ? "…" : "Stornieren"}
      </button>
    </div>
  );
}

export default function TradingCockpit() {
  const [account,    setAccount]    = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [quotes,     setQuotes]     = useState({});
  const [orders,     setOrders]     = useState([]);
  const [orderTarget, setOrderTarget] = useState(null);
  const [planCreating, setPlanCreating] = useState(null); // ticker being planned
  const [planDone,    setPlanDone]    = useState({});      // { ticker: true }
  const [loading,    setLoading]    = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadAll();
    // Poll quotes every 5s
    pollRef.current = setInterval(refreshQuotes, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.allSettled([loadAccount(), loadCandidates(), loadOrders()]);
    setLoading(false);
  }

  async function loadAccount() {
    try {
      const res = await axios.get("/api/orders/account");
      setAccount(res.data);
    } catch {}
  }

  async function loadCandidates() {
    try {
      const res = await axios.get("/api/candidates");
      setCandidates(res.data || []);
      // Fetch initial quotes
      const tickers = (res.data || []).map(c => c.ticker).join(",");
      if (tickers) {
        const qRes = await axios.get(`/api/quotes?symbols=${tickers}`);
        setQuotes(qRes.data);
        setLastUpdate(new Date());
      }
    } catch {}
  }

  async function loadOrders() {
    try {
      const res = await axios.get("/api/orders");
      setOrders(res.data || []);
    } catch {}
  }

  async function refreshQuotes() {
    const tickers = candidates.map(c => c.ticker).join(",");
    if (!tickers) return;
    try {
      const res = await axios.get(`/api/quotes?symbols=${tickers}`);
      setQuotes(res.data);
      setLastUpdate(new Date());
    } catch {}
  }

  // Only show actionable candidates (with entry zone + stop)
  const actionable = candidates.filter(c => c.entry_zone && c.stop_loss);
  const watchOnly  = candidates.filter(c => !c.entry_zone || !c.stop_loss);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Trading Cockpit</h1>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-gray-500">
              Kurse: {lastUpdate.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => { loadOrders(); refreshQuotes(); }}
            className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Account Banner */}
      {account && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap gap-4 items-center">
          {account.is_paper && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/30 border border-yellow-700/50 text-yellow-400">
              PAPER TRADING
            </span>
          )}
          <div className="text-sm">
            <span className="text-gray-400">Kaufkraft </span>
            <span className="text-white font-semibold">${parseFloat(account.buying_power).toLocaleString("en", { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Portfolio </span>
            <span className="text-white">${parseFloat(account.portfolio_value).toLocaleString("en", { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Status </span>
            <span className="text-green-400">{account.status}</span>
          </div>
        </div>
      )}

      {/* Open Orders */}
      {orders.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-200 mb-3">Offene Orders ({orders.length})</h2>
          <div className="space-y-1.5">
            {orders.map(o => (
              <OrderRow key={o.id} order={o} onCancel={loadOrders} />
            ))}
          </div>
        </div>
      )}

      {/* Actionable Candidates */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">
            Kandidaten — Heute ({actionable.length})
          </h2>
          <span className="text-xs text-gray-500">Live-Preise alle 5s</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : actionable.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-10">
            Keine Kandidaten mit vollständigem Setup heute.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {actionable.map(c => {
              const livePrice = quotes[c.ticker];
              const zone = parseEntryZone(c.entry_zone);
              const inZone = livePrice && zone && livePrice <= zone.trigger;

              return (
                <div key={c.id} className={`flex items-center gap-3 px-4 py-3 transition ${inZone ? "bg-green-900/10" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{c.ticker}</span>
                      {c.strategy_module && (
                        <span className="text-[10px] text-gray-500 border border-gray-700 px-1 rounded">
                          {c.strategy_module}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 flex gap-2 mt-0.5">
                      <span>Entry: ${c.entry_zone}</span>
                      <span>SL: ${c.stop_loss}</span>
                      <span>TP: ${c.target ?? "—"}</span>
                      {c.crv_calculated && (
                        <span className={c.crv_calculated >= 2 ? "text-green-400" : c.crv_calculated >= 1.5 ? "text-yellow-400" : "text-red-400"}>
                          CRV {c.crv_calculated.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  <PriceIndicator livePrice={livePrice} entryZone={c.entry_zone} />

                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => setOrderTarget(c)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                        inZone
                          ? "bg-green-700 hover:bg-green-600 border-green-600 text-white"
                          : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
                      }`}
                    >
                      Kaufen
                    </button>
                    {planDone[c.ticker] ? (
                      <span className="px-2.5 py-1.5 text-xs rounded-lg bg-indigo-900/20 border border-indigo-700/30 text-indigo-400">
                        ✓ Plan
                      </span>
                    ) : (
                      <button
                        disabled={planCreating === c.ticker}
                        onClick={async () => {
                          setPlanCreating(c.ticker);
                          try {
                            await createPlanFromCandidate(c);
                            setPlanDone(prev => ({ ...prev, [c.ticker]: true }));
                          } catch {}
                          setPlanCreating(null);
                        }}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-indigo-700/40 bg-indigo-900/10 hover:bg-indigo-900/30 text-indigo-400 transition disabled:opacity-50"
                      >
                        {planCreating === c.ticker ? "…" : "+ Plan"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Watch-only (no setup) */}
      {watchOnly.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">⏳ Beobachtung — kein Setup ({watchOnly.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {watchOnly.map(c => (
              <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800/60 rounded-lg border border-gray-700/50">
                <span className="text-gray-300 text-sm font-medium">{c.ticker}</span>
                {quotes[c.ticker] && (
                  <span className="text-gray-500 text-xs">${quotes[c.ticker]?.toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order Form Modal */}
      {orderTarget && (
        <OrderForm
          candidate={orderTarget}
          onClose={() => setOrderTarget(null)}
          onSuccess={() => { setOrderTarget(null); loadOrders(); }}
        />
      )}
    </div>
  );
}
