import { useState, useEffect } from "react";
import axios from "axios";

export default function TRChecklist({ plan, brokerId, brokerLabel, qtyOverride, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState({});

  useEffect(() => {
    const url = `/api/trade-plans/${plan.id}/checklist/${brokerId}`
      + (qtyOverride ? `?qty=${qtyOverride}` : "");
    axios.get(url)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [plan.id, brokerId, qtyOverride]);

  function toggle(i) {
    setChecked(prev => ({ ...prev, [i]: !prev[i] }));
  }

  const allChecked = data?.steps && data.steps.every((_, i) => checked[i]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">{plan.ticker}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 font-semibold">
                {brokerLabel}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Manuelle Ausführung — Schritt für Schritt</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl">✕</button>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {data && !loading && (
          <>
            {/* Key numbers */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Einstieg", value: data.entry_eur != null ? `€${data.entry_eur.toFixed(2)}` : "—" },
                { label: "Stop-Loss", value: data.stop_eur != null ? `€${data.stop_eur.toFixed(2)}` : "—" },
                { label: "Ziel", value: data.target_eur != null ? `€${data.target_eur.toFixed(2)}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-800/60 rounded-lg py-2.5 px-2">
                  <div className="text-[10px] text-gray-500 mb-1">{label}</div>
                  <div className="text-white text-sm font-semibold">{value}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-gray-500">
                {data.qty} Aktien · Pos: ~€{data.position_eur?.toLocaleString("de", { maximumFractionDigits: 0 })}
              </span>
              <span className="text-red-400">Max. Risiko: ~€{data.risk_eur?.toFixed(0)}</span>
              {data.crv && (
                <span className={data.crv >= 2 ? "text-green-400 font-semibold" : data.crv >= 1.5 ? "text-yellow-400" : "text-red-400"}>
                  CRV {data.crv}
                </span>
              )}
            </div>

            {data.eurusd_rate && (
              <div className="text-[10px] text-gray-600 text-center">
                EUR/USD: {data.eurusd_rate}
              </div>
            )}

            {/* Step-by-step checklist */}
            <div className="space-y-1.5">
              {data.steps?.map((step, i) => (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-lg border transition ${
                    checked[i]
                      ? "bg-green-900/20 border-green-700/40 text-green-400"
                      : "bg-gray-800/40 border-gray-700/40 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className={`shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center text-[10px] font-bold ${
                    checked[i] ? "bg-green-700 border-green-600 text-white" : "border-gray-600"
                  }`}>
                    {checked[i] ? "✓" : i + 1}
                  </span>
                  <span className="text-xs leading-relaxed">{step}</span>
                </button>
              ))}
            </div>

            {allChecked && (
              <div className="px-3 py-2.5 rounded-lg bg-green-900/20 border border-green-700/40 text-green-400 text-xs text-center font-semibold">
                ✓ Alle Schritte abgehakt — Trade ausgeführt!
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition"
            >
              Schließen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
