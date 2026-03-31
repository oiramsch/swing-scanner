/**
 * JustageModal — Finale Justage vor Trade-Ausführung
 *
 * Alpaca: POST /api/trade-plans/{id}/execute/{broker_id} → Bracket Order
 * TR:     Qty bestätigen → TRChecklist öffnen
 */
import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import TRChecklist from "./TRChecklist.jsx";

function calcQty(balance, riskPct, entryHigh, stopLoss, eurusdRate) {
  const entry = parseFloat(entryHigh);
  const stop  = parseFloat(stopLoss);
  if (!balance || isNaN(entry) || isNaN(stop) || stop >= entry) return 1;
  const riskPerShare = (entry - stop) * (eurusdRate ?? 1); // convert to local currency
  const riskBudget   = balance * (parseFloat(riskPct) / 100);
  return Math.max(1, Math.floor(riskBudget / riskPerShare));
}

function CRVBadge({ entry, stop, target }) {
  if (!target || !entry || !stop || stop >= entry) return null;
  const crv = ((target - entry) / (entry - stop)).toFixed(1);
  const color = crv >= 2 ? "text-green-400" : crv >= 1.5 ? "text-yellow-400" : "text-red-400";
  const icon  = crv >= 2 ? "✅" : crv >= 1.5 ? "⚠️" : "⛔";
  return <span className={`text-xs font-semibold ${color}`}>CRV {crv} {icon}</span>;
}

export default function JustageModal({ plan, broker, livePrice, onClose, onSuccess }) {
  const isAlpaca = broker.broker_type === "alpaca";
  const isTR     = broker.broker_type === "trade_republic";
  const currency = broker.balance?.currency ?? (isAlpaca ? "USD" : "EUR");
  const sym      = currency === "EUR" ? "€" : "$";
  const balance  = broker.balance?.buying_power ?? 0;

  // EUR/USD rate needed for TR qty calc
  const [eurusd, setEurusd] = useState(null);
  useEffect(() => {
    if (!isTR) return;
    axios.get("/api/quotes?symbols=EURUSD%3DX")
      .then(r => {
        const rate = r.data?.["EURUSD=X"];
        if (rate && rate > 0.5) setEurusd(rate);
      })
      .catch(() => {});
  }, [isTR]);

  // Qty: pre-calculated from risk_pct
  const initialQty = useMemo(() => calcQty(
    balance,
    plan.risk_pct ?? 1,
    plan.entry_high,
    plan.stop_loss,
    isTR ? (eurusd ?? 1.09) : 1,
  ), [balance, plan, isTR, eurusd]);

  const [qty, setQty] = useState(1);
  useEffect(() => setQty(initialQty), [initialQty]);

  const [executing, setExecuting] = useState(false);
  const [error,     setError]     = useState(null);
  const [success,   setSuccess]   = useState(null);
  const [showTR,    setShowTR]    = useState(false);
  const [confirmLive, setConfirmLive] = useState(false); // double-confirm for live Alpaca

  const entry      = parseFloat(plan.entry_high);
  const stop       = parseFloat(plan.stop_loss);
  const target     = plan.target ? parseFloat(plan.target) : null;
  const riskPerSh  = isNaN(entry) || isNaN(stop) ? 0 : entry - stop;
  const totalRisk  = riskPerSh * qty;
  const posValue   = entry * qty;

  // For TR: EUR values
  const rate       = isTR ? (eurusd ?? 1.09) : 1;
  const entryEur   = isTR ? entry / rate : entry;
  const stopEur    = isTR ? stop  / rate : stop;
  const targetEur  = target && isTR ? target / rate : target;
  const riskEur    = totalRisk / rate;
  const posEur     = posValue  / rate;

  // Zone status
  const inZone    = livePrice && livePrice >= parseFloat(plan.entry_low) && livePrice <= entry;
  const belowZone = livePrice && livePrice < parseFloat(plan.entry_low);

  async function executeAlpaca() {
    setError(null);
    setExecuting(true);
    try {
      const res = await axios.post(
        `/api/trade-plans/${plan.id}/execute/${broker.id}`,
        { qty }
      );
      setSuccess(res.data);
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Fehler bei der Ausführung");
    } finally {
      setExecuting(false);
    }
  }

  // TR: show checklist after confirmation
  if (showTR) {
    return (
      <TRChecklist
        plan={{ ...plan, _qty_override: qty }}
        brokerId={broker.id}
        brokerLabel={broker.label}
        qtyOverride={qty}
        onClose={onClose}
        onExecuted={onSuccess}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-base">{plan.ticker}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">
              {isAlpaca ? "🦙" : isTR ? "🇩🇪" : "💼"} {broker.label}
              {isAlpaca && broker.is_paper && <span className="ml-1 text-yellow-500">PAPER</span>}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Live price + zone */}
          {livePrice && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-semibold ${
              belowZone ? "bg-orange-900/20 border-orange-700/40 text-orange-400"
              : inZone  ? "bg-green-900/20 border-green-700/40 text-green-400"
              :            "bg-gray-800 border-gray-700 text-gray-300"
            }`}>
              <span>Live-Preis</span>
              <span>${livePrice.toFixed(2)} {belowZone ? "— Below Zone ⚠️" : inZone ? "— In Kaufzone ✓" : ""}</span>
            </div>
          )}

          {/* Plan parameter summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Entry", usd: entry,  eur: entryEur  },
              { label: "Stop",  usd: stop,   eur: stopEur   },
              { label: "Ziel",  usd: target, eur: targetEur },
            ].map(({ label, usd, eur }) => (
              <div key={label} className="bg-gray-800/60 rounded-lg py-2 px-1">
                <div className="text-[10px] text-gray-500 mb-1">{label}</div>
                {usd != null ? (
                  <>
                    <div className="text-white text-xs font-semibold">${usd.toFixed(2)}</div>
                    {isTR && <div className="text-gray-400 text-[10px]">≈{sym}{eur.toFixed(2)}</div>}
                  </>
                ) : (
                  <div className="text-gray-600 text-xs">—</div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 px-1">
            <CRVBadge entry={entry} stop={stop} target={target} />
            {isTR && eurusd && (
              <span className="text-[10px] text-gray-600">EUR/USD: {eurusd.toFixed(4)}</span>
            )}
          </div>

          {/* Qty adjustment */}
          <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-medium">Stückzahl</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-bold"
                >−</button>
                <input
                  type="number" min="1" value={qty}
                  onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 text-center bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => setQty(q => q + 1)}
                  className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded text-white text-sm font-bold"
                >+</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 text-xs text-gray-500">
              <span>Positionswert:
                <span className="text-gray-300 ml-1">
                  {sym}{(isTR ? posEur : posValue).toLocaleString("de", { maximumFractionDigits: 0 })}
                </span>
              </span>
              <span>Max. Risiko:
                <span className="text-red-400 ml-1">
                  {sym}{(isTR ? riskEur : totalRisk).toLocaleString("de", { maximumFractionDigits: 0 })}
                </span>
              </span>
              {balance > 0 && (
                <span className="col-span-2 text-gray-600 mt-0.5">
                  Konto: {sym}{balance.toLocaleString("de", { maximumFractionDigits: 0 })} · {plan.risk_pct ?? 1}% Risiko = {sym}{((isTR ? balance : balance) * (plan.risk_pct ?? 1) / 100).toLocaleString("de", { maximumFractionDigits: 0 })} Budget
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="text-green-400 text-sm bg-green-900/20 border border-green-700/40 rounded px-3 py-2 text-center">
              ✓ Order platziert bei {success.broker}
              <button onClick={onClose} className="block w-full mt-2 text-xs text-gray-400 hover:text-white">Schließen</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex gap-2 px-4 py-3 border-t border-gray-800">
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
            >
              Abbrechen
            </button>
            {isAlpaca && !confirmLive && (
              <button
                onClick={() => broker.is_paper ? executeAlpaca() : setConfirmLive(true)}
                disabled={executing || belowZone}
                title={belowZone ? "Preis unter Support — Setup ungültig" : undefined}
                className={`flex-2 px-6 py-2 text-sm rounded font-semibold transition disabled:opacity-50 ${
                  belowZone
                    ? "bg-orange-900/40 border border-orange-700/50 text-orange-400 cursor-not-allowed"
                    : inZone
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {executing ? "Kaufe…" : belowZone ? "⚠️ Below Zone" : `${qty} Stk. kaufen`}
              </button>
            )}
            {isAlpaca && confirmLive && (
              <>
                <button
                  onClick={() => setConfirmLive(false)}
                  className="flex-1 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
                >
                  Zurück
                </button>
                <button
                  onClick={() => { setConfirmLive(false); executeAlpaca(); }}
                  disabled={executing}
                  className="flex-2 px-4 py-2 text-sm rounded font-semibold bg-red-700 hover:bg-red-600 text-white transition disabled:opacity-50"
                >
                  {executing ? "Kaufe…" : `⚠️ LIVE: ${qty} Stk. ${plan.ticker} kaufen`}
                </button>
              </>
            )}
            {(isTR || !isAlpaca) && (
              <button
                onClick={() => setShowTR(true)}
                disabled={belowZone}
                title={belowZone ? "Preis unter Support — Setup ungültig" : undefined}
                className={`flex-2 px-6 py-2 text-sm rounded font-semibold transition disabled:opacity-50 ${
                  belowZone
                    ? "bg-orange-900/40 border border-orange-700/50 text-orange-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {belowZone ? "⚠️ Below Zone" : "Zur Checklist →"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
