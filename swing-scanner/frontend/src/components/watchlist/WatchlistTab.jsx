import { useState, useEffect } from "react";
import axios from "axios";
import WatchlistCard from "./WatchlistCard.jsx";

export default function WatchlistTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: "", reason: "", alert_condition: "", sector: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchWatchlist(); }, []);

  async function fetchWatchlist() {
    setLoading(true);
    try {
      const res = await axios.get("/api/watchlist");
      setItems(res.data);
    } finally { setLoading(false); }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post("/api/watchlist", form);
      setForm({ ticker: "", reason: "", alert_condition: "", sector: "" });
      setShowAdd(false);
      fetchWatchlist();
    } finally { setSaving(false); }
  }

  async function handleRemove(id) {
    await axios.delete(`/api/watchlist/${id}`);
    fetchWatchlist();
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Watchlist</h2>
        <button onClick={() => setShowAdd(!showAdd)}
          className="text-sm px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">
          + Add to Watchlist
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-white text-sm font-medium">Add Watchlist Item</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Ticker *</label>
              <input required value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" placeholder="AAPL" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Reason *</label>
              <input required value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                placeholder="Watching for breakout above $150" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Alert condition</label>
              <input value={form.alert_condition}
                onChange={e => setForm(f => ({ ...f, alert_condition: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                placeholder="Price > 150" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? "Saving…" : "Add"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="px-4 py-2 bg-gray-800 text-gray-400 text-sm rounded-lg">Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-gray-900 h-32 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>No items on watchlist</p>
          <p className="text-sm mt-1">Add tickers to monitor them</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <WatchlistCard key={item.id} item={item} onRemove={() => handleRemove(item.id)} onUpdate={fetchWatchlist} />
          ))}
        </div>
      )}
    </div>
  );
}
