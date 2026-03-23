import { useState } from "react";
import axios from "axios";

const EMOTIONS_ENTRY = ["confident", "regelbasiert", "fomo", "unsicher", "gierig", "angst"];
const EMOTIONS_EXIT = ["satisfied", "relieved", "disappointed", "regret"];

export default function JournalEntryForm({ entry, onClose, onSaved }) {
  const isEdit = !!entry?.id;
  const [form, setForm] = useState({
    ticker: entry?.ticker || "",
    trade_date: entry?.trade_date || new Date().toISOString().slice(0, 10),
    setup_type: entry?.setup_type || "",
    setup_reason: entry?.setup_reason || "",
    entry_price: entry?.entry_price || "",
    stop_loss: entry?.stop_loss || "",
    target: entry?.target || "",
    position_size: entry?.position_size || "",
    exit_price: entry?.exit_price || "",
    exit_date: entry?.exit_date || "",
    pnl_eur: entry?.pnl_eur || "",
    pnl_pct: entry?.pnl_pct || "",
    emotion_entry: entry?.emotion_entry || "",
    emotion_exit: entry?.emotion_exit || "",
    followed_rules: entry?.followed_rules ?? null,
    lesson: entry?.lesson || "",
    mistakes: entry?.mistakes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = {
        ...form,
        entry_price: parseFloat(form.entry_price),
        stop_loss: parseFloat(form.stop_loss),
        target: parseFloat(form.target),
        position_size: parseInt(form.position_size) || 0,
        exit_price: form.exit_price ? parseFloat(form.exit_price) : null,
        pnl_eur: form.pnl_eur !== "" ? parseFloat(form.pnl_eur) : null,
        pnl_pct: form.pnl_pct !== "" ? parseFloat(form.pnl_pct) : null,
      };
      if (isEdit) {
        await axios.put(`/api/journal/${entry.id}`, data);
      } else {
        await axios.post("/api/journal", data);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">{isEdit ? "Edit Entry" : "New Journal Entry"}</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
          </div>
          {error && <div className="mb-3 p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Col 1+2: Trade + Setup */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ticker</label>
                <input required value={form.ticker}
                  onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Trade Date</label>
                <input type="date" value={form.trade_date}
                  onChange={e => setForm(f => ({ ...f, trade_date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Setup Type</label>
              <select value={form.setup_type} onChange={e => setForm(f => ({ ...f, setup_type: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm">
                <option value="">Select…</option>
                <option value="breakout">Breakout</option>
                <option value="pullback">Pullback</option>
                <option value="pattern">Pattern</option>
                <option value="momentum">Momentum</option>
                <option value="fomo">FOMO</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Why did you buy? (Setup reason)</label>
              <textarea value={form.setup_reason} onChange={e => setForm(f => ({ ...f, setup_reason: e.target.value }))}
                rows={2} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm resize-none" />
            </div>

            {/* Col 3: Plan */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Entry $</label>
                <input required type="number" step="0.01" value={form.entry_price}
                  onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Stop $</label>
                <input required type="number" step="0.01" value={form.stop_loss}
                  onChange={e => setForm(f => ({ ...f, stop_loss: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-red-400 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Target $</label>
                <input required type="number" step="0.01" value={form.target}
                  onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-green-400 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Shares</label>
                <input type="number" value={form.position_size}
                  onChange={e => setForm(f => ({ ...f, position_size: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
            </div>

            {/* Col 4: Result */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Exit $</label>
                <input type="number" step="0.01" value={form.exit_price}
                  onChange={e => setForm(f => ({ ...f, exit_price: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Exit Date</label>
                <input type="date" value={form.exit_date}
                  onChange={e => setForm(f => ({ ...f, exit_date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">P&L €</label>
                <input type="number" step="0.01" value={form.pnl_eur}
                  onChange={e => setForm(f => ({ ...f, pnl_eur: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">P&L %</label>
                <input type="number" step="0.01" value={form.pnl_pct}
                  onChange={e => setForm(f => ({ ...f, pnl_pct: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm" />
              </div>
            </div>

            {/* Col 5: Lesson — most important */}
            <div className="p-3 bg-indigo-900/10 border border-indigo-800/30 rounded-lg space-y-3">
              <div className="text-indigo-400 text-xs font-semibold uppercase tracking-wide">The Lesson</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Emotion at Entry</label>
                  <select value={form.emotion_entry} onChange={e => setForm(f => ({ ...f, emotion_entry: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm">
                    <option value="">Select…</option>
                    {EMOTIONS_ENTRY.map(em => <option key={em} value={em}>{em}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Emotion at Exit</label>
                  <select value={form.emotion_exit} onChange={e => setForm(f => ({ ...f, emotion_exit: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300 text-sm">
                    <option value="">Select…</option>
                    {EMOTIONS_EXIT.map(em => <option key={em} value={em}>{em}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Rules followed?</label>
                <div className="flex gap-3">
                  {[true, false].map(v => (
                    <label key={String(v)} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={form.followed_rules === v}
                        onChange={() => setForm(f => ({ ...f, followed_rules: v }))}
                        className="accent-indigo-500" />
                      <span className={`text-sm ${v ? "text-green-400" : "text-red-400"}`}>{v ? "Yes" : "No"}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.followed_rules === false && (
                <div>
                  <label className="text-xs text-red-400 block mb-1">Rule violations / mistakes *</label>
                  <textarea required value={form.mistakes} onChange={e => setForm(f => ({ ...f, mistakes: e.target.value }))}
                    rows={2} placeholder="What rules did you break?"
                    className="w-full bg-gray-800 border border-red-800/50 rounded px-3 py-2 text-white text-sm resize-none" />
                </div>
              )}

              <div>
                <label className="text-xs text-gray-400 block mb-1">Lesson learned</label>
                <textarea value={form.lesson} onChange={e => setForm(f => ({ ...f, lesson: e.target.value }))}
                  rows={3} placeholder="What did you learn from this trade?"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm resize-none" />
              </div>
            </div>

            <button type="submit" disabled={saving}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg disabled:opacity-50">
              {saving ? "Saving…" : isEdit ? "Update Entry" : "Save Entry"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
