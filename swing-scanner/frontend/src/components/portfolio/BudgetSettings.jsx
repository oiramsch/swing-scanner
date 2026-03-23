import { useState } from "react";
import axios from "axios";

export default function BudgetSettings({ budget, onClose, onSaved }) {
  const [form, setForm] = useState({
    start_budget: budget?.start_budget ?? 10000,
    risk_per_trade_pct: budget?.risk_per_trade_pct ?? 1.0,
    max_positions: budget?.max_positions ?? 10,
    max_sector_exposure_pct: budget?.max_sector_exposure_pct ?? 30,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put("/api/portfolio/budget", form);
      onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-sm w-full shadow-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Budget Settings</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Start Budget (€)</label>
              <input type="number" step="100" value={form.start_budget}
                onChange={e => setForm(f => ({ ...f, start_budget: parseFloat(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Risk per Trade: <span className="text-indigo-400 font-medium">{form.risk_per_trade_pct}%</span>
              </label>
              <input type="range" min="0.5" max="3" step="0.1" value={form.risk_per_trade_pct}
                onChange={e => setForm(f => ({ ...f, risk_per_trade_pct: parseFloat(e.target.value) }))}
                className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Max Positions</label>
              <input type="number" min="1" max="50" value={form.max_positions}
                onChange={e => setForm(f => ({ ...f, max_positions: parseInt(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Max Sector Exposure: <span className="text-indigo-400 font-medium">{form.max_sector_exposure_pct}%</span>
              </label>
              <input type="range" min="10" max="60" step="5" value={form.max_sector_exposure_pct}
                onChange={e => setForm(f => ({ ...f, max_sector_exposure_pct: parseFloat(e.target.value) }))}
                className="w-full accent-indigo-500" />
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
