import { useState, useEffect, useRef } from "react";
import axios from "axios";

function parseEntryZone(entryZone) {
  if (!entryZone) return null;
  const nums = String(entryZone).match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length === 0) return null;
  const trigger = Math.max(...nums);
  const low     = Math.min(...nums);
  return { low, trigger };
}

function LivePriceBadge({ livePrice, entryZone, loading }) {
  if (loading) return <span className="text-xs text-gray-500 animate-pulse">Kurs lädt…</span>;
  if (!livePrice) return <span className="text-xs text-gray-600">Kurs n/v</span>;

  const zone = parseEntryZone(entryZone);
  if (!zone) return <span className="text-sm font-semibold text-white">${livePrice.toFixed(2)}</span>;

  const pct = ((livePrice - zone.trigger) / zone.trigger) * 100;
  let color, label, bg;
  if (livePrice <= zone.trigger)   { color = "text-green-400"; bg = "bg-green-900/20 border-green-700/40"; label = "In Kaufzone ✓"; }
  else if (pct <= 2)               { color = "text-yellow-400"; bg = "bg-yellow-900/20 border-yellow-700/40"; label = `+${pct.toFixed(1)}% über Zone`; }
  else                             { color = "text-red-400"; bg = "bg-red-900/20 border-red-700/40"; label = `+${pct.toFixed(1)}% über Zone`; }

  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${bg}`}>
      <span className={`text-base font-bold ${color}`}>${livePrice.toFixed(2)}</span>
      <span className={`text-[11px] ${color}`}>{label}</span>
    </div>
  );
}

export default function OrderForm({ candidate: c, onClose, onSuccess }) {
  const zone    = parseEntryZone(c.entry_zone);
  const [limitPrice,  setLimitPrice]  = useState(zone?.trigger ?? "");
  const [stopLoss,    setStopLoss]    = useState(c.stop_loss  ? String(c.stop_loss)  : "");
  const [takeProfit,  setTakeProfit]  = useState(c.target     ? String(c.target)     : "");
  const [riskPct,     setRiskPct]     = useState("1.0");
  const [account,     setAccount]     = useState(null);
  const [livePrice,   setLivePrice]   = useState(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [error,       setError]       = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    axios.get("/api/orders/account").then(r => setAccount(r.data)).catch(() => {});
    fetchPrice();
    // Refresh price every 5s while modal is open
    pollRef.current = setInterval(fetchPrice, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function fetchPrice() {
    try {
      const res = await axios.get(`/api/quotes?symbols=${c.ticker}`);
      const price = res.data[c.ticker];
      if (price) setLivePrice(price);
    } catch {}
    setPriceLoading(false);
  }

  // Derived calculations
  const entry  = parseFloat(limitPrice) || 0;
  const stop   = parseFloat(stopLoss)   || 0;
  const target = parseFloat(takeProfit) || 0;
  const risk   = parseFloat(riskPct)    || 1;
  const buyingPower = account?.buying_power ?? 0;

  const riskPerShare  = entry > stop ? entry - stop : 0;
  const riskAmount    = buyingPower * (risk / 100);
  const qty           = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const positionValue = qty * entry;
  const potentialGain = qty * (target - entry);
  const crv           = riskPerShare > 0 && target > entry
    ? ((target - entry) / riskPerShare).toFixed(2) : null;

  const stopAboveEntry  = stop > 0 && entry > 0 && stop >= entry;
  const canSubmit = qty > 0 && entry > 0 && stop > 0 && !stopAboveEntry && target > entry;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await axios.post("/api/orders/bracket", {
        ticker: c.ticker, qty, limit_price: entry, take_profit: target, stop_loss: stop,
      });
      setResult(res.data);
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Order fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-gray-900 border border-green-700/60 rounded-xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
          <div className="text-green-400 text-lg font-bold mb-2">✓ Order platziert</div>
          <div className="space-y-1 text-sm text-gray-300">
            <div>{c.ticker} · {qty} Aktien @ ${entry}</div>
            <div>Stop: ${stop} · Target: ${target}</div>
            <div className="text-gray-500 text-xs mt-2">Order-ID: {result.id}</div>
          </div>
          <button onClick={onClose} className="mt-4 w-full py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition">
            Schließen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-lg">{c.ticker}</span>
            {account?.is_paper && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 border border-yellow-700/50 text-yellow-400 font-semibold">PAPER</span>
            )}
            {c.strategy_module && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">{c.strategy_module}</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        {/* Live price + entry zone */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <LivePriceBadge livePrice={livePrice} entryZone={c.entry_zone} loading={priceLoading} />
          {zone && (
            <div className="text-xs text-gray-500">
              Kaufzone: <span className="text-gray-300">${zone.low} – ${zone.trigger}</span>
            </div>
          )}
        </div>

        {/* Account info */}
        {account && (
          <div className="text-xs text-gray-400">
            Kaufkraft: <strong className="text-white">${account.buying_power.toLocaleString("en", { maximumFractionDigits: 0 })}</strong>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Price inputs */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Limit-Preis", value: limitPrice, set: setLimitPrice, border: "focus:border-indigo-500" },
              { label: "Stop-Loss",   value: stopLoss,   set: setStopLoss,   border: "focus:border-red-500" },
              { label: "Take-Profit", value: takeProfit, set: setTakeProfit, border: "focus:border-green-500" },
            ].map(({ label, value, set, border }) => (
              <div key={label}>
                <label className="block text-[10px] text-gray-500 mb-1">{label}</label>
                <input
                  type="number" step="0.01" value={value}
                  onChange={e => set(e.target.value)}
                  className={`w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none ${border}`}
                />
              </div>
            ))}
          </div>

          {/* Risk slider */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Risiko % des Kontos</label>
            <div className="flex items-center gap-2">
              <input type="range" min="0.5" max="5" step="0.5" value={riskPct}
                onChange={e => setRiskPct(e.target.value)} className="flex-1 accent-indigo-500" />
              <span className="text-white text-sm w-8 text-right">{riskPct}%</span>
            </div>
          </div>

          {/* Position summary */}
          <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Anzahl Aktien</span>
              <span className="text-white font-semibold">{qty > 0 ? qty : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Positionsgröße</span>
              <span className="text-white">{qty > 0 ? `$${positionValue.toLocaleString("en", { maximumFractionDigits: 0 })}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max. Verlust</span>
              <span className="text-red-400">{qty > 0 && riskPerShare > 0 ? `-$${(riskPerShare * qty).toFixed(0)}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Pot. Gewinn</span>
              <span className="text-green-400">{qty > 0 && potentialGain > 0 ? `+$${potentialGain.toFixed(0)}` : "—"}</span>
            </div>
            {crv && (
              <div className="flex justify-between border-t border-gray-700 pt-1.5">
                <span className="text-gray-400">CRV</span>
                <span className={parseFloat(crv) >= 2 ? "text-green-400 font-semibold" : parseFloat(crv) >= 1.5 ? "text-yellow-400" : "text-red-400"}>
                  {crv} {parseFloat(crv) >= 2 ? "✅" : parseFloat(crv) >= 1.5 ? "⚠️" : "⛔"}
                </span>
              </div>
            )}
          </div>

          {stopAboveEntry && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">
              ⚠ Stop-Loss liegt über dem Kaufpreis — das wäre ein Short-Setup. Bitte Werte prüfen.
            </p>
          )}
          {target > 0 && target <= entry && (
            <p className="text-xs text-red-400">⚠ Take-Profit muss über dem Limit-Preis liegen</p>
          )}
          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="w-full py-2.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm rounded-lg transition"
          >
            {submitting ? "Wird platziert…" : `${qty > 0 ? qty : "?"} × ${c.ticker} kaufen`}
          </button>
        </form>
      </div>
    </div>
  );
}
