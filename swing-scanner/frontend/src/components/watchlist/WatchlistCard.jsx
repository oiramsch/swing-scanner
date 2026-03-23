import { useState } from "react";
import axios from "axios";

export default function WatchlistCard({ item, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ reason: item.reason, alert_condition: item.alert_condition || "" });
  const [saving, setSaving] = useState(false);

  const triggered = item.triggered;
  const conditionMet = item.condition_met;

  async function handleSave() {
    setSaving(true);
    try {
      await axios.put(`/api/watchlist/${item.id}`, form);
      onUpdate?.();
      setEditing(false);
    } finally { setSaving(false); }
  }

  return (
    <div className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-2 ${triggered ? "border-green-700" : conditionMet ? "border-yellow-700" : "border-gray-800"}`}>
      <div className="flex items-start justify-between">
        <div>
          <span className="text-white font-bold text-lg">{item.ticker}</span>
          {item.sector && <span className="ml-2 text-gray-500 text-xs">{item.sector}</span>}
          <div className="text-gray-500 text-xs mt-0.5">Added {item.added_date}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {triggered && <span className="text-xs text-green-400 font-medium">✓ Triggered</span>}
          {conditionMet && !triggered && <span className="text-xs text-yellow-400 animate-pulse">● Alert!</span>}
          {item.current_price && (
            <span className="text-white font-medium text-sm">${item.current_price}</span>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Reason</label>
            <input value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Alert Condition</label>
            <input value={form.alert_condition} placeholder="z.B. Price > 150"
              onChange={e => setForm(f => ({ ...f, alert_condition: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 text-xs py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition disabled:opacity-50">
              {saving ? "…" : "Speichern"}
            </button>
            <button onClick={() => setEditing(false)}
              className="flex-1 text-xs py-1.5 bg-gray-800 text-gray-400 rounded">
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-gray-400 text-xs">{item.reason}</p>

          {item.alert_condition && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs">Alert:</span>
              <span className={`text-xs font-medium ${conditionMet ? "text-yellow-400" : "text-gray-400"}`}>
                {item.alert_condition}
              </span>
            </div>
          )}

          {item.current_rsi && (
            <div className="text-xs text-gray-500">RSI: {item.current_rsi}</div>
          )}

          <div className="flex gap-2 mt-auto">
            <button onClick={() => setEditing(true)}
              className="flex-1 text-xs py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded border border-gray-700 transition">
              Bearbeiten
            </button>
            <button onClick={onRemove}
              className="flex-1 text-xs py-1.5 bg-gray-800 hover:bg-red-900/30 text-gray-500 hover:text-red-400 rounded border border-gray-700 hover:border-red-800 transition">
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
