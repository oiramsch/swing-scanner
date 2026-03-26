import { useState, useEffect, useMemo } from "react";
import axios from "axios";

function parseEntryZone(entryZone) {
  if (!entryZone) return { low: "", high: "" };
  const nums = String(entryZone).match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length === 0) return { low: "", high: "" };
  if (nums.length === 1) return { low: String(nums[0]), high: String(nums[0]) };
  const [lo, hi] = [Math.min(...nums), Math.max(...nums)];
  return { low: String(lo), high: String(hi) };
}

function calcFee(feeModelJson, orderValue) {
  try {
    const m = feeModelJson ? JSON.parse(feeModelJson) : { type: "flat", amount: 0 };
    if (m.type === "flat") return m.amount ?? 0;
    if (m.type === "percent") {
      let fee = orderValue * ((m.rate ?? 0) / 100);
      if (m.min != null) fee = Math.max(fee, m.min);
      if (m.max != null) fee = Math.min(fee, m.max);
      return fee;
    }
  } catch { /* ignore */ }
  return 0;
}

function PositionSizer({ entryHigh, stopLoss, target, riskPct, brokers, selectedBrokers }) {
  const entry = parseFloat(entryHigh);
  const stop  = parseFloat(stopLoss);
  const tgt   = parseFloat(target);

  const lines = useMemo(() => {
    if (!entry || !stop || stop >= entry) return [];
    const riskPerShare = entry - stop;
    return brokers
      .filter(b => selectedBrokers.includes(b.id))
      .map(b => {
        const balance  = b.manual_balance ?? 0;
        const currency = b.manual_currency ?? "USD";
        const grossRiskBudget = balance * (parseFloat(riskPct) / 100);
        // Estimate order value for fee calc (conservative: use entry × estimated shares)
        const estimatedShares = grossRiskBudget > 0 ? Math.floor(grossRiskBudget / riskPerShare) : 0;
        const orderValue = estimatedShares * entry;
        const singleFee  = calcFee(b.fee_model_json, orderValue);
        const roundTrip  = singleFee * 2;
        const netRiskBudget = grossRiskBudget - roundTrip;
        const shares = netRiskBudget > 0 ? Math.floor(netRiskBudget / riskPerShare) : 0;
        const posValue = shares * entry;

        // Net CRV
        let netCrv = null;
        if (shares > 0 && !isNaN(tgt) && tgt > entry) {
          const netReward = (tgt - entry) * shares - roundTrip;
          const netRisk   = (entry - stop) * shares + roundTrip;
          netCrv = netRisk > 0 ? (netReward / netRisk).toFixed(2) : null;
        }

        // Warnings
        const warnings = [];
        if (netRiskBudget <= 0)
          warnings.push("⚠ Risiko-Budget deckt die Gebühren nicht");
        else if (roundTrip > 0 && roundTrip / grossRiskBudget > 0.1)
          warnings.push(`⚠ Gebühren fressen ${((roundTrip / grossRiskBudget) * 100).toFixed(0)}% des Risikos`);
        if (netCrv !== null && parseFloat(netCrv) < 1.0)
          warnings.push("🔴 Netto-CRV < 1 — Trade nach Gebühren negativ");

        return { label: b.label, balance, currency, grossRiskBudget, roundTrip, netRiskBudget, shares, posValue, netCrv, warnings };
      });
  }, [entry, stop, tgt, riskPct, brokers, selectedBrokers]);

  if (lines.length === 0) return null;

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="text-xs text-gray-400 font-medium">Positionsgrößen-Rechner (netto)</div>
      {lines.map((l, i) => (
        <div key={i} className="text-xs space-y-1">
          <div className="text-gray-300 font-medium">{l.label}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-400">
            <span>Konto: <span className="text-white">{l.balance.toLocaleString("de")} {l.currency}</span></span>
            <span>Brutto-Risiko: <span className="text-orange-300">{l.grossRiskBudget.toLocaleString("de", { maximumFractionDigits: 0 })} {l.currency}</span></span>
            {l.roundTrip > 0 && <span>Gebühren (Hin+Rück): <span className="text-yellow-500">{l.roundTrip.toLocaleString("de", { maximumFractionDigits: 2 })} {l.currency}</span></span>}
            <span>Netto-Risiko: <span className="text-orange-400">{l.netRiskBudget.toLocaleString("de", { maximumFractionDigits: 0 })} {l.currency}</span></span>
            {l.shares > 0
              ? <span>Stücke: <span className="text-green-400 font-semibold">{l.shares}</span><span className="text-gray-500"> (≈{l.currency === "EUR" ? "€" : "$"}{l.posValue.toLocaleString("de", { maximumFractionDigits: 0 })})</span></span>
              : <span className="text-gray-600 col-span-2">Kein Saldo / Budget zu klein</span>
            }
            {l.netCrv !== null && (
              <span className={`col-span-2 font-medium ${parseFloat(l.netCrv) >= 2 ? "text-green-400" : parseFloat(l.netCrv) >= 1 ? "text-yellow-400" : "text-red-400"}`}>
                Netto-CRV: {l.netCrv}
              </span>
            )}
          </div>
          {l.warnings.map((w, wi) => (
            <div key={wi} className="text-[10px] text-orange-400 bg-orange-900/20 px-2 py-0.5 rounded">{w}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Broker types that support short selling
const SHORT_CAPABLE_TYPES = ["alpaca"];

export default function PlanModal({ candidate, onClose, onSaved }) {
  const ez = parseEntryZone(candidate.entry_zone);

  // Detect short setup from candidate
  const entryNum  = parseFloat(ez.high || ez.low);
  const targetNum = candidate.target ? parseFloat(candidate.target) : null;
  const isShort = candidate.candidate_status === "direction_mismatch" ||
    (!isNaN(entryNum) && targetNum !== null && targetNum < entryNum);

  const [entryLow,  setEntryLow]  = useState(ez.low);
  const [entryHigh, setEntryHigh] = useState(ez.high);
  const [stopLoss,  setStopLoss]  = useState(candidate.stop_loss ? String(candidate.stop_loss) : "");
  const [target,    setTarget]    = useState(candidate.target    ? String(candidate.target)    : "");
  const [riskPct,   setRiskPct]   = useState("1");
  const [brokers,   setBrokers]   = useState([]);
  const [selectedBrokers, setSelectedBrokers] = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    axios.get("/api/brokers")
      .then(res => {
        setBrokers(res.data);
        // pre-select all active brokers
        setSelectedBrokers(res.data.filter(b => b.is_active).map(b => b.id));
      })
      .catch(() => {});
  }, []);

  function toggleBroker(id) {
    setSelectedBrokers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  const entryF = parseFloat(entryHigh);
  const stopF  = parseFloat(stopLoss);
  // For long: stop must be below entry. For short: stop must be above entry.
  const stopInvalid = isShort
    ? (!isNaN(entryF) && !isNaN(stopF) && stopF <= entryF)
    : (!isNaN(entryF) && !isNaN(stopF) && stopF >= entryF);

  const crv = useMemo(() => {
    const e = parseFloat(entryHigh);
    const s = parseFloat(stopLoss);
    const t = parseFloat(target);
    if (isShort) {
      // Short CRV: reward = entry - target, risk = stop - entry
      if (!isNaN(e) && !isNaN(s) && !isNaN(t) && s > e && t < e) {
        return ((e - t) / (s - e)).toFixed(1);
      }
    } else {
      if (!isNaN(e) && !isNaN(s) && !isNaN(t) && s < e && t > e) {
        return ((t - e) / (e - s)).toFixed(1);
      }
    }
    return null;
  }, [entryHigh, stopLoss, target, isShort]);

  async function handleSave() {
    setError(null);
    const el = parseFloat(entryLow);
    const eh = parseFloat(entryHigh);
    const sl = parseFloat(stopLoss);
    if (isNaN(el) || isNaN(eh) || isNaN(sl)) {
      setError("Entry und Stop Loss müssen ausgefüllt sein.");
      return;
    }
    if (isShort ? sl <= eh : sl >= eh) {
      setError(isShort
        ? "Short-Setup: Stop Loss muss ÜBER dem Entry liegen."
        : "Stop Loss muss unter dem Entry liegen."
      );
      return;
    }
    setSaving(true);
    try {
      await axios.post("/api/trade-plans", {
        ticker: candidate.ticker,
        scan_result_id: candidate.id ?? null,
        strategy_module: candidate.strategy_module ?? null,
        setup_type: candidate.setup_type ?? null,
        entry_low: el,
        entry_high: eh,
        stop_loss: sl,
        target: parseFloat(target) || null,
        risk_pct: parseFloat(riskPct) || 1.0,
        broker_ids: selectedBrokers,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-bold text-base">{candidate.ticker}</span>
              {candidate.setup_type && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 capitalize">
                  {candidate.setup_type}
                </span>
              )}
              {candidate.strategy_module && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-700/50 text-indigo-400">
                  {candidate.strategy_module}
                </span>
              )}
              {candidate.confidence != null && (
                <span className="text-[10px] text-gray-500">Conf: {candidate.confidence}</span>
              )}
            </div>
            {candidate.sector && (
              <div className="text-[10px] text-gray-600">{candidate.sector}</div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none ml-3 shrink-0">✕</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* Short-Setup Warning */}
          {isShort && (
            <div className="bg-orange-900/30 border border-orange-700/50 rounded-lg px-3 py-2 flex items-start gap-2">
              <span className="text-orange-400 shrink-0">⚠</span>
              <div className="text-xs text-orange-300">
                <span className="font-semibold">Short-Setup</span> — Entry/Stop/Target sind für eine Short-Position.
                Stop muss <em>über</em> dem Entry liegen, Target <em>unter</em> dem Entry.
                Nur mit Brokern möglich, die Short-Selling unterstützen.
              </div>
            </div>
          )}

          {/* Entry Zone */}
          <div>
            <div className="text-xs text-gray-400 mb-1.5 font-medium">Entry Zone</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Low (Einstieg ab)</label>
                <input
                  type="number" step="0.01" value={entryLow}
                  onChange={e => setEntryLow(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">High / Trigger</label>
                <input
                  type="number" step="0.01" value={entryHigh}
                  onChange={e => setEntryHigh(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Stop Loss & Target */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Stop Loss</label>
              <input
                type="number" step="0.01" value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className={`w-full bg-gray-800 border rounded px-2 py-1.5 text-sm text-white focus:outline-none transition ${
                  stopInvalid ? "border-red-500/80 focus:border-red-400" : "border-gray-700 focus:border-indigo-500"
                }`}
              />
              {stopInvalid && (
                <p className="text-[10px] text-red-400 mt-0.5">
                  {isShort ? "Stop ≤ Entry — bei Short muss Stop über Entry liegen" : "Stop ≥ Entry — ungültig"}
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Target (optional)</label>
              <input
                type="number" step="0.01" value={target}
                onChange={e => setTarget(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* CRV badge */}
          {crv && (
            <div className={`text-xs font-medium px-2 py-1 rounded border inline-block ${
              parseFloat(crv) >= 2 ? "bg-green-900/40 text-green-300 border-green-700/50"
              : parseFloat(crv) >= 1.5 ? "bg-yellow-900/40 text-yellow-300 border-yellow-700/50"
              : "bg-red-900/40 text-red-300 border-red-700/50"
            }`}>
              CRV: {crv} {parseFloat(crv) >= 2 ? "✅" : parseFloat(crv) >= 1.5 ? "⚠️" : "⛔"}
            </div>
          )}

          {/* Risk % */}
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Risikoanteil pro Broker (%)</label>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.1" min="0.1" max="10" value={riskPct}
                onChange={e => setRiskPct(e.target.value)}
                className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-gray-500">% des Kontostands</span>
            </div>
          </div>

          {/* Broker selection */}
          {brokers.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-1.5 font-medium">Broker</div>
              <div className="space-y-1.5">
                {brokers.map(b => {
                  const canShort = SHORT_CAPABLE_TYPES.includes(b.broker_type);
                  const disabledForShort = isShort && !canShort;
                  return (
                    <label key={b.id} className={`flex items-center gap-2 ${disabledForShort ? "opacity-40 cursor-not-allowed" : "cursor-pointer group"}`}>
                      <input
                        type="checkbox"
                        checked={selectedBrokers.includes(b.id)}
                        onChange={() => !disabledForShort && toggleBroker(b.id)}
                        disabled={disabledForShort}
                        className="accent-indigo-500"
                      />
                      <span className={`text-sm transition ${disabledForShort ? "text-gray-600" : "text-gray-300 group-hover:text-white"}`}>
                        {b.label}
                      </span>
                      <span className="text-[10px] text-gray-600 capitalize">{b.broker_type}</span>
                      {b.is_paper && <span className="text-[10px] text-yellow-600 border border-yellow-800/40 px-1 rounded">Paper</span>}
                      {disabledForShort && <span className="text-[10px] text-gray-600 border border-gray-700 px-1 rounded">Kein Short</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Position Sizer */}
          <PositionSizer
            entryHigh={entryHigh}
            stopLoss={stopLoss}
            target={target}
            riskPct={riskPct}
            brokers={brokers}
            selectedBrokers={selectedBrokers}
          />

          {error && (
            <div className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || stopInvalid}
            className="flex-1 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition disabled:opacity-50"
          >
            {saving ? "Speichern…" : "Plan erstellen →  Deal Cockpit"}
          </button>
        </div>
      </div>
    </div>
  );
}
