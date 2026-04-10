import { useState, useMemo, useEffect } from "react";
import axios from "axios";

const SIGNAL_COLORS = {
  high: "bg-red-900/30 text-red-300 border-red-700",
  medium: "bg-orange-900/30 text-orange-300 border-orange-700",
  low: "bg-yellow-900/30 text-yellow-300 border-yellow-700",
};

const SIGNAL_ICONS = {
  stop_loss: "🛑",
  sma50: "📉",
  sma20: "⬇️",
  rsi_overbought: "🔥",
  pattern_reversal: "⚠️",
  stagnation: "💤",
};

export default function PositionCard({ position: pos, broker, onUpdate }) {
  const isTR = broker?.broker_type === "trade_republic";
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    entry_price: pos.entry_price ?? "",
    shares: pos.shares ?? "",
    stop_loss: pos.stop_loss ?? "",
    target: pos.target ?? "",
    notes: pos.notes ?? "",
  });
  const [showClose, setShowClose] = useState(false);
  const [exitPrice, setExitPrice] = useState("");
  const [exitPriceEur, setExitPriceEur] = useState("");
  const [exitEurMode, setExitEurMode] = useState(false);
  const [eurusd, setEurusd] = useState(null);
  const [exitReason, setExitReason] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    if (!showClose || !isTR) return;
    axios.get("/api/quotes?symbols=EURUSD%3DX")
      .then(r => {
        const rate = r.data?.["EURUSD=X"];
        if (rate && rate > 0.5) setEurusd(rate);
      })
      .catch(() => {});
  }, [showClose, isTR]);

  const pnl = pos.unrealized_pnl ?? pos.pnl_eur ?? 0;
  const pnlPct = pos.unrealized_pct ?? pos.pnl_pct ?? 0;
  const pnlPositive = pnl >= 0;
  const daysIn = pos.days_in_trade ?? 0;

  // Parse trade setting
  const setting = useMemo(() => {
    if (!pos.action_setting_json) return null;
    try {
      return typeof pos.action_setting_json === "string"
        ? JSON.parse(pos.action_setting_json)
        : pos.action_setting_json;
    } catch { return null; }
  }, [pos.action_setting_json]);

  // Status badges derived from setting + current state
  const statusBadges = useMemo(() => {
    const badges = [];
    if (!setting) return badges;
    const currentPrice = pos.current_price ?? pos.entry_price;
    // Ziel 1 erreicht
    if (pos.target_1 && currentPrice >= pos.target_1) {
      const action = pos.target_1_action || "50% verkaufen";
      badges.push({ type: "target1", label: `🎯 Ziel 1 erreicht — ${action}?`, color: "bg-green-900/40 text-green-300 border-green-700" });
    }
    // Haltefrist abgelaufen
    if (pos.hold_days_max && daysIn > pos.hold_days_max) {
      badges.push({ type: "expired", label: `⏱ Haltefrist abgelaufen (${daysIn}d > ${pos.hold_days_max}d) — Exit prüfen`, color: "bg-orange-900/40 text-orange-300 border-orange-700" });
    }
    return badges;
  }, [setting, pos, daysIn]);

  // Computed CRV from edit form
  const editEntry = parseFloat(editForm.entry_price);
  const editStop = parseFloat(editForm.stop_loss);
  const editTarget = parseFloat(editForm.target);
  const editCrv = editEntry && editStop && editTarget && editEntry > editStop
    ? ((editTarget - editEntry) / (editEntry - editStop)).toFixed(2)
    : null;

  async function saveEdit() {
    setSaving(true);
    try {
      const payload = {
        entry_price: parseFloat(editForm.entry_price),
        shares: parseFloat(editForm.shares),
        stop_loss: parseFloat(editForm.stop_loss),
        ...(editForm.target ? { target: parseFloat(editForm.target) } : {}),
        ...(editForm.notes !== undefined ? { notes: editForm.notes } : {}),
      };
      await axios.put(`/api/portfolio/${pos.id}`, payload);
      setShowEdit(false);
      onUpdate();
    } finally { setSaving(false); }
  }

  async function closePosition() {
    let priceUsd;
    if (exitEurMode && isTR && exitPriceEur && eurusd) {
      priceUsd = parseFloat(exitPriceEur) * eurusd;
    } else {
      priceUsd = parseFloat(exitPrice);
    }
    if (!priceUsd || isNaN(priceUsd)) return;
    setSaving(true);
    try {
      await axios.post(`/api/portfolio/${pos.id}/close`, {
        exit_price: priceUsd,
        exit_reason: exitReason,
      });
      setShowClose(false);
      onUpdate();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <span className="text-white font-bold text-lg">{pos.ticker}</span>
          <div className="text-gray-500 text-xs mt-0.5">
            Entry {pos.entry_date} · {daysIn}d in trade
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowEdit(e => !e); setShowClose(false); }}
            title="Position bearbeiten"
            className={`text-xs px-2 py-1 rounded border transition ${
              showEdit
                ? "bg-indigo-600/30 border-indigo-500/50 text-indigo-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
          >
            ✏
          </button>
          <div className="text-right">
            <div className={`text-lg font-bold ${pnlPositive ? "text-green-400" : "text-red-400"}`}>
              {pnlPositive ? "+" : ""}€{pnl.toFixed(2)}
            </div>
            <div className={`text-xs ${pnlPositive ? "text-green-500" : "text-red-500"}`}>
              {pnlPositive ? "+" : ""}{pnlPct.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* Edit form */}
      {showEdit && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-3">
          <div className="text-xs text-gray-400 font-medium mb-1">Position bearbeiten</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["entry_price", "Entry Preis ($)"],
              ["shares", "Shares"],
              ["stop_loss", "Stop Loss ($)"],
              ["target", "Target ($)"],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="block text-[10px] text-gray-500 mb-1">{label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm[key]}
                  onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            ))}
          </div>
          {editCrv && (
            <div className="text-xs text-gray-400">
              CRV: <span className={`font-medium ${parseFloat(editCrv) >= 2 ? "text-green-400" : parseFloat(editCrv) >= 1 ? "text-yellow-400" : "text-red-400"}`}>
                {editCrv}
              </span>
            </div>
          )}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Notizen</label>
            <textarea
              value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={saving}
              className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition disabled:opacity-50">
              {saving ? "Speichern…" : "Speichern"}
            </button>
            <button onClick={() => setShowEdit(false)}
              className="px-3 py-1.5 bg-gray-700 text-gray-400 text-xs rounded">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Price info */}
      <div className="grid grid-cols-3 gap-1.5 text-xs">
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500 text-[10px]">Entry</div>
          <div className="text-white font-medium">${pos.entry_price?.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500 text-[10px]">Shares</div>
          <div className="text-white font-medium">{pos.shares}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500 text-[10px]">Value</div>
          <div className="text-white font-medium">€{pos.position_value?.toFixed(0)}</div>
        </div>
      </div>

      {/* Stop & Target */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Stop:</span>
          <span className="text-red-400 font-medium">${pos.stop_loss?.toFixed(2)}</span>
        </div>
        {pos.target && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-gray-500">Target:</span>
            <span className="text-green-400 font-medium">${pos.target?.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-gray-500">Risk:</span>
          <span className="text-orange-400">€{pos.risk_amount?.toFixed(2)}</span>
        </div>
      </div>

      {/* Signals */}
      {pos.signals?.length > 0 && (
        <div className="space-y-1">
          {pos.signals.slice(0, 3).map((sig) => (
            <div key={sig.id} className={`text-xs p-1.5 rounded border ${SIGNAL_COLORS[sig.severity] || SIGNAL_COLORS.low}`}>
              {SIGNAL_ICONS[sig.signal_type] || "⚡"} {sig.description}
            </div>
          ))}
        </div>
      )}

      {/* Status badges from trade setting */}
      {statusBadges.map((b) => (
        <div key={b.type} className={`text-xs p-1.5 rounded border font-medium ${b.color}`}>
          {b.label}
        </div>
      ))}

      {/* Trade Plan Accordion */}
      {setting && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowPlan(p => !p)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/60 hover:bg-gray-800 transition text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs">📋</span>
              <span className="text-gray-300 text-xs font-medium">
                {pos.trade_type === "position" ? "Positionstrade" : "Swing Trade"} Plan
              </span>
              {pos.stop_loss_initial && (
                <span className="text-gray-500 text-xs">Stop: ${pos.stop_loss_initial}</span>
              )}
              {pos.target_1 && (
                <span className="text-gray-500 text-xs">· Ziel 1: ${pos.target_1}</span>
              )}
              {pos.target_2 && (
                <span className="text-gray-500 text-xs">· Ziel 2: ${pos.target_2}</span>
              )}
            </div>
            <span className="text-gray-500 text-xs">{showPlan ? "▲" : "▼"}</span>
          </button>
          {showPlan && (
            <div className="px-3 py-3 bg-gray-900/60 space-y-3">
              {/* Hold duration */}
              {pos.hold_days_min && pos.hold_days_max && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">⏱ Haltedauer:</span>
                  <span className="text-white">{pos.hold_days_min}–{pos.hold_days_max} Tage</span>
                  {daysIn > 0 && (
                    <span className={`ml-auto ${daysIn > pos.hold_days_max ? "text-red-400" : "text-gray-400"}`}>
                      Noch ~{Math.max(0, pos.hold_days_max - daysIn)}d bis Max
                    </span>
                  )}
                </div>
              )}
              {/* Targets */}
              {(pos.target_1 || pos.target_2) && (
                <div className="space-y-1">
                  {pos.target_1 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-400">🎯</span>
                      <span className="text-white font-medium">Ziel 1: ${pos.target_1}</span>
                      {pos.target_1_action && <span className="text-gray-400">→ {pos.target_1_action}</span>}
                    </div>
                  )}
                  {pos.target_2 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-400">🎯</span>
                      <span className="text-white font-medium">Ziel 2: ${pos.target_2}</span>
                      {pos.target_2_action && <span className="text-gray-400">→ {pos.target_2_action}</span>}
                    </div>
                  )}
                </div>
              )}
              {/* Exit triggers */}
              {pos.exit_trigger_json && (() => {
                try {
                  const triggers = JSON.parse(pos.exit_trigger_json);
                  const immediate = triggers.filter(t => t.urgency === "immediate");
                  const watch = triggers.filter(t => t.urgency !== "immediate");
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {immediate.length > 0 && (
                        <div>
                          <p className="text-red-400 text-[10px] font-semibold mb-1">Sofort raus:</p>
                          {immediate.map((t, i) => (
                            <p key={i} className="text-gray-400 text-[10px]">• {t.condition}</p>
                          ))}
                        </div>
                      )}
                      {watch.length > 0 && (
                        <div>
                          <p className="text-yellow-400 text-[10px] font-semibold mb-1">Beobachten:</p>
                          {watch.map((t, i) => (
                            <p key={i} className="text-gray-500 text-[10px]">• {t.condition}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                } catch { return null; }
              })()}
              {/* AI Summary */}
              {setting.summary && (
                <p className="text-gray-500 text-[10px] italic border-t border-gray-800 pt-2">{setting.summary}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Close button */}
      {!showClose ? (
        <button
          onClick={() => { setShowClose(true); setShowEdit(false); }}
          className="text-xs py-1.5 bg-gray-800 hover:bg-red-900/30 text-gray-400 hover:text-red-300 rounded border border-gray-700 hover:border-red-800 transition"
        >
          Close Position
        </button>
      ) : (
        <div className="space-y-2">
          {isTR && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExitEurMode(m => !m)}
                className={`px-2 py-0.5 rounded border text-[10px] transition ${
                  exitEurMode
                    ? "bg-indigo-900/30 border-indigo-600 text-indigo-300"
                    : "border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                {exitEurMode ? "€ EUR-Modus aktiv" : "EUR eingeben"}
              </button>
              {exitEurMode && eurusd && (
                <span className="text-[10px] text-gray-600">EUR/USD: {eurusd.toFixed(4)}</span>
              )}
            </div>
          )}
          {exitEurMode && isTR ? (
            <div className="space-y-1">
              <input
                type="number" step="0.01" placeholder="Exit Preis (EUR)"
                value={exitPriceEur} onChange={e => setExitPriceEur(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
              />
              {exitPriceEur && eurusd ? (
                <div className="text-xs text-gray-500 px-1">
                  ≈ ${(parseFloat(exitPriceEur) * eurusd).toFixed(2)} USD gespeichert
                </div>
              ) : exitPriceEur && !eurusd ? (
                <div className="text-xs text-gray-600 px-1">EUR/USD-Rate wird geladen…</div>
              ) : null}
            </div>
          ) : (
            <input
              type="number" step="0.01" placeholder="Exit price"
              value={exitPrice} onChange={e => setExitPrice(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
            />
          )}
          <select value={exitReason} onChange={e => setExitReason(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-gray-300 text-sm">
            <option value="manual">Manual</option>
            <option value="stop_loss">Stop Loss</option>
            <option value="target">Target Reached</option>
            <option value="signal">Signal</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={closePosition}
              disabled={saving || (exitEurMode && isTR ? !exitPriceEur : !exitPrice)}
              className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded disabled:opacity-50"
            >
              Confirm Close
            </button>
            <button onClick={() => setShowClose(false)} className="px-3 py-1.5 bg-gray-800 text-gray-400 rounded text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
