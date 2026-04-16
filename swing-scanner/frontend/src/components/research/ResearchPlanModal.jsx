/**
 * ResearchPlanModal — Tradingplan direkt aus dem Research-Tab erstellen.
 * Vereinfachte Version von PlanModal: kein scan_result_id nötig, kein Kandidat-Kontext.
 * Benachrichtigt den Chart via onDraftChange() für Live-Linien-Preview.
 */
import { useState, useEffect, useMemo } from "react";
import axios from "axios";

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
  } catch {}
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
        const balance  = b.balance?.buying_power ?? b.manual_balance ?? 0;
        const currency = b.balance?.currency ?? b.manual_currency ?? "USD";
        const grossRisk = balance * (parseFloat(riskPct) / 100);
        const estShares = grossRisk > 0 ? Math.floor(grossRisk / riskPerShare) : 0;
        const fee2x = calcFee(b.fee_model_json, estShares * entry) * 2;
        const netRisk = grossRisk - fee2x;
        const shares = netRisk > 0 ? Math.floor(netRisk / riskPerShare) : 0;
        const netCrv = shares > 0 && !isNaN(tgt) && tgt > entry
          ? (((tgt - entry) * shares - fee2x) / ((entry - stop) * shares + fee2x)).toFixed(2)
          : null;
        const warnings = [];
        if (netRisk <= 0) warnings.push("⚠ Budget deckt Gebühren nicht");
        if (netCrv !== null && parseFloat(netCrv) < 1) warnings.push("🔴 Netto-CRV < 1");
        return { label: b.label, balance, currency, shares, posValue: shares * entry, netCrv, warnings };
      });
  }, [entry, stop, tgt, riskPct, brokers, selectedBrokers]);

  if (lines.length === 0) return null;
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="text-xs text-gray-400 font-medium">Positionsgrößen-Rechner</div>
      {lines.map((l, i) => (
        <div key={i} className="text-xs space-y-0.5">
          <span className="text-gray-300 font-medium">{l.label}: </span>
          {l.shares > 0
            ? <span className="text-green-400 font-semibold">{l.shares} Stk.</span>
            : <span className="text-gray-600">Budget zu klein</span>}
          {l.netCrv && (
            <span className={`ml-2 ${parseFloat(l.netCrv) >= 2 ? "text-green-400" : parseFloat(l.netCrv) >= 1 ? "text-yellow-400" : "text-red-400"}`}>
              CRV {l.netCrv}
            </span>
          )}
          {l.warnings.map((w, wi) => (
            <div key={wi} className="text-[10px] text-orange-400 bg-orange-900/20 px-2 py-0.5 rounded mt-0.5">{w}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ResearchPlanModal({ ticker, currentPrice, onClose, onSaved, onDraftChange, initialValues = {} }) {
  const [entryLow,  setEntryLow]  = useState(initialValues.entry_low  != null ? String(initialValues.entry_low)  : (currentPrice ? String(currentPrice) : ""));
  const [entryHigh, setEntryHigh] = useState(initialValues.entry_high != null ? String(initialValues.entry_high) : (currentPrice ? String(currentPrice) : ""));
  const [stopLoss,  setStopLoss]  = useState(initialValues.stop_loss  != null ? String(initialValues.stop_loss)  : "");
  const [target,    setTarget]    = useState(initialValues.target      != null ? String(initialValues.target)     : "");
  const [riskPct,   setRiskPct]   = useState("1");
  const [brokers,   setBrokers]   = useState([]);
  const [selectedBrokers, setSelectedBrokers] = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    axios.get("/api/brokers")
      .then(res => {
        setBrokers(res.data);
        setSelectedBrokers(res.data.filter(b => b.is_active).map(b => b.id));
      })
      .catch(() => {});
  }, []);

  // Notify chart of live changes
  useEffect(() => {
    onDraftChange?.({ entryLow, entryHigh, stopLoss, target });
  }, [entryLow, entryHigh, stopLoss, target]);

  // Clear draft lines when modal closes
  useEffect(() => {
    return () => onDraftChange?.(null);
  }, []);

  const crv = useMemo(() => {
    const e = parseFloat(entryHigh);
    const s = parseFloat(stopLoss);
    const t = parseFloat(target);
    if (!isNaN(e) && !isNaN(s) && !isNaN(t) && s < e && t > e)
      return ((t - e) / (e - s)).toFixed(1);
    return null;
  }, [entryHigh, stopLoss, target]);

  async function handleSave() {
    setError(null);
    const el = parseFloat(entryLow);
    const eh = parseFloat(entryHigh);
    const sl = parseFloat(stopLoss);
    if (isNaN(el) || isNaN(eh) || isNaN(sl)) {
      setError("Entry und Stop Loss müssen ausgefüllt sein.");
      return;
    }
    if (sl >= eh) {
      setError("Stop Loss muss unter dem Entry liegen.");
      return;
    }
    setSaving(true);
    try {
      await axios.post("/api/trade-plans", {
        ticker,
        scan_result_id: null,
        strategy_module: null,
        setup_type: "manual",
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

  function Field({ label, value, onChange, placeholder }) {
    return (
      <div>
        <label className="text-xs text-gray-400 block mb-1">{label}</label>
        <input
          type="number" step="0.01" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 transition"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-base">{ticker}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-500">Manual</span>
            {crv && (
              <span className={`text-xs font-semibold ${parseFloat(crv) >= 2.5 ? "text-green-400" : parseFloat(crv) >= 1.5 ? "text-yellow-400" : "text-red-400"}`}>
                CRV {crv}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none ml-3">✕</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* Entry Zone */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry Low ($)" value={entryLow} onChange={setEntryLow} placeholder="z.B. 159.00" />
            <Field label="Entry High ($)" value={entryHigh} onChange={setEntryHigh} placeholder="z.B. 160.00" />
          </div>

          {/* Stop Loss + Target */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} placeholder="z.B. 156.50" />
            <Field label="Ziel / TP ($)" value={target} onChange={setTarget} placeholder="z.B. 170.00" />
          </div>

          {/* Risk % */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Risiko % vom Konto</label>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.5" max="5" step="0.5" value={riskPct}
                onChange={e => setRiskPct(e.target.value)}
                className="flex-1 accent-indigo-500"
              />
              <span className="text-white text-sm font-semibold w-10 text-right">{riskPct}%</span>
            </div>
          </div>

          {/* Position sizer */}
          <PositionSizer
            entryHigh={entryHigh} stopLoss={stopLoss} target={target}
            riskPct={riskPct} brokers={brokers} selectedBrokers={selectedBrokers}
          />

          {/* Broker selection */}
          {brokers.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-2">Broker</div>
              <div className="flex flex-wrap gap-2">
                {brokers.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBrokers(prev =>
                      prev.includes(b.id) ? prev.filter(x => x !== b.id) : [...prev, b.id]
                    )}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                      selectedBrokers.includes(b.id)
                        ? "bg-indigo-700/40 border-indigo-600/60 text-indigo-200"
                        : "bg-gray-800 border-gray-700 text-gray-400"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition">
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !entryHigh || !stopLoss}
            className="flex-2 px-6 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition"
          >
            {saving ? "Speichern…" : "Plan erstellen"}
          </button>
        </div>
      </div>
    </div>
  );
}
