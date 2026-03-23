import { useState } from "react";
import axios from "axios";

const URGENCY_COLOR = {
  immediate: "text-red-400",
  today: "text-orange-400",
  monitor: "text-yellow-400",
  watch: "text-gray-400",
};

function UrgencyBadge({ urgency }) {
  const colors = { immediate: "bg-red-900/40 text-red-300", today: "bg-orange-900/40 text-orange-300", monitor: "bg-yellow-900/40 text-yellow-300", watch: "bg-gray-800 text-gray-400" };
  const labels = { immediate: "sofort", today: "heute", monitor: "beobachten", watch: "watch" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[urgency] || colors.watch}`}>
      {labels[urgency] || urgency}
    </span>
  );
}

export default function TradeSettingModal({ positionData, onConfirm, onClose }) {
  const [stage, setStage] = useState("select"); // select | loading | review
  const [tradeType, setTradeType] = useState(null);
  const [setting, setSetting] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const { ticker, entry_price, shares, stop_loss, setup_type, sector } = positionData;
  const positionValue = (parseFloat(entry_price || 0) * parseFloat(shares || 0)).toFixed(0);
  const riskEur = ((parseFloat(entry_price || 0) - parseFloat(stop_loss || 0)) * parseFloat(shares || 0)).toFixed(0);

  async function handleSelectType(type) {
    setTradeType(type);
    setStage("loading");
    setError(null);
    try {
      const res = await axios.post("/api/portfolio/preview-setting", {
        ...positionData,
        trade_type: type,
      });
      setSetting(res.data);
      setWarning(res.data._position_size_warning || null);
      setStage("review");
    } catch (err) {
      setError(err.response?.data?.detail || "KI-Analyse fehlgeschlagen");
      setStage("select");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onConfirm({
        ...positionData,
        trade_type: tradeType,
        action_setting_json: setting,
        position_size_warning: warning,
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setSaving(false);
    }
  }

  const stopLoss = setting?.stop_loss;
  const targets = setting?.targets || [];
  const holdDuration = setting?.hold_duration;
  const trailingStop = setting?.trailing_stop;
  const exitTriggers = setting?.exit_triggers || [];
  const immediate = exitTriggers.filter(t => t.urgency === "immediate");
  const monitor = exitTriggers.filter(t => t.urgency !== "immediate");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-semibold text-base">{ticker} zu Portfolio hinzufügen</h2>
              <p className="text-gray-400 text-xs mt-0.5">
                Entry: ${entry_price} · {shares} Shares · Einsatz: €{positionValue} · Risiko: €{riskEur}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs">{error}</div>
          )}

          {/* Stage: Select */}
          {stage === "select" && (
            <div>
              <p className="text-gray-300 text-sm mb-4 font-medium">Welche Strategie verfolgst du?</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <button
                  onClick={() => handleSelectType("swing")}
                  className="border border-gray-700 hover:border-indigo-500 bg-gray-800 hover:bg-indigo-900/20 rounded-xl p-4 text-left transition-all group"
                >
                  <div className="text-2xl mb-2">📈</div>
                  <div className="text-white font-semibold text-sm group-hover:text-indigo-300">Swing Trade</div>
                  <div className="text-gray-400 text-xs mt-1">1–4 Wochen</div>
                  <div className="text-gray-500 text-xs mt-0.5">Technisch</div>
                </button>
                <button
                  onClick={() => handleSelectType("position")}
                  className="border border-gray-700 hover:border-purple-500 bg-gray-800 hover:bg-purple-900/20 rounded-xl p-4 text-left transition-all group"
                >
                  <div className="text-2xl mb-2">📊</div>
                  <div className="text-white font-semibold text-sm group-hover:text-purple-300">Positionstrade</div>
                  <div className="text-gray-400 text-xs mt-1">1–3 Monate</div>
                  <div className="text-gray-500 text-xs mt-0.5">Fundamental + Technisch</div>
                </button>
              </div>
              <button onClick={onClose} className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm">
                Abbrechen
              </button>
            </div>
          )}

          {/* Stage: Loading */}
          {stage === "loading" && (
            <div className="py-12 text-center">
              <div className="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-gray-300 text-sm">KI erstellt dein Handlungs-Setting…</p>
              <p className="text-gray-500 text-xs mt-1">ca. 3–5 Sekunden</p>
            </div>
          )}

          {/* Stage: Review */}
          {stage === "review" && setting && (
            <div className="space-y-4">
              {/* Trade type badge + header */}
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${tradeType === "swing" ? "bg-indigo-900/60 text-indigo-300" : "bg-purple-900/60 text-purple-300"}`}>
                  {tradeType === "swing" ? "📈 Swing Trade" : "📊 Positionstrade"}
                </span>
                <span className="text-gray-500 text-xs">
                  {targets[0]?.price && `Ziel 1: $${targets[0].price}`}
                  {targets[1]?.price && ` · Ziel 2: $${targets[1].price}`}
                  {holdDuration && ` · ${holdDuration.min_days}–${holdDuration.max_days} Tage`}
                </span>
              </div>

              {/* Position size warning */}
              {warning && (
                <div className={`p-2.5 rounded-lg border text-xs ${
                  warning.includes("CRITICAL") ? "bg-red-900/30 border-red-700 text-red-300" :
                  warning.includes("HIGH") ? "bg-orange-900/30 border-orange-700 text-orange-300" :
                  "bg-yellow-900/30 border-yellow-700 text-yellow-300"
                }`}>
                  ⚠️ {warning}
                </div>
              )}

              {/* Rationale */}
              {setting.rationale && (
                <p className="text-gray-400 text-xs italic">{setting.rationale}</p>
              )}

              {/* Stop Loss */}
              {stopLoss && (
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 text-sm">🛑</span>
                    <span className="text-white text-sm font-medium">Stop-Loss: ${stopLoss.initial}</span>
                    <span className="text-gray-500 text-xs">{stopLoss.method}</span>
                  </div>
                  {stopLoss.explanation && (
                    <p className="text-gray-400 text-xs pl-5">{stopLoss.explanation}</p>
                  )}
                  {trailingStop?.recommended && (
                    <p className="text-gray-500 text-xs pl-5">
                      Trailing: ab ${trailingStop.activate_at} aktivieren, trail {trailingStop.trail_value} {trailingStop.trail_by}
                    </p>
                  )}
                </div>
              )}

              {/* Targets */}
              {targets.length > 0 && (
                <div className="space-y-2">
                  {targets.map((t, i) => (
                    <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-400 text-sm">🎯</span>
                          <span className="text-white text-sm font-medium">{t.label}: ${t.price}</span>
                        </div>
                        <p className="text-gray-400 text-xs pl-5 mt-0.5">→ {t.action}</p>
                        {t.rationale && <p className="text-gray-500 text-xs pl-5">{t.rationale}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Exit Triggers */}
              {exitTriggers.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {immediate.length > 0 && (
                    <div className="bg-red-900/10 border border-red-900/40 rounded-lg p-2.5">
                      <p className="text-red-400 text-xs font-semibold mb-1.5">Sofort raus:</p>
                      {immediate.map((t, i) => (
                        <p key={i} className="text-gray-300 text-xs mb-1">• {t.condition}</p>
                      ))}
                    </div>
                  )}
                  {monitor.length > 0 && (
                    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-2.5">
                      <p className="text-yellow-400 text-xs font-semibold mb-1.5">Beobachten:</p>
                      {monitor.map((t, i) => (
                        <p key={i} className="text-gray-400 text-xs mb-1">• {t.condition}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Hold duration */}
              {holdDuration && (
                <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-800/40 rounded px-3 py-2">
                  <span>⏱</span>
                  <span>
                    Ideal: <span className="text-white">{holdDuration.ideal_days} Tage</span>
                    {" "}· Max: <span className="text-white">{holdDuration.max_days} Tage</span>
                    {holdDuration.note && <span className="text-gray-500"> · {holdDuration.note}</span>}
                  </span>
                </div>
              )}

              {/* AI Summary */}
              {setting.summary && (
                <p className="text-gray-400 text-xs leading-relaxed border-t border-gray-800 pt-3">{setting.summary}</p>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setStage("select")}
                  className="flex-1 py-2.5 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white rounded-lg text-sm transition-colors"
                >
                  ← Zurück
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-2 flex-grow py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg text-sm disabled:opacity-50 transition-colors"
                >
                  {saving ? "Speichern…" : "✓ Speichern + Plan aktivieren"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
