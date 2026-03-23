import { useState, useEffect } from "react";
import axios from "axios";
import TradeSettingModal from "./TradeSettingModal";

export default function AddPositionModal({ onClose, onSaved, prefill, budget = null }) {
  const [form, setForm] = useState({
    ticker: prefill?.ticker ?? "",
    entry_date: new Date().toISOString().slice(0, 10),
    entry_price: prefill?.entry_price ?? "",
    shares: "",
    stop_loss: prefill?.stop_loss ?? "",
    target: prefill?.target ?? "",
    setup_type: prefill?.setup_type ?? "",
    sector: prefill?.sector ?? "",
    notes: "",
  });
  const [sizing, setSizing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showSettingModal, setShowSettingModal] = useState(false);

  // Auto-calculate sizing when opened with prefill data
  useEffect(() => {
    if (prefill?.entry_price && prefill?.stop_loss && prefill?.target) {
      calcSize();
    }
  }, []);

  const crv = form.entry_price && form.stop_loss && form.target
    ? ((parseFloat(form.target) - parseFloat(form.entry_price)) / (parseFloat(form.entry_price) - parseFloat(form.stop_loss))).toFixed(2)
    : null;

  async function calcSize() {
    if (!form.entry_price || !form.stop_loss || !form.target) return;
    try {
      const res = await axios.post("/api/portfolio/position-size", {
        entry_price: parseFloat(form.entry_price),
        stop_loss: parseFloat(form.stop_loss),
        target: parseFloat(form.target),
      });
      setSizing(res.data);
      if (res.data.shares && !form.shares) {
        setForm(f => ({ ...f, shares: String(res.data.shares) }));
      }
    } catch {}
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Open TradeSettingModal for AI-generated plan before saving
    setShowSettingModal(true);
  }

  async function handleSettingConfirm(enrichedData) {
    setSaving(true);
    setError(null);
    try {
      await axios.post("/api/portfolio", {
        ...form,
        entry_price: parseFloat(form.entry_price),
        shares: parseFloat(form.shares) || 0,
        stop_loss: parseFloat(form.stop_loss),
        target: form.target ? parseFloat(form.target) : null,
        ...enrichedData,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      throw err; // re-throw so TradeSettingModal shows the error
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-lg">Add Position</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
          </div>

          {/* Budget summary */}
          {budget && (
            <div className="mb-4 px-3 py-2 bg-gray-800/80 border border-gray-700 rounded-lg flex items-center gap-3 text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Budget:</span>
                <span className="text-white font-medium">€{budget.start_budget?.toLocaleString("de-DE")}</span>
              </div>
              <div className="w-px h-3 bg-gray-700" />
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Risk/Trade:</span>
                <span className="text-orange-400 font-medium">{budget.risk_per_trade_pct}%</span>
              </div>
              <div className="w-px h-3 bg-gray-700" />
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">= max.</span>
                <span className="text-red-400 font-medium">
                  €{((budget.start_budget ?? 0) * (budget.risk_per_trade_pct ?? 1) / 100).toFixed(0)} Verlust
                </span>
              </div>
            </div>
          )}

          {error && <div className="mb-3 p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ticker *</label>
                <input required value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" placeholder="AAPL" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Entry Date</label>
                <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Entry Price *</label>
                <input required type="number" step="0.01" value={form.entry_price}
                  onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))}
                  onBlur={calcSize}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Shares</label>
                <input type="number" step="1" value={form.shares} onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" placeholder="Auto" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Stop Loss *</label>
                <input required type="number" step="0.01" value={form.stop_loss}
                  onChange={e => setForm(f => ({ ...f, stop_loss: e.target.value }))}
                  onBlur={calcSize}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-red-400 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Target</label>
                <input type="number" step="0.01" value={form.target}
                  onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                  onBlur={calcSize}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-green-400 text-sm" />
              </div>
            </div>

            {/* Live CRV */}
            {crv && (
              <div className="p-2 bg-gray-800 rounded text-xs text-center">
                CRV <span className="text-yellow-400 font-bold">1:{crv}</span>
              </div>
            )}

            {/* Position sizing */}
            {sizing && (
              <div className="p-2 bg-indigo-900/20 border border-indigo-800/30 rounded text-xs space-y-1">
                <div className="text-indigo-300 font-medium">Recommended: {sizing.shares} shares</div>
                <div className="text-gray-400">Value: €{sizing.position_value_eur} ({sizing.pct_of_budget}% budget)</div>
                <div className="text-gray-400">Risk: €{sizing.risk_amount_eur}</div>
                {sizing.warnings?.map((w, i) => <div key={i} className="text-yellow-400">{w}</div>)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Setup Type</label>
                <select value={form.setup_type} onChange={e => setForm(f => ({ ...f, setup_type: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm">
                  <option value="">Select…</option>
                  <option value="breakout">Breakout</option>
                  <option value="pullback">Pullback</option>
                  <option value="pattern">Pattern</option>
                  <option value="momentum">Momentum</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Sector</label>
                <input value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" placeholder="Technology" />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm resize-none" />
            </div>

            <button type="submit" disabled={saving}
              className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg disabled:opacity-50">
              {saving ? "Speichern…" : "Weiter: Trade-Plan erstellen →"}
            </button>
          </form>
        </div>
      </div>

      {showSettingModal && (
        <TradeSettingModal
          positionData={{
            ticker: form.ticker,
            entry_price: parseFloat(form.entry_price),
            shares: parseFloat(form.shares) || 0,
            stop_loss: parseFloat(form.stop_loss),
            target: form.target ? parseFloat(form.target) : null,
            setup_type: form.setup_type,
            sector: form.sector,
            entry_date: form.entry_date,
            notes: form.notes,
          }}
          onConfirm={handleSettingConfirm}
          onClose={() => setShowSettingModal(false)}
        />
      )}
    </div>
  );
}
